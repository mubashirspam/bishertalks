export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { listCouriers, courierIdsForTracking } from "@/lib/db/couriers";
import { ADAPTERS, trackingBatches, type CarrierAdapter } from "@/lib/couriers/adapters";
import {
  trackableParcels,
  unmatchedSheetParcels,
  attachWaybill,
} from "@/lib/db/courier-send";
import { applyCarrierScan } from "@/lib/db/courier-scan";

/**
 * Ask every carrier where our parcels are.
 *
 * Runs once per carrier, over that carrier's own parcels. It used to be one
 * hard-coded Delhivery sweep, which was correct while Delhivery was the only
 * integration and became dangerous the moment it was not: a carrier can only
 * answer for parcels that are theirs, and one that answers confidently about
 * somebody else's reference writes a stranger's scans onto our order.
 *
 * One carrier failing does not stop the others — each is wrapped, and the next
 * run picks up whatever was missed, because nothing about those parcels has
 * changed.
 *
 * The webhook in /api/webhook/delhivery is the fast path, but it is opt-in at
 * their end and takes about a week to enable — so this exists to make the whole
 * feature work without it, and stays afterwards as the backstop for scans that
 * were pushed while we were deploying.
 *
 * It does two passes. The first looks up parcels that went out on the Excel
 * sheet by their Reference No, which is how the back catalogue — everything KKR
 * ever uploaded by hand — gets a waybill and a status without anyone typing one
 * in. The second tracks parcels whose waybill we already know.
 *
 * Rate limit: their pull API allows 750 requests per 5 minutes per IP. One
 * request carries 50 waybills, so the cap below is about parcels, not requests,
 * and a run of 200 parcels costs four calls. Every 15 minutes is plenty.
 *
 * Schedule it with whatever runs jobs for this deployment, sending
 * `Authorization: Bearer $CRON_SECRET`. There is no scheduler configured in the
 * repo — see docs/delhivery-runbook.md.
 */

/**
 * How many parcels one carrier gets to look at per run.
 *
 * Four requests' worth at the batch size both carriers happen to use. Their
 * limits are per carrier, not shared, so this is per carrier too — Delhivery
 * allows 750 pull requests per five minutes per IP, and a run of 200 parcels
 * costs four calls.
 */
const PER_RUN = 200;

function authorised(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error("[Poll] CRON_SECRET is unset — refusing to run");
    return false;
  }

  // Header first; a query parameter as a fallback, because some schedulers
  // cannot set headers and a poller nobody can trigger is a poller that never
  // runs. Same secret either way, and compared in constant time below.
  const sent =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    new URL(request.url).searchParams.get("key") ||
    "";
  const a = Buffer.from(sent);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function GET(request: NextRequest) {
  if (!authorised(request)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const couriers = await listCouriers();
  const perCarrier: Record<string, unknown>[] = [];
  let checked = 0;
  let matched = 0;
  const moved: { order: string; to: string }[] = [];

  for (const adapter of ADAPTERS) {
    // A carrier with no courier row pointing at it has no parcels to ask
    // about. Not an error — India Post is exactly this until its row is
    // configured.
    const rows = couriers.filter((c) => c.config.tracking === adapter.trackingKey);
    if (!rows.length) {
      perCarrier.push({ carrier: adapter.trackingKey, skipped: "no courier configured" });
      continue;
    }

    // Any row will do for credentials: rows sharing a tracking key share the
    // account behind it, which is the whole reason both KKR rows resolve here.
    const config = rows[0].config;
    const { ready, missing } = adapter.readiness(config);
    if (!ready) {
      perCarrier.push({ carrier: adapter.trackingKey, skipped: "not configured", missing });
      continue;
    }

    try {
      const result = await pollCarrier(adapter, config);
      checked += result.checked;
      matched += result.matched;
      moved.push(...result.moved);
      perCarrier.push({ carrier: adapter.trackingKey, ...result, moved: result.moved.length });
    } catch (e) {
      // One carrier's outage must not cost the others their run.
      console.error(`[Poll] ${adapter.trackingKey} failed:`, e);
      perCarrier.push({ carrier: adapter.trackingKey, failed: true });
    }
  }

  if (moved.length) console.log("[Poll] moved:", moved);

  return NextResponse.json({
    ok: true,
    checked,
    // Sheeted parcels that just learned their carrier number for the first time.
    matched,
    moved: moved.length,
    carriers: perCarrier,
  });
}

/** One carrier's two passes, over its own parcels only. */
async function pollCarrier(
  adapter: CarrierAdapter,
  config: Parameters<CarrierAdapter["readiness"]>[0]
): Promise<{ checked: number; matched: number; moved: { order: string; to: string }[] }> {
  const moved: { order: string; to: string }[] = [];
  let checked = 0;
  let matched = 0;

  const courierIds = await courierIdsForTracking(adapter.trackingKey);

  // The pre-0030 back catalogue carries no courier_id because there was nobody
  // else to be. Those parcels are Delhivery's and only Delhivery's; letting a
  // second carrier claim them is how an order inherits a stranger's scans.
  const includeUnrouted = adapter.trackingKey === "delhivery";

  // ── Parcels that went out on a spreadsheet ────────────────────────────────
  // Uploaded by hand, so the carrier has them and we do not know the number
  // they filed it under. Our reference is on that sheet and Delhivery indexes
  // on it, so one lookup gives us both the waybill and the current scan.
  //
  // Only for a carrier that can be asked by reference. India Post cannot, and
  // needs not to be: its article number is one we minted before booking, so it
  // is already on the order and the second pass covers it.
  if (adapter.trackByReference) {
    const unmatched = await unmatchedSheetParcels(PER_RUN, { courierIds, includeUnrouted });
    const refToOrder = new Map(unmatched.map((p) => [p.courier_reference, p.order_number]));

    for (const batch of trackingBatches([...refToOrder.keys()], adapter.trackBatch)) {
      let tracked;
      try {
        tracked = await adapter.trackByReference(batch, config);
      } catch (e) {
        console.error("[Poll] reference batch failed:", e);
        continue;
      }

      for (const parcel of tracked) {
        const orderNumber = parcel.reference ? refToOrder.get(parcel.reference) : undefined;
        if (!orderNumber) continue;

        try {
          await attachWaybill(orderNumber, parcel.carrierId);
          matched++;
          // Silent. We are learning where a parcel already is, not watching it
          // move — the customer may have had it for a week. Once the number is
          // stored the pass below tracks it normally and does message them.
          const outcome = await applyCarrierScan(
            parcel.scan,
            { waybill: parcel.carrierId, reference: orderNumber },
            { notify: false }
          );
          if (outcome?.moved_to) moved.push({ order: outcome.order_number, to: outcome.moved_to });
        } catch (e) {
          console.error("[Poll] reference scan failed for", parcel.reference, e);
        }
      }
      checked += tracked.length;
    }
  }

  // ── Parcels we already have a number for ──────────────────────────────────
  if (!adapter.trackByCarrierId) return { checked, matched, moved };

  const parcels = await trackableParcels(PER_RUN, { courierIds, includeUnrouted });
  const byNumber = new Map(parcels.map((p) => [p.tracking_number, p.order_number]));

  for (const batch of trackingBatches([...byNumber.keys()], adapter.trackBatch)) {
    let tracked;
    try {
      tracked = await adapter.trackByCarrierId(batch, config);
    } catch (e) {
      // One bad batch should not lose the rest of the run — the next run picks
      // these up again, because nothing about them has changed.
      console.error("[Poll] batch failed:", e);
      continue;
    }

    checked += tracked.length;

    for (const parcel of tracked) {
      try {
        const outcome = await applyCarrierScan(parcel.scan, {
          waybill: parcel.carrierId,
          reference: parcel.reference ?? byNumber.get(parcel.carrierId) ?? null,
        });
        if (outcome?.moved_to) moved.push({ order: outcome.order_number, to: outcome.moved_to });
      } catch (e) {
        console.error("[Poll] scan failed for", parcel.carrierId, e);
      }
    }
  }

  return { checked, matched, moved };
}

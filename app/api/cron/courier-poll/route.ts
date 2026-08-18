export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getCourierBySlug } from "@/lib/db/couriers";
import { delhiveryReadiness } from "@/lib/delhivery/config";
import {
  trackWaybills,
  trackReferences,
  trackingBatches,
  TRACK_BATCH,
} from "@/lib/delhivery/track";
import {
  trackableParcels,
  unmatchedSheetParcels,
  attachWaybill,
} from "@/lib/db/courier-send";
import { applyScan } from "@/lib/db/courier-scan";

/**
 * Ask Delhivery where our parcels are.
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

/** How many parcels one run will look at. Four requests' worth. */
const PER_RUN = TRACK_BATCH * 4;

function authorised(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error("[Poll] CRON_SECRET is unset — refusing to run");
    return false;
  }

  const sent = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(sent);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function GET(request: NextRequest) {
  if (!authorised(request)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  // Any courier with Delhivery tracking behind it will do — the settings we
  // need are the same, and the parcels are all in one Delhivery account.
  const courier = await getCourierBySlug("delhivery");
  if (!courier) {
    return NextResponse.json({ ok: true, skipped: "no delhivery courier configured" });
  }

  const { ready, settings, missing } = delhiveryReadiness(courier.config);
  if (!ready || !settings) {
    // Not an error: the integration simply isn't set up yet. Saying which
    // settings are missing beats a silent no-op in a log nobody reads.
    return NextResponse.json({ ok: true, skipped: "not configured", missing });
  }

  const moved: { order: string; to: string }[] = [];
  let checked = 0;
  let matched = 0;

  // ── Parcels that went out on a spreadsheet ────────────────────────────────
  // KKR uploaded these by hand, so Delhivery has them and we do not know their
  // waybill. The Reference No on that sheet is our courier_reference, and
  // Delhivery indexes on it — so one lookup gives us the waybill AND the
  // current scan, and everything after this point treats them like any other
  // tracked parcel. This is what puts a year of already-shipped orders on the
  // screen without anyone typing a number in.
  const unmatched = await unmatchedSheetParcels(PER_RUN);
  const refToOrder = new Map(unmatched.map((p) => [p.courier_reference, p.order_number]));

  for (const batch of trackingBatches([...refToOrder.keys()])) {
    let tracked;
    try {
      tracked = await trackReferences(batch, settings);
    } catch (e) {
      console.error("[Poll] reference batch failed:", e);
      continue;
    }

    for (const parcel of tracked) {
      const orderNumber = parcel.reference ? refToOrder.get(parcel.reference) : undefined;
      if (!orderNumber) continue;

      try {
        await attachWaybill(orderNumber, parcel.waybill);
        matched++;
        // Silent. We are learning where a parcel already is, not watching it
        // move — the customer may have had it for a week. Once the waybill is
        // stored, the pass below tracks it normally and does message them.
        const outcome = await applyScan(
          parcel.scan,
          { waybill: parcel.waybill, reference: orderNumber },
          { notify: false }
        );
        if (outcome?.moved_to) {
          moved.push({ order: outcome.order_number, to: outcome.moved_to });
        }
      } catch (e) {
        console.error("[Poll] reference scan failed for", parcel.reference, e);
      }
    }
    checked += tracked.length;
  }

  // ── Parcels we already have a waybill for ─────────────────────────────────
  const parcels = await trackableParcels(PER_RUN);
  if (!parcels.length && !checked) return NextResponse.json({ ok: true, checked: 0 });

  const byWaybill = new Map(parcels.map((p) => [p.tracking_number, p.order_number]));

  for (const batch of trackingBatches([...byWaybill.keys()])) {
    let tracked;
    try {
      tracked = await trackWaybills(batch, settings);
    } catch (e) {
      // One bad batch should not lose the rest of the run — the next run picks
      // these up again, because nothing about them has changed.
      console.error("[Poll] batch failed:", e);
      continue;
    }

    checked += tracked.length;

    for (const parcel of tracked) {
      try {
        const outcome = await applyScan(parcel.scan, {
          waybill: parcel.waybill,
          reference: parcel.reference ?? byWaybill.get(parcel.waybill) ?? null,
        });
        if (outcome?.moved_to) {
          moved.push({ order: outcome.order_number, to: outcome.moved_to });
        }
      } catch (e) {
        console.error("[Poll] scan failed for", parcel.waybill, e);
      }
    }
  }

  if (moved.length) console.log("[Poll] moved:", moved);

  return NextResponse.json({
    ok: true,
    checked,
    // Sheeted parcels that just learned their waybill for the first time.
    matched,
    moved: moved.length,
  });
}

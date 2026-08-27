export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-auth";
import { getCourier } from "@/lib/db/couriers";
import { canTrack } from "@/lib/couriers";
import {
  trackReadiness,
  trackingBatches,
  type CarrierScan,
} from "@/lib/couriers/adapters";
import { applyCarrierScan } from "@/lib/db/courier-scan";
import { portalScope } from "@/lib/delivery/scope";
import { attachWaybill } from "@/lib/db/courier-send";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * "Sync now" — ask the courier where these parcels are, this second.
 *
 * The scheduled poller does the same job on a timer; this exists because the
 * person looking at the screen wants an answer now, usually with a customer on
 * the phone. Same code underneath, so the two cannot disagree.
 *
 * Read-only at Delhivery's end: it asks, it never sends. That is why it answers
 * to `delivery.portal` rather than the stricter permission sending needs — an
 * agent should be able to refresh the screen they work in.
 *
 * Parcels are matched by waybill where we have one, and by name where we do
 * not — and there are TWO names, because there are two ways a parcel reaches
 * Delhivery and they file it under a different one each time:
 *
 *   courier_reference (BISH…)   the Reference No printed on KKR's Excel sheet
 *   order_number      (ORD-…)   what `manifest.ts` sends as `order` on an API
 *                               push, echoed back to us as ReferenceNo
 *
 * Only the first was ever asked. That was invisible while every parcel went out
 * on a sheet, and became a hole the moment sending moved to the API: a parcel
 * Delhivery accepted but whose waybill we failed to store could not be found by
 * the one tool built to find it, because we were asking about a number they had
 * never been given. It stayed "Not with them" forever, however many times
 * anyone pressed Sync.
 *
 * Both are asked now. This is also the recovery path for a send whose outcome
 * was unknown: if Delhivery has the shipment, Sync learns the waybill and the
 * parcel stops being held — no second manifest, no duplicate parcel.
 */

/** One screen's worth. The portal shows 100 at a time. */
const MAX = 100;

/** A whole-account sweep. Above this it belongs in the scheduled poller. */
const MAX_ALL = 2000;

export async function POST(request: NextRequest) {
  const auth = await requirePermission("delivery.portal");
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({}));

  const orderNumbers: string[] = Array.isArray(body.order_numbers)
    ? [
        ...new Set<string>(
          body.order_numbers.filter((n: unknown): n is string => typeof n === "string")
        ),
      ].slice(0, MAX)
    : [];

  // A partner asks about their own courier and no other. The id off the wire
  // is a request, not a fact: without this, a partner could name the courier
  // they do not work for and read the scan history — and through it the
  // movements — of a competitor's parcels.
  const scope = portalScope(auth.staff);
  const asked = typeof body.courier_id === "string" ? body.courier_id : "";
  const courierId = scope.seesEveryone ? asked : (scope.courierId ?? "");

  /**
   * Sweep everything rather than one screenful.
   *
   * Deliberately silent. A sweep is a catch-up on history, and the customers it
   * would message are people whose parcel arrived days ago — being told it has
   * shipped when it is already on their shelf is worse than being told nothing.
   * The per-screen sync stays noisy, because there the news is news.
   */
  const all = body.all === true;

  if (!all && !orderNumbers.length) {
    return NextResponse.json({ error: "Nothing to sync" }, { status: 400 });
  }
  if (!courierId) {
    return NextResponse.json(
      {
        error: scope.seesEveryone
          ? "No courier chosen"
          : "Your login isn't linked to a delivery partner yet.",
      },
      { status: scope.seesEveryone ? 400 : 403 }
    );
  }

  const courier = await getCourier(courierId);
  if (!courier) return NextResponse.json({ error: "Unknown courier" }, { status: 400 });

  if (!canTrack(courier)) {
    return NextResponse.json(
      {
        error: `${courier.name} has no live tracking — enter the tracking number by hand.`,
      },
      { status: 400 }
    );
  }

  // Whose API answers for this courier, and is it configured. The adapter is
  // chosen by `config.tracking`, not by slug, so both KKR rows resolve to
  // Delhivery and a Speed Post parcel resolves to India Post.
  const { ready, missing, adapter } = trackReadiness(courier);
  if (!ready || !adapter) {
    return NextResponse.json(
      { error: `${courier.name} is not set up for tracking yet.`, missing },
      { status: 400 }
    );
  }

  // What we can ask about. A parcel with neither a waybill nor a reference has
  // never been near this courier and is silently skipped.
  type Row = {
    order_number: string;
    tracking_number: string | null;
    courier_reference: string | null;
  };
  const rows: Row[] = [];

  // Only parcels this courier could possibly answer for.
  //
  // This used to be a permission scope — a partner saw their own courier, an
  // owner saw everything — and that read the question wrongly. It is not about
  // who is asking; it is that a courier cannot tell us where somebody else's
  // parcel is. An owner sweeping "all" asked Delhivery about India Post's
  // parcels too, Delhivery had another customer's shipment filed under one of
  // their reference strings, and an unposted parcel was given that shipment's
  // waybill and its "Delivered" scan.
  //
  // Unrouted parcels are still asked about: they are the pre-0030 back
  // catalogue, which went to Delhivery because there was nobody else.
  const courierScope = `courier_id.is.null,courier_id.eq.${courierId}`;

  if (all) {
    // Everything nameable that has not finished. A delivered parcel has
    // nothing left to tell us, and asking about it spends the rate limit on a
    // question already answered.
    for (let from = 0; from < MAX_ALL; from += 1000) {
      const sweep = supabaseAdmin
        .from("orders")
        .select("order_number,tracking_number,courier_reference")
        .or("tracking_number.not.is.null,courier_reference.not.is.null")
        .or(courierScope)
        .not("status", "in", "(delivered,returned,cancelled)");

      const { data, error } = await sweep
        .order("ordered_at", { ascending: false })
        .range(from, from + 999);

      if (error) {
        console.error("[Sync] sweep read failed:", error.message);
        break;
      }
      const batch = (data ?? []) as Row[];
      rows.push(...batch);
      if (batch.length < 1000) break;
    }
  } else {
    // Same scope as the sweep, and it is also the security guard a partner
    // needs: the order numbers came from the browser and prove nothing, so a
    // parcel belonging to another courier is simply not returned — never asked
    // about, never reported back.
    const picked = supabaseAdmin
      .from("orders")
      .select("order_number,tracking_number,courier_reference")
      .in("order_number", orderNumbers)
      .or(courierScope);

    const { data, error } = await picked;

    if (error) {
      console.error("[Sync] lookup failed:", error.message);
      return NextResponse.json({ error: "Could not load those parcels" }, { status: 500 });
    }
    rows.push(...((data ?? []) as Row[]));
  }

  const byWaybill = new Map<string, string>();
  // Keyed by whatever Delhivery might know the parcel as, pointing at the order
  // it belongs to. A parcel with no waybill gets both of its possible names in
  // here — they cannot collide, since one is BISH… and the other ORD-….
  const byReference = new Map<string, string>();
  for (const row of rows) {
    if (row.tracking_number) {
      byWaybill.set(row.tracking_number, row.order_number);
      continue;
    }
    if (row.courier_reference) byReference.set(row.courier_reference, row.order_number);
    // Always, not as a fallback: a parcel can have been pushed by API *and*
    // have a sheet reference minted at assignment, and which one Delhivery
    // answers to depends on how it actually left.
    byReference.set(row.order_number, row.order_number);
  }

  let checked = 0;
  let learned = 0;
  const moved: { order_number: string; to: string }[] = [];

  /**
   * What the courier said about each parcel we could name.
   *
   * Aggregate counts answer "was the sync worth pressing"; this answers "what
   * about THIS order", which is the question someone has when they press it
   * after a send went wrong. Absent from the list means the courier has no
   * record of that parcel — the caller knows what it asked about, so absence
   * is information rather than a gap.
   */
  const found = new Map<string, { order_number: string; waybill: string; scan: string; learned: boolean }>();

  /** Apply one courier answer to one order. */
  const record = async (
    parcel: CarrierScan,
    orderNumber: string,
    firstTime: boolean
  ) => {
    // Learning a waybill for the first time is a catch-up on history, so the
    // customer is not told — see lib/db/courier-scan.ts. A parcel we were
    // already tracking has genuinely just moved, so they are.
    if (firstTime) {
      await attachWaybill(orderNumber, parcel.carrierId);
      learned++;
    }
    found.set(orderNumber, {
      order_number: orderNumber,
      waybill: parcel.carrierId,
      scan: parcel.scan.description || "",
      // True when this sync is what taught us the waybill — which, after a send
      // whose outcome was unknown, is the moment the parcel stops being held.
      learned: firstTime,
    });
    const outcome = await applyCarrierScan(
      parcel.scan,
      { waybill: parcel.carrierId, reference: orderNumber },
      // News only when it is news: not on a first sighting, and never during a
      // sweep, which is catching up rather than watching.
      { notify: !firstTime && !all }
    );
    if (outcome?.moved_to) {
      moved.push({ order_number: outcome.order_number, to: outcome.moved_to });
    }
  };

  try {
    if (adapter.trackByCarrierId) {
      for (const batch of trackingBatches([...byWaybill.keys()], adapter.trackBatch)) {
        const tracked = await adapter.trackByCarrierId(batch, courier.config);
        checked += tracked.length;
        for (const parcel of tracked) {
          const orderNumber = byWaybill.get(parcel.carrierId);
          if (orderNumber) await record(parcel, orderNumber, false);
        }
      }
    }

    // Looking a parcel up by *our* name for it, which not every carrier can do.
    //
    // Delhivery indexes on the reference, which is the only way to find a
    // parcel whose waybill we never saw — and this list deliberately contains
    // names they may never have seen, so their adapter degrades a refused
    // batch to single lookups rather than reporting fifty parcels missing.
    //
    // India Post has no such lookup and needs none: its article number is one
    // we minted ourselves before booking, so it is already on the order and
    // the waybill pass above has it covered.
    const seen = new Set<string>();
    if (adapter.trackByReference) {
      for (const batch of trackingBatches([...byReference.keys()], adapter.trackBatch)) {
        const tracked = await adapter.trackByReference(batch, courier.config);
        for (const parcel of tracked) {
          const orderNumber = parcel.reference
            ? byReference.get(parcel.reference)
            : undefined;
          if (!orderNumber) continue;
          // Both names can answer for one parcel. Record it once.
          if (seen.has(orderNumber)) continue;
          seen.add(orderNumber);
          checked++;
          await record(parcel, orderNumber, true);
        }
      }
    }
  } catch (e) {
    console.error("[Sync] failed:", e);
    return NextResponse.json(
      { error: `Could not reach ${courier.name}. Nothing was changed.` },
      { status: 502 }
    );
  }

  return NextResponse.json({
    ok: true,
    all,
    asked: rows.length,
    checked,
    learned,
    moved: moved.length,
    // Per parcel, for a caller that asked about specific orders. Omitted on a
    // sweep, where it would be two thousand rows nobody is reading.
    results: all ? [] : [...found.values()],
    // Parcels the courier has no record of — the useful signal, because it
    // usually means a sheet that was never uploaded.
    unknown: rows.length - checked,
  });
}

export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-auth";
import { getCourier } from "@/lib/db/couriers";
import { canTrack } from "@/lib/couriers";
import { delhiveryReadiness } from "@/lib/delhivery/config";
import { trackWaybills, trackReferences, trackingBatches } from "@/lib/delhivery/track";
import { applyScan } from "@/lib/db/courier-scan";
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
 * Parcels are matched by waybill where we have one and by our Reference No
 * where we do not, which is what lets a parcel that went out on an Excel sheet
 * be tracked without anyone typing its waybill in.
 */

/** One screen's worth. The portal shows 100 at a time. */
const MAX = 100;

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

  const courierId = typeof body.courier_id === "string" ? body.courier_id : "";

  if (!orderNumbers.length) {
    return NextResponse.json({ error: "Nothing to sync" }, { status: 400 });
  }
  if (!courierId) {
    return NextResponse.json({ error: "No courier chosen" }, { status: 400 });
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

  const { ready, settings, missing } = delhiveryReadiness(courier.config);
  if (!ready || !settings) {
    return NextResponse.json({ error: "Delhivery is not set up yet.", missing }, { status: 400 });
  }

  // What we can ask about. A parcel with neither a waybill nor a reference has
  // never been near this courier and is silently skipped.
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("order_number,tracking_number,courier_reference")
    .in("order_number", orderNumbers);

  if (error) {
    console.error("[Sync] lookup failed:", error.message);
    return NextResponse.json({ error: "Could not load those parcels" }, { status: 500 });
  }

  const rows = (data ?? []) as {
    order_number: string;
    tracking_number: string | null;
    courier_reference: string | null;
  }[];

  const byWaybill = new Map<string, string>();
  const byReference = new Map<string, string>();
  for (const row of rows) {
    if (row.tracking_number) byWaybill.set(row.tracking_number, row.order_number);
    else if (row.courier_reference) byReference.set(row.courier_reference, row.order_number);
  }

  let checked = 0;
  let learned = 0;
  const moved: { order_number: string; to: string }[] = [];

  /** Apply one courier answer to one order. */
  const record = async (
    parcel: { waybill: string; reference: string | null; scan: Parameters<typeof applyScan>[0] },
    orderNumber: string,
    firstTime: boolean
  ) => {
    // Learning a waybill for the first time is a catch-up on history, so the
    // customer is not told — see lib/db/courier-scan.ts. A parcel we were
    // already tracking has genuinely just moved, so they are.
    if (firstTime) {
      await attachWaybill(orderNumber, parcel.waybill);
      learned++;
    }
    const outcome = await applyScan(
      parcel.scan,
      { waybill: parcel.waybill, reference: orderNumber },
      { notify: !firstTime }
    );
    if (outcome?.moved_to) {
      moved.push({ order_number: outcome.order_number, to: outcome.moved_to });
    }
  };

  try {
    for (const batch of trackingBatches([...byWaybill.keys()])) {
      const tracked = await trackWaybills(batch, settings);
      checked += tracked.length;
      for (const parcel of tracked) {
        const orderNumber = byWaybill.get(parcel.waybill);
        if (orderNumber) await record(parcel, orderNumber, false);
      }
    }

    for (const batch of trackingBatches([...byReference.keys()])) {
      const tracked = await trackReferences(batch, settings);
      checked += tracked.length;
      for (const parcel of tracked) {
        const orderNumber = parcel.reference ? byReference.get(parcel.reference) : undefined;
        if (orderNumber) await record(parcel, orderNumber, true);
      }
    }
  } catch (e) {
    console.error("[Sync] failed:", e);
    return NextResponse.json(
      { error: "Could not reach Delhivery. Nothing was changed." },
      { status: 502 }
    );
  }

  return NextResponse.json({
    ok: true,
    asked: rows.length,
    checked,
    learned,
    moved: moved.length,
    // Parcels the courier has no record of — the useful signal, because it
    // usually means a sheet that was never uploaded.
    unknown: rows.length - checked,
  });
}

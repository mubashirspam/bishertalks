import { supabaseAdmin } from "@/lib/supabase/admin";
import { setDeliveryStatus, notifyStatusChange } from "@/lib/db/delivery";
import {
  statusFromScan,
  canMoveTo,
  describeScan,
  type DelhiveryScan,
} from "@/lib/delhivery/status";
import { recordScan } from "@/lib/db/courier-send";
import type { OrderStatus } from "@/lib/types/order";

/**
 * A scan with the carrier-specific reading already done.
 *
 * `next` is what this carrier says the scan means for the order — null to
 * record the movement and change nothing, which is the common case.
 */
export interface NormalisedScan {
  /** Shown on the portal row, in the carrier's own words. */
  description: string;
  /** ISO timestamp of the scan, or null to stamp it now. */
  at: string | null;
  next: OrderStatus | null;
}

/**
 * Applying a courier scan to an order.
 *
 * The one rule that matters: a scan never writes `orders.status` directly. It
 * goes through `setDeliveryStatus`, exactly as an agent's tick does, because
 * that is what settles the referral commission on delivery and voids it on a
 * return. A webhook that wrote the column itself would deliver the parcel and
 * quietly not pay the referrer.
 *
 * The second rule: a scan can only move an order *forwards*. Delhivery replays
 * scans, and webhooks arrive out of order — without this, a stale "in transit"
 * push landing after "delivered" would un-deliver a parcel and take a
 * commission back with it. `canMoveTo` is that guard.
 *
 * The full lifecycle is mapped — Packed, Shipped, Out for delivery, Delivered,
 * Returned — so a parcel walks the queue on its own once it is with Delhivery.
 * See lib/delhivery/status.ts for which of their scans mean what.
 */

export interface ScanOutcome {
  order_number: string;
  /** The status it moved to, or null if only the scan text was recorded. */
  moved_to: string | null;
}

/**
 * Record one scan. Returns what it did, for the caller to log.
 *
 * `waybill` is how a push identifies the parcel; `reference` is our own order
 * number, which Delhivery echoes back. Either will do — the reference is
 * preferred because it needs no lookup.
 */
export async function applyScan(
  scan: DelhiveryScan,
  identity: { waybill?: string | null; reference?: string | null },
  /**
   * Whether the customer hears about it.
   *
   * False for a catch-up: the first time we look up a parcel that went out on
   * a spreadsheet weeks ago, we are learning history, not witnessing an event.
   * Sending "your parcel has shipped" to someone already holding their book is
   * worse than saying nothing, and doing it to a few hundred people at once is
   * how a WhatsApp number gets reported.
   */
  options: { notify?: boolean } = {}
): Promise<ScanOutcome | null> {
  return applyCarrierScan(
    {
      description: describeScan(scan),
      at: scan.statusDateTime,
      next: statusFromScan(scan),
    },
    identity,
    options
  );
}

/**
 * One scan from any carrier, already read.
 *
 * The carrier-neutral half of the above, split out when India Post arrived.
 * Everything below this line is true of a parcel movement whoever reported it:
 * record what happened, refuse to move backwards, go through
 * `setDeliveryStatus` so commissions settle, and tell the customer once.
 *
 * What a scan *means* is the carrier's business and stays in the carrier's own
 * module, because the two vocabularies do not survive being merged — Delhivery
 * says "RTO Delivered" and India Post says "Item Delivered(Sender)" for the
 * same event, and a shared matcher would have to know both and would get one
 * of them wrong.
 */
export async function applyCarrierScan(
  scan: NormalisedScan,
  identity: { waybill?: string | null; reference?: string | null },
  { notify = true }: { notify?: boolean } = {}
): Promise<ScanOutcome | null> {
  const order = await findOrder(identity);
  if (!order) {
    // Not an error worth failing the request over — a courier pushes scans for
    // parcels we may have already archived, and a 500 makes them retry forever.
    console.warn("[Scan] no order for", identity);
    return null;
  }

  await recordScan(order.order_number, scan.description, scan.at);

  const next = scan.next;
  if (!next) return { order_number: order.order_number, moved_to: null };

  // Forward only. Both carriers replay scans — Delhivery pushes out of order,
  // and India Post's bulk tracking returns the whole history every time — so
  // without this a stale "Manifested" landing after "Delivered" would
  // un-deliver the parcel and void the referral commission with it.
  if (!canMoveTo(order.status, next)) {
    if (order.status !== next) {
      console.warn(
        `[Scan] ignoring ${next} for ${order.order_number} — already ${order.status}`
      );
    }
    return { order_number: order.order_number, moved_to: null };
  }

  const updated = await setDeliveryStatus([order.order_number], next);
  if (!updated.length) return { order_number: order.order_number, moved_to: null };

  // Same notification path as a tick in the portal, so the customer gets one
  // message about their parcel however we found out it had arrived — unless
  // this is a catch-up on history nobody was waiting to be told about.
  if (notify) await notifyStatusChange(updated, next);

  return { order_number: order.order_number, moved_to: next };
}

async function findOrder(identity: {
  waybill?: string | null;
  reference?: string | null;
}): Promise<{ order_number: string; status: string } | null> {
  const columns = "order_number,status";

  if (identity.reference) {
    const { data } = await supabaseAdmin
      .from("orders")
      .select(columns)
      .eq("order_number", identity.reference)
      .maybeSingle();
    if (data) return data as { order_number: string; status: string };
  }

  if (identity.waybill) {
    const { data } = await supabaseAdmin
      .from("orders")
      .select(columns)
      .eq("tracking_number", identity.waybill)
      .maybeSingle();
    if (data) return data as { order_number: string; status: string };
  }

  return null;
}

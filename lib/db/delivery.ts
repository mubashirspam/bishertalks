import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendOrderNotifications, type OrderEvent } from "@/lib/notify";
import { NOTIFY_STATUSES } from "@/lib/delivery-stage";
import { approveCommissions, voidCommissions } from "@/lib/db/referrals";
import { revalidateDelivery } from "@/lib/db/cache-tags";
import type { OrderStatus } from "@/lib/types/order";

/**
 * Bulk delivery mutations.
 *
 * Each is one RPC round trip (see migration 0005) rather than a loop of
 * updates: an admin selecting fifty parcels and clicking "Mark shipped" should
 * either move all fifty or none, and shouldn't wait fifty times.
 *
 * Every function returns the order numbers actually changed — rows outside the
 * shippable scope are silently skipped by the RPC, and the caller needs to know
 * what really happened before it starts messaging customers.
 */

async function rpc(fn: string, args: Record<string, unknown>): Promise<string[]> {
  const { data, error } = await supabaseAdmin.rpc(fn, args);
  if (error) {
    console.error(`[Delivery] ${fn} failed:`, error.message);
    throw new Error(error.message);
  }
  return (data ?? []) as string[];
}

/**
 * Record that address labels were printed. Called after the PDF is built.
 *
 * Records only — it does not move the parcel's status. Printing is how a batch
 * reaches an agent; packing it is the agent's tick in the portal (see 0020).
 */
export function markLabelsDownloaded(orderNumbers: string[]): Promise<string[]> {
  return rpc("mark_labels_downloaded", { p_order_numbers: orderNumbers });
}

/**
 * Confirm a whole sheet of parcels — "these addresses are now with the
 * courier" — and remember the reference number each one went out under.
 *
 * Called the moment the .xlsx is built, because building it *is* the entry:
 * the agent uploads that exact file to the courier. One statement for the
 * whole batch (migration 0024), so a sheet of fifty can never come back with
 * thirty confirmed and twenty still sitting in New.
 *
 * The two arrays are positional — references[i] belongs to orderNumbers[i].
 */
export function markCourierEntered(
  orderNumbers: string[],
  references: string[]
): Promise<string[]> {
  return rpc("mark_courier_entered", {
    p_order_numbers: orderNumbers,
    p_references: references,
  });
}

/** Undo a print, for a label that came out of the printer unusable. */
export function unmarkLabelsDownloaded(orderNumbers: string[]): Promise<string[]> {
  return rpc("unmark_labels_downloaded", { p_order_numbers: orderNumbers });
}

/**
 * Hand parcels to a delivery agent — or take them back with a null agent.
 *
 * This is what moves a parcel out of "New" and onto one agent's portal, and it
 * is the only way a parcel gets there. Returns the order numbers actually
 * assigned: the RPC skips anything outside the shippable scope, and the caller
 * needs the real count rather than the number of boxes that were ticked.
 */
export async function assignOrders(
  orderNumbers: string[],
  agentId: string | null,
  actorId: string | null
): Promise<string[]> {
  const assigned = await rpc("assign_orders", {
    p_order_numbers: orderNumbers,
    p_agent_id: agentId,
    p_actor_id: actorId,
  });

  // This is precisely what the sidebar badge counts — parcels nobody is
  // carrying yet — so the cached count is dropped here rather than in the two
  // routes that call this, where the second one to be written would forget.
  // Same placement rule as revalidateGift in lib/db/gift.ts.
  if (assigned.length) revalidateDelivery();

  return assigned;
}

/**
 * Change fulfilment status, and settle the referral consequences.
 *
 * Delivered approves any pending commission; cancelled and returned void it.
 * This is the one place all three happen, so no caller can move an order to
 * delivered without the commission following — and a commission is never
 * approved for a parcel that didn't actually arrive, or that came back.
 */
export async function setDeliveryStatus(
  orderNumbers: string[],
  status: OrderStatus,
  courierName?: string | null
): Promise<string[]> {
  const updated = await rpc("set_delivery_status", {
    p_order_numbers: orderNumbers,
    p_status: status,
    p_courier: courierName || null,
  });

  await settle(updated, status);
  return updated;
}

/**
 * The same, but recording when it actually happened.
 *
 * For a courier's own record read back afterwards rather than a tick made at
 * the moment of delivery. India Post's delivery export arrives with a week of
 * events in it; stamping NOW() on all of them would say every parcel in the
 * file arrived the instant somebody uploaded it, and `delivered_at` is what
 * the reports screen measures delivery time from. See migration 0059.
 *
 * `at` is per parcel, not per batch, because a thousand deliveries have a
 * thousand different times and one call per distinct timestamp is a thousand
 * round trips. A null `at` falls back to NOW() in SQL.
 *
 * Deliberately shares `settle` with `setDeliveryStatus` above: a parcel marked
 * delivered from a spreadsheet must settle the referral commission exactly as
 * one ticked off in the portal does. A second path that forgot would approve
 * nothing and nobody would notice for a month.
 */
export async function setDeliveryStatusAt(
  entries: { orderNumber: string; at: string | null }[],
  status: OrderStatus,
  courierName?: string | null
): Promise<string[]> {
  if (!entries.length) return [];

  const updated = await rpc("set_delivery_status_at", {
    p_order_numbers: entries.map((e) => e.orderNumber),
    p_status: status,
    p_at: entries.map((e) => e.at),
    p_courier: courierName || null,
  });

  await settle(updated, status);
  return updated;
}

/**
 * Move a delivery date BACK to when the courier says it happened.
 *
 * `set_delivery_status_at` deliberately never rewrites a milestone it already
 * has — `COALESCE(o.delivered_at, t.at, NOW())` — so re-uploading yesterday's
 * export cannot shuffle history. That is right for the normal path and it
 * leaves one hole: a parcel ticked off by hand, or marked delivered by a run
 * whose file carried no date, holds NOW() from the moment somebody noticed
 * rather than the moment it arrived. Their export knows better, and until it
 * is read back nothing ever corrects it.
 *
 * In the 01/09 report that was 38 parcels of 637 — every one of them recorded
 * LATER than the truth, none earlier, which is the signature of a date stamped
 * on noticing.
 *
 * ── Backwards only, and only across a day boundary ───────────────────────
 *
 * The caller decides which parcels qualify; this refuses to be the place that
 * silently rewrites history, so it writes only when the stored value is later
 * than the one offered. A courier event cannot postdate the delivery it
 * describes, so "ours is later" is the only direction that can be an error —
 * and moving a date forward on the strength of a spreadsheet is exactly the
 * mistake this guard exists to make impossible.
 *
 * Status is not touched, and neither is the referral commission: these parcels
 * are already delivered and already settled. This corrects when, never what.
 */
export async function correctDeliveredAt(
  entries: { orderNumber: string; at: string }[]
): Promise<string[]> {
  if (!entries.length) return [];

  const corrected: string[] = [];

  // One statement per parcel, because each carries its own timestamp. The
  // qualifying set is small by nature — it is the parcels somebody ticked off
  // by hand — so this is not the bulk path that needed SQL in 0059.
  const BATCH = 20;
  for (let i = 0; i < entries.length; i += BATCH) {
    await Promise.all(
      entries.slice(i, i + BATCH).map(async ({ orderNumber, at }) => {
        const { data, error } = await supabaseAdmin
          .from("orders")
          .update({ delivered_at: at, updated_at: new Date().toISOString() })
          .eq("order_number", orderNumber)
          // Still delivered, and still holding the later date the plan was
          // built from. Anything else changed under us and is not ours to fix.
          .eq("status", "delivered")
          .gt("delivered_at", at)
          .select("order_number");

        if (error) {
          console.error(`[Delivery] delivered_at fix ${orderNumber}:`, error.message);
          return;
        }
        if (data?.length) corrected.push(orderNumber);
      })
    );
  }

  return corrected;
}

/**
 * A file of courier scans, recorded in one statement.
 *
 * `recordScan` in lib/db/courier-send.ts writes one order per call, which is
 * right for a webhook: one push, one parcel. A courier's own tracking report is
 * two thousand parcels in one upload, and two thousand round trips does not
 * finish inside a serverless function's timeout.
 *
 * Records the movement and nothing else — no status is touched here. Most
 * parcels in such a file have not changed stage and recording them is still the
 * point: a row reading "Item Dispatched — Kozhikode RMS" is a parcel somebody
 * can stop worrying about, and the same parcel with a blank scan column is one
 * they ring the post office about.
 *
 * `tracking` fills in a waybill only where the order has none — see 0059. It
 * is how a parcel we booked under our own reference gets the courier's number
 * stored against it, which is what makes the customer's tracking page work.
 *
 * Returns the order numbers actually written.
 */
export function recordScans(
  scans: { orderNumber: string; scan: string; at: string | null; tracking?: string | null }[]
): Promise<string[]> {
  if (!scans.length) return Promise.resolve([]);

  return rpc("record_courier_scans", {
    p_order_numbers: scans.map((s) => s.orderNumber),
    p_scan: scans.map((s) => s.scan),
    p_at: scans.map((s) => s.at),
    p_tracking: scans.map((s) => s.tracking ?? null),
  });
}

/**
 * The referral consequence of a status change.
 *
 * Delivered approves any pending commission; cancelled and returned void it.
 * One place, so no path can move an order to delivered without the commission
 * following — and a commission is never approved for a parcel that did not
 * actually arrive, or that came back.
 */
async function settle(orderNumbers: string[], status: OrderStatus): Promise<void> {
  if (!orderNumbers.length) return;

  if (status === "delivered") {
    await approveCommissions(orderNumbers);
  } else if (status === "cancelled" || status === "returned") {
    // A parcel that came back was already 'delivered' for a while, so its
    // commission may have been approved. Voiding here is what takes it back.
    await voidCommissions(orderNumbers);
  }
}

/**
 * Tell customers about a status change.
 *
 * Only shipped and delivered are worth a message — the others are internal
 * bookkeeping. One batched call regardless of how many parcels: fifty selected
 * orders is one webhook to Make and one execution of its quota, not fifty.
 * Never rethrows — a WhatsApp outage must not make a completed status change
 * look like it failed.
 */
export function notifyStatusChange(
  orderNumbers: string[],
  status: OrderStatus
): Promise<number> {
  if (!NOTIFY_STATUSES.includes(status)) return Promise.resolve(0);

  return sendOrderNotifications(orderNumbers, status as OrderEvent);
}

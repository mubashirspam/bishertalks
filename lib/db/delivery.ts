import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendOrderNotifications, type OrderEvent } from "@/lib/notify";
import { NOTIFY_STATUSES } from "@/lib/delivery-stage";
import { approveCommissions, voidCommissions } from "@/lib/db/referrals";
import { revalidateDelivery } from "@/lib/db/cache-tags";
import { recordMovement } from "@/lib/db/inventory";
import { getCourier } from "@/lib/db/couriers";
import { getStaffById } from "@/lib/db/staff";
import { isStockLocation, type StockLocation } from "@/lib/stock-location";
import { audit } from "@/lib/audit";
import type { CurrentStaff } from "@/lib/admin-auth";
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
    // An unpaid COD order must never approve a commission on the strength of
    // "delivered" alone — collectCodPayment() pays it and delivers it in one
    // write for exactly this reason, but that is not the only path here: a
    // courier's own scan (lib/db/courier-scan.ts) reaches this same function
    // with no chance to ask first. Filtered here rather than left to the
    // caller, because this is the one place both paths actually meet.
    await approveCommissions(await excludingUnpaidCod(orderNumbers));
  } else if (status === "cancelled" || status === "returned") {
    // A parcel that came back was already 'delivered' for a while, so its
    // commission may have been approved. Voiding here is what takes it back.
    await voidCommissions(orderNumbers);
  }

  // Only 'returned' — a cancelled order never shipped, so book_stock never
  // counted it as gone and there is nothing to credit back (see
  // lib/db/inventory.ts's BookStock.cancelled).
  if (status === "returned") {
    await creditReturnedStock(orderNumbers);
  }
}

/** Drops any order that's COD and still unpaid — see the note above. Fails
 * open (returns the full list) on a read error: refusing every commission on
 * this batch because one lookup failed is a worse outcome than the rare case
 * this guard exists for. */
async function excludingUnpaidCod(orderNumbers: string[]): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("order_number, delivery_mode, payment_status")
    .in("order_number", orderNumbers);

  if (error) {
    console.error("[Delivery] unpaid-COD check failed, approving as-is:", error.message);
    return orderNumbers;
  }

  return (data as { order_number: string; delivery_mode: string | null; payment_status: string | null }[])
    .filter((o) => !(o.delivery_mode === "cod" && o.payment_status !== "paid"))
    .map((o) => o.order_number);
}

/**
 * Which shelf a returned order's stock credit belongs on.
 *
 * The exact rule `book_stock_by_location`'s own SQL uses — the
 * `order_location` CTE in migration 0069/0071 — reimplemented here because
 * `recordMovement` writes through the application layer, not the view. Kept
 * in sync by hand: if that CASE ever changes which courier or channel maps
 * to which shelf, this has to change with it, or a return credits the wrong
 * pile of books.
 */
async function orderStockLocation(order: {
  courier_id: string | null;
  sales_channel: string | null;
  manual_entered_by: string | null;
}): Promise<StockLocation | null> {
  if (order.courier_id) {
    const courier = await getCourier(order.courier_id);
    if (courier?.slug === "delhivery-sheet" || courier?.slug === "kkr-india-post") return "kkr";
    if (courier?.slug === "mubashir-logistic") return "mubashir";
  }
  if (order.sales_channel === "manual" && order.manual_entered_by) {
    const staffMember = await getStaffById(order.manual_entered_by);
    if (staffMember && isStockLocation(staffMember.stock_location)) return staffMember.stock_location;
  }
  return null;
}

/**
 * The other half of book_stock's "NOT stock again until someone says so"
 * (lib/db/inventory.ts) — this is what says so, the moment a parcel is
 * marked returned rather than on a separate trip to Inventory. One
 * `in_returned` movement per parcel, the same entry a person would make by
 * hand, so the log reads identically either way — credited to the same
 * shelf the parcel shipped from (0069/0071), not silently to the general
 * pool, so a KKR return puts the book back on KKR's own count.
 *
 * A copy that turns out to be damaged rather than sellable is corrected the
 * same way any other stock mistake is — an `out_damaged` entry afterward —
 * not by this function guessing at the parcel's condition.
 *
 * Best-effort: a failure here must not turn a completed return into a failed
 * status change. `recordMovement` already logs its own errors.
 */
async function creditReturnedStock(orderNumbers: string[]): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("order_number, quantity, courier_id, sales_channel, manual_entered_by")
    .in("order_number", orderNumbers);

  if (error) {
    console.error("[Delivery] could not read quantities for returned stock credit:", error.message);
    return;
  }

  for (const row of (data ?? []) as {
    order_number: string;
    quantity: number | null;
    courier_id: string | null;
    sales_channel: string | null;
    manual_entered_by: string | null;
  }[]) {
    const location = await orderStockLocation(row).catch((e) => {
      console.warn("[Delivery] shelf lookup failed for", row.order_number, e);
      return null;
    });
    const result = await recordMovement({
      kind: "in_returned",
      copies: Math.max(1, row.quantity ?? 1),
      reason: `Returned to us — ${row.order_number}`,
      orderNumber: row.order_number,
      location,
    });
    if (!result.ok) {
      console.error("[Delivery] stock credit failed for", row.order_number, result.error);
    }
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

export interface ReshipInput {
  /** null leaves the parcel unrouted for this attempt, same as a fresh order. */
  courierId: string | null;
  trackingNumber: string | null;
}

export type ReshipOutcome =
  | { ok: true; orderNumber: string }
  | { ok: false; error: string };

/**
 * Send a returned parcel out again.
 *
 * Deliberately not a status change through `setDeliveryStatus` — a reship
 * touches more than the status column, and the previous attempt's courier and
 * waybill are worth keeping rather than silently overwritten. They go into
 * the audit log as `order.reshipped`, which is also where the "how many times
 * has this round-tripped" trail comes from — no separate table to keep in
 * sync with it.
 *
 * Resets every column that describes how THIS attempt is going — waybill,
 * courier, and the API bookkeeping around it (entered/sent/checked/error) —
 * back to where a freshly routed parcel starts. `status` goes to 'confirmed'
 * rather than 'new', because somebody is actively working this, not leaving
 * it to be picked up.
 *
 * Only from 'returned': the `.eq("status", "returned")` on the write is the
 * guard against a race with another change to the same parcel, not just the
 * read above.
 */
export async function reshipOrder(
  orderNumber: string,
  input: ReshipInput,
  staff: CurrentStaff
): Promise<ReshipOutcome> {
  const { data: before, error: readError } = await supabaseAdmin
    .from("orders")
    .select("status, courier_id, tracking_number")
    .eq("order_number", orderNumber)
    .maybeSingle();

  if (readError) {
    console.error("[Delivery] reship read failed:", orderNumber, readError.message);
    return { ok: false, error: "Could not read that order." };
  }
  if (!before) return { ok: false, error: "Order not found" };
  if (before.status !== "returned") {
    return { ok: false, error: "Only a returned parcel can be reshipped." };
  }

  const [fromCourier, toCourier] = await Promise.all([
    before.courier_id ? getCourier(before.courier_id) : Promise.resolve(null),
    input.courierId ? getCourier(input.courierId) : Promise.resolve(null),
  ]);
  if (input.courierId && !toCourier) {
    return { ok: false, error: "That courier could not be found." };
  }

  const { error: writeError, data: written } = await supabaseAdmin
    .from("orders")
    .update({
      status: "confirmed",
      courier_id: input.courierId,
      tracking_number: input.trackingNumber,
      courier_entered_at: null,
      courier_sent_at: null,
      courier_checked_at: null,
      courier_send_error: null,
      transport_mode: null,
    })
    .eq("order_number", orderNumber)
    .eq("status", "returned")
    .select("order_number");

  if (writeError) {
    console.error("[Delivery] reship write failed:", orderNumber, writeError.message);
    return { ok: false, error: "Could not save the reship." };
  }
  if (!written?.length) {
    return { ok: false, error: "This parcel changed under you — reload and try again." };
  }

  await audit({
    actor: staff,
    action: "order.reshipped",
    entity: "order",
    entityId: orderNumber,
    meta: {
      from_courier: fromCourier?.name ?? null,
      from_tracking: before.tracking_number ?? null,
      to_courier: toCourier?.name ?? null,
      to_tracking: input.trackingNumber ?? null,
    },
  });

  revalidateDelivery();

  return { ok: true, orderNumber };
}

export type CollectCodOutcome =
  | { ok: true; orderNumber: string }
  | { ok: false; error: string };

/**
 * Confirm the courier collected cash on a COD parcel — and mark it delivered
 * in the same write, because for a COD sale those are the same physical
 * moment, not two separate ones somebody might tick apart.
 *
 * `payment_status` flips to 'paid' first, then the delivered transition runs
 * through the normal `setDeliveryStatus` — same commission approval, same
 * stock accounting, same customer WhatsApp every other delivered parcel gets.
 * The order matters: if the delivered write ran first, the commission-approval
 * half of `settle()` would fire against an order still reading unpaid.
 *
 * The plain "mark Delivered" tick must never reach this state on its own for
 * a COD order — see the guard in app/api/admin/delivery/portal/route.ts.
 */
export async function collectCodPayment(
  orderNumber: string,
  staff: CurrentStaff
): Promise<CollectCodOutcome> {
  const { data: before, error: readError } = await supabaseAdmin
    .from("orders")
    .select("delivery_mode, payment_status")
    .eq("order_number", orderNumber)
    .maybeSingle();

  if (readError) {
    console.error("[Delivery] COD read failed:", orderNumber, readError.message);
    return { ok: false, error: "Could not read that order." };
  }
  if (!before) return { ok: false, error: "Order not found" };
  if (before.delivery_mode !== "cod") {
    return { ok: false, error: "This order isn't cash on delivery." };
  }
  if (before.payment_status === "paid") {
    return { ok: false, error: "Already collected." };
  }

  const { error: writeError, data: written } = await supabaseAdmin
    .from("orders")
    .update({ payment_status: "paid" })
    .eq("order_number", orderNumber)
    .eq("delivery_mode", "cod")
    .neq("payment_status", "paid")
    .select("order_number");

  if (writeError) {
    console.error("[Delivery] COD collection failed:", orderNumber, writeError.message);
    return { ok: false, error: "Could not record the collection." };
  }
  if (!written?.length) {
    return { ok: false, error: "This order changed under you — reload and try again." };
  }

  await audit({
    actor: staff,
    action: "order.cod_collected",
    entity: "order",
    entityId: orderNumber,
  });

  await setDeliveryStatus([orderNumber], "delivered");

  return { ok: true, orderNumber };
}

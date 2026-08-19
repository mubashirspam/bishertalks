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

  if (status === "delivered") {
    await approveCommissions(updated);
  } else if (status === "cancelled" || status === "returned") {
    // A parcel that came back was already 'delivered' for a while, so its
    // commission may have been approved. Voiding here is what takes it back.
    await voidCommissions(updated);
  }

  return updated;
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

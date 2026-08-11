import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendOrderNotifications, type OrderEvent } from "@/lib/notify";
import { NOTIFY_STATUSES } from "@/lib/delivery-stage";
import { approveCommissions, voidCommissions } from "@/lib/db/referrals";
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

/** Record that address labels were printed. Called after the PDF is built. */
export function markLabelsDownloaded(orderNumbers: string[]): Promise<string[]> {
  return rpc("mark_labels_downloaded", { p_order_numbers: orderNumbers });
}

/** Undo a print, for a label that came out of the printer unusable. */
export function unmarkLabelsDownloaded(orderNumbers: string[]): Promise<string[]> {
  return rpc("unmark_labels_downloaded", { p_order_numbers: orderNumbers });
}

/**
 * Change fulfilment status, and settle the referral consequences.
 *
 * Delivered approves any pending commission; cancelled voids it. This is the
 * one place both happen, so no caller can move an order to delivered without
 * the commission following — and a commission is never approved for a parcel
 * that didn't actually arrive.
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
  } else if (status === "cancelled") {
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

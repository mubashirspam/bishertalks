/**
 * How a sale gets paid for — up front, or at the door.
 *
 * Two values, same shape as delivery-priority.ts: normal is the case that was
 * always true before this existed and gets no badge, cod is the exception
 * worth a person's attention every time it appears.
 *
 * Deliberately not a payment method alongside upi/cash/bank (see
 * lib/db/sales-channel.ts) — those describe money already received when a
 * direct sale is entered. COD describes money that has not arrived yet, and
 * that is a different fact with different consequences: it changes
 * `payment_status` at creation, it changes whether the order is queue-ready,
 * and it changes when a referral commission is allowed to approve. See
 * supabase/migrations/0067_cash_on_delivery.sql.
 */

export type DeliveryMode = "normal" | "cod";

export const DELIVERY_MODES: DeliveryMode[] = ["normal", "cod"];

export const DELIVERY_MODE_LABELS: Record<DeliveryMode, string> = {
  normal: "Prepaid",
  cod: "Cash on delivery",
};

export const DELIVERY_MODE_HINTS: Record<DeliveryMode, string> = {
  normal: "Paid at the counter, by UPI, or before this order was entered",
  cod: "Not paid yet — the courier collects cash when the parcel is handed over",
};

/** No badge for the ordinary case — a badge on every row is noise that makes
 * the COD ones harder to spot, not easier. Amber, not red: this is a normal
 * part of doing business, not a problem. */
export const DELIVERY_MODE_BADGE: Record<DeliveryMode, string> = {
  normal: "",
  cod: "bg-amber-100 text-amber-800 border-amber-200",
};

export function isDeliveryMode(v: unknown): v is DeliveryMode {
  return typeof v === "string" && (DELIVERY_MODES as string[]).includes(v);
}

/** What the database gave us, made safe to index with. A row written before
 * this existed, or by a path that never set it, reads as normal — which is
 * what it is. */
export function deliveryMode(v: unknown): DeliveryMode {
  return isDeliveryMode(v) ? v : "normal";
}

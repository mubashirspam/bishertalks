/**
 * Where a customer got to. Derived from the order row rather than stored, so it
 * can't drift out of sync with what actually happened.
 */
export type OrderStage =
  | "lead"
  | "payment_started"
  | "failed"
  | "paid_no_address"
  | "complete"
  /** Money went back through Razorpay (0055). Not the same as cancelled. */
  | "refunded"
  /** A confirmed direct sale, cash due when the courier hands it over — not
   * a payment that never started. See lib/delivery-mode.ts and 0067. */
  | "cod_pending";

interface StageInput {
  razorpay_order_id: string | null;
  payment_status: string;
  address_line1: string | null;
  /**
   * Required rather than optional on purpose: every caller has to supply it,
   * so a screen that forgets fails to compile instead of quietly filing
   * refunded orders under "Paid".
   */
  refunded_paise: number;
  /**
   * 'cod' | 'normal' | undefined — optional, unlike the fields above. A COD
   * sale is confirmed and simply hasn't been paid for yet, not a payment that
   * never started, and this is what tells the two apart. Optional because
   * every OTHER caller — online orders, existing screens that haven't loaded
   * the column — has no COD orders to misclassify: `delivery_mode` is only
   * ever 'cod' on a direct sale, and undefined here behaves exactly as it did
   * before this field existed.
   */
  delivery_mode?: string | null;
}

export function orderStage(o: StageInput): OrderStage {
  // Asked FIRST, because a refunded order is still payment_status = 'paid' —
  // that column records that the money landed and is deliberately not rewritten
  // when it goes back (see migration 0055). Asked any later, every refund would
  // be caught by the 'paid' arm below and this stage would never appear.
  //
  // ANY refund puts an order here, including a partial one. The alternative —
  // full refunds only — cannot be expressed as a PostgREST filter, because that
  // needs refunded_paise compared against amount_paise and filters compare a
  // column to a literal. A stage whose badge and whose SQL disagree is worse
  // than a broad one: the tab count would say 9 and the table would show 7.
  // How much came back is on the row itself, where "−₹200 refunded" reads
  // plainly next to the struck-through total.
  if (o.refunded_paise > 0) return "refunded";
  if (o.payment_status === "paid") {
    return o.address_line1 ? "complete" : "paid_no_address";
  }
  if (o.payment_status === "failed") return "failed";
  // Before the razorpay_order_id fallback below: a COD sale never has one —
  // it was never sent to Razorpay at all — and without this check it would
  // fall into "lead", which reads as nobody ever started paying. They did;
  // the shop just agreed to collect it later.
  if (o.delivery_mode === "cod") return "cod_pending";
  if (!o.razorpay_order_id) return "lead";
  return "payment_started";
}

export const STAGE_LABELS: Record<OrderStage, string> = {
  lead: "Payment not started",
  payment_started: "Payment started",
  failed: "Payment failed",
  paid_no_address: "Paid — needs address",
  complete: "Paid",
  refunded: "Refunded",
  cod_pending: "COD — cash on delivery",
};

export const STAGE_BADGE: Record<OrderStage, string> = {
  lead: "bg-neutral-100 text-neutral-600 border-neutral-200",
  payment_started: "bg-amber-50 text-amber-700 border-amber-200",
  failed: "bg-red-50 text-red-700 border-red-200",
  paid_no_address: "bg-orange-50 text-orange-700 border-orange-300",
  complete: "bg-green-50 text-green-700 border-green-200",
  // Rose rather than the red 'failed' wears: a failed payment is money that
  // never arrived and a refund is money that arrived and went back, and at a
  // glance down a column those must not look like the same thing.
  refunded: "bg-rose-50 text-rose-700 border-rose-300",
  // Blue rather than payment_started's amber on purpose: those two must not
  // look like the same kind of unpaid. One is a lead that might never
  // convert; this is a confirmed sale waiting on a courier, not a customer.
  cod_pending: "bg-blue-50 text-blue-700 border-blue-200",
};

/** Stages that need someone to act. Drives the admin's attention buckets. */
export const STAGE_NEEDS_ACTION: OrderStage[] = ["paid_no_address"];

/**
 * PostgREST filters for each stage, so the admin can query a bucket directly
 * instead of loading everything and filtering in memory.
 */
export function applyStageFilter<T extends {
  is: (col: string, val: null) => T;
  not: (col: string, op: string, val: null) => T;
  eq: (col: string, val: string | number) => T;
  neq: (col: string, val: string) => T;
  gt: (col: string, val: number) => T;
}>(query: T, stage: OrderStage): T {
  switch (stage) {
    case "lead":
      // Excludes COD explicitly, same reasoning as the paid buckets excluding
      // refunds below: a COD order also has no razorpay_order_id and is also
      // not payment_status = 'paid', so without this it would show up twice —
      // once here, once under its own tab. Mirrors orderStage()'s ordering,
      // and the two have to be changed together.
      return query
        .is("razorpay_order_id", null)
        .neq("payment_status", "paid")
        .neq("delivery_mode", "cod");
    case "payment_started":
      return query
        .not("razorpay_order_id", "is", null)
        .eq("payment_status", "pending");
    case "failed":
      return query.eq("payment_status", "failed");
    // The two paid buckets exclude refunds explicitly. They must: a refunded
    // order is still payment_status = 'paid', so without this it would be
    // counted twice — once here and once under Refunded — and the tabs would
    // add up to more than the order count. Mirrors the ordering in
    // orderStage(), and the two have to be changed together.
    case "paid_no_address":
      return query
        .eq("payment_status", "paid")
        .eq("refunded_paise", 0)
        .is("address_line1", null);
    case "complete":
      return query
        .eq("payment_status", "paid")
        .eq("refunded_paise", 0)
        .not("address_line1", "is", null);
    case "refunded":
      return query.gt("refunded_paise", 0);
    case "cod_pending":
      return query.eq("delivery_mode", "cod").neq("payment_status", "paid");
  }
}

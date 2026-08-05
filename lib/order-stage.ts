/**
 * Where a customer got to. Derived from the order row rather than stored, so it
 * can't drift out of sync with what actually happened.
 */
export type OrderStage =
  | "lead"
  | "payment_started"
  | "failed"
  | "paid_no_address"
  | "complete";

interface StageInput {
  razorpay_order_id: string | null;
  payment_status: string;
  address_line1: string | null;
}

export function orderStage(o: StageInput): OrderStage {
  if (o.payment_status === "paid") {
    return o.address_line1 ? "complete" : "paid_no_address";
  }
  if (o.payment_status === "failed") return "failed";
  if (!o.razorpay_order_id) return "lead";
  return "payment_started";
}

export const STAGE_LABELS: Record<OrderStage, string> = {
  lead: "Left before paying",
  payment_started: "Started payment",
  failed: "Payment failed",
  paid_no_address: "Paid — needs address",
  complete: "Complete",
};

export const STAGE_BADGE: Record<OrderStage, string> = {
  lead: "bg-neutral-100 text-neutral-600 border-neutral-200",
  payment_started: "bg-amber-50 text-amber-700 border-amber-200",
  failed: "bg-red-50 text-red-700 border-red-200",
  paid_no_address: "bg-orange-50 text-orange-700 border-orange-300",
  complete: "bg-green-50 text-green-700 border-green-200",
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
  eq: (col: string, val: string) => T;
  neq: (col: string, val: string) => T;
}>(query: T, stage: OrderStage): T {
  switch (stage) {
    case "lead":
      return query.is("razorpay_order_id", null).neq("payment_status", "paid");
    case "payment_started":
      return query
        .not("razorpay_order_id", "is", null)
        .eq("payment_status", "pending");
    case "failed":
      return query.eq("payment_status", "failed");
    case "paid_no_address":
      return query.eq("payment_status", "paid").is("address_line1", null);
    case "complete":
      return query.eq("payment_status", "paid").not("address_line1", "is", null);
  }
}

import type { OrderStatus } from "@/lib/types/order";

/**
 * Where a parcel is in the delivery queue.
 *
 * This is the post-payment half of order management. The funnel stage in
 * `lib/order-stage.ts` answers "did we get the money and the address"; this
 * answers "have we got the book to them". They never overlap: an order only
 * enters this queue once it's paid AND has an address.
 *
 * Derived from the row, not stored, for the same reason as the funnel stage —
 * a stored copy drifts the first time someone edits a row by hand.
 */
export type DeliveryStage =
  | "to_print"
  | "packed"
  | "shipped"
  | "out_for_delivery"
  | "delivered"
  | "cancelled";

interface StageInput {
  status: string;
  label_downloaded_at: string | null;
}

export function deliveryStage(o: StageInput): DeliveryStage {
  switch (o.status) {
    case "cancelled":
      return "cancelled";
    case "delivered":
      return "delivered";
    case "out_for_delivery":
      return "out_for_delivery";
    case "shipped":
      return "shipped";
    default:
      // 'confirmed' / 'processing' — printing the label is what separates them.
      return o.label_downloaded_at ? "packed" : "to_print";
  }
}

export const DELIVERY_LABELS: Record<DeliveryStage, string> = {
  to_print: "New — label not printed",
  packed: "Printed — ready to ship",
  shipped: "Shipped",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

/** Short form, for the table cell where the row already gives context. */
export const DELIVERY_SHORT: Record<DeliveryStage, string> = {
  to_print: "New",
  packed: "Printed",
  shipped: "Shipped",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

export const DELIVERY_BADGE: Record<DeliveryStage, string> = {
  to_print: "bg-orange-50 text-orange-700 border-orange-300",
  packed: "bg-blue-50 text-blue-700 border-blue-200",
  shipped: "bg-purple-50 text-purple-700 border-purple-200",
  out_for_delivery: "bg-amber-50 text-amber-700 border-amber-200",
  delivered: "bg-green-50 text-green-700 border-green-200",
  cancelled: "bg-red-50 text-red-700 border-red-200",
};

/** Queue tabs, in the order the work actually happens. */
export const DELIVERY_STAGES: DeliveryStage[] = [
  "to_print",
  "packed",
  "shipped",
  "out_for_delivery",
  "delivered",
  "cancelled",
];

export function isDeliveryStage(v: string | undefined): v is DeliveryStage {
  return !!v && (DELIVERY_STAGES as string[]).includes(v);
}

/** Statuses an admin may set in bulk from the delivery list. */
export const BULK_STATUSES: OrderStatus[] = [
  "processing",
  "shipped",
  "out_for_delivery",
  "delivered",
  "cancelled",
];

/** Statuses a bulk change should notify the customer about on WhatsApp. */
export const NOTIFY_STATUSES: OrderStatus[] = ["shipped", "delivered"];

/** Not yet handed to a courier. Used by two of the filters below. */
const PRE_SHIP = ["confirmed", "processing"];

/**
 * PostgREST filters for each queue stage, so a tab is one indexed query rather
 * than "load everything and filter in memory".
 *
 * `in` rather than `or` deliberately: the list already spends its one `or` on
 * the search box, and PostgREST combining two `or` params is easy to get wrong.
 */
export function applyDeliveryFilter<T extends {
  in: (col: string, vals: string[]) => T;
  is: (col: string, val: null) => T;
  not: (col: string, op: string, val: null) => T;
  eq: (col: string, val: string) => T;
}>(query: T, stage: DeliveryStage): T {
  switch (stage) {
    case "to_print":
      return query.in("status", PRE_SHIP).is("label_downloaded_at", null);
    case "packed":
      return query.in("status", PRE_SHIP).not("label_downloaded_at", "is", null);
    default:
      return query.eq("status", stage);
  }
}

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
 *
 * The first two stages are about *ownership*, not printing: a parcel is New
 * until someone hands it to a delivery agent, and Assigned once they have.
 * Printing a label is one way to do the handing over (see migration 0019), but
 * a printed sheet on its own says nothing about who is taking the parcel.
 */
export type DeliveryStage =
  | "new"
  | "assigned"
  | "shipped"
  | "out_for_delivery"
  | "delivered"
  | "cancelled"
  | "returned";

interface StageInput {
  status: string;
  assigned_agent_id: string | null;
}

export function deliveryStage(o: StageInput): DeliveryStage {
  switch (o.status) {
    case "returned":
      return "returned";
    case "cancelled":
      return "cancelled";
    case "delivered":
      return "delivered";
    case "out_for_delivery":
      return "out_for_delivery";
    case "shipped":
      return "shipped";
    default:
      // 'confirmed' / 'processing' — having an agent is what separates them.
      return o.assigned_agent_id ? "assigned" : "new";
  }
}

export const DELIVERY_LABELS: Record<DeliveryStage, string> = {
  new: "New — not assigned",
  assigned: "Assigned — ready to ship",
  shipped: "Shipped",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
  returned: "Returned to us",
};

/** Short form, for the table cell where the row already gives context. */
export const DELIVERY_SHORT: Record<DeliveryStage, string> = {
  new: "New",
  assigned: "Assigned",
  shipped: "Shipped",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
  returned: "Returned",
};

export const DELIVERY_BADGE: Record<DeliveryStage, string> = {
  new: "bg-orange-50 text-orange-700 border-orange-300",
  assigned: "bg-blue-50 text-blue-700 border-blue-200",
  shipped: "bg-purple-50 text-purple-700 border-purple-200",
  out_for_delivery: "bg-amber-50 text-amber-700 border-amber-200",
  delivered: "bg-green-50 text-green-700 border-green-200",
  cancelled: "bg-red-50 text-red-700 border-red-200",
  returned: "bg-rose-50 text-rose-700 border-rose-300",
};

/** Queue tabs, in the order the work actually happens. */
export const DELIVERY_STAGES: DeliveryStage[] = [
  "new",
  "assigned",
  "shipped",
  "out_for_delivery",
  "delivered",
  "returned",
  "cancelled",
];

export function isDeliveryStage(v: string | undefined): v is DeliveryStage {
  return !!v && (DELIVERY_STAGES as string[]).includes(v);
}

/** Statuses a status change should notify the customer about on WhatsApp. */
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
    case "new":
      return query.in("status", PRE_SHIP).is("assigned_agent_id", null);
    case "assigned":
      return query.in("status", PRE_SHIP).not("assigned_agent_id", "is", null);
    default:
      return query.eq("status", stage);
  }
}

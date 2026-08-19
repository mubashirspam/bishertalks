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
 * until it has been routed somewhere, and Assigned once it has.
 *
 * "Routed" used to mean a delivery agent, because a parcel was handed to a
 * person. It now means a courier. Reading only the agent left a parcel that had
 * been given to KKR, manifested at Delhivery and had a waybill sitting in the
 * queue as "New — not assigned", which is the opposite of true and exactly the
 * sort of thing that makes a screen untrustworthy.
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
  /** Who is carrying it (migration 0030). Either counts as routed. */
  courier_id?: string | null;
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
      // 'confirmed' / 'processing' — being routed is what separates them, and
      // a courier routes a parcel just as much as an agent does.
      return o.courier_id || o.assigned_agent_id ? "assigned" : "new";
  }
}

export const DELIVERY_LABELS: Record<DeliveryStage, string> = {
  new: "New — not routed",
  assigned: "Routed — with a courier",
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

/**
 * Filter a query to one queue stage.
 *
 * One equality, because `portal_orders` now derives `delivery_stage` itself
 * (migration 0045) from the same CASE that `deliveryStage()` above implements.
 *
 * It used to reassemble the stage out of raw columns — `status IN (…)` plus
 * null checks on the agent and the courier — which had to agree with
 * `deliveryStage()` by hand, and did not always: a tab could show a different
 * set from the badges on the rows inside it.
 *
 * It also fixes a live bug. The 'assigned' tab was expressed as
 * `.or("assigned_agent_id.not.is.null,courier_id.not.is.null")`, and the search
 * box uses the only other `or()` the query can safely carry — so searching
 * while on that tab could return the wrong rows. An equality cannot collide
 * with anything.
 *
 * Only valid against `portal_orders`. Querying `orders` directly gets no
 * derived columns — see the labels route, which reads the view for this reason.
 */
export function applyDeliveryFilter<T extends {
  eq: (col: string, val: string) => T;
}>(query: T, stage: DeliveryStage): T {
  return query.eq("delivery_stage", stage);
}

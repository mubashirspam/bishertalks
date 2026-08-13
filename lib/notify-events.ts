/**
 * The customer-facing events, and nothing else.
 *
 * Its own module so the template definitions, the sender and the notification
 * log can all agree on the list without any of them importing a provider. When
 * Make.com goes, this file does not move.
 */

export type OrderEvent =
  | "payment_received"
  | "confirmed"
  | "shipped"
  | "delivered"
  | "course_access";

export const ORDER_EVENTS: OrderEvent[] = [
  "payment_received",
  "confirmed",
  "shipped",
  "delivered",
  "course_access",
];

export function isOrderEvent(v: unknown): v is OrderEvent {
  return typeof v === "string" && (ORDER_EVENTS as string[]).includes(v);
}

/**
 * Internal name → the dotted name written to notification_log.
 *
 * Kept when sending moved to Meta: every historical row uses these, and
 * renaming them would split one message's history in two.
 */
export const WIRE_EVENT: Record<OrderEvent, string> = {
  payment_received: "payment.received",
  confirmed: "order.confirmed",
  shipped: "order.shipped",
  delivered: "order.delivered",
  course_access: "course.access",
};

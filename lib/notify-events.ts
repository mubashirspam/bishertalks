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

/**
 * Events that are written, approved, and deliberately NOT sent automatically.
 *
 * `payment_received` is held because its wording is wrong. The template is
 * approved by Meta — it is not blocked, it is withheld — and it will start
 * sending the moment its name is removed from this list, so nothing else has
 * to be re-wired when the copy is fixed.
 *
 * This was previously true by accident rather than by decision. The event only
 * fires for an order that has no address when payment is verified, and every
 * one of the 3,620 paid orders in the database has an address by then, so it
 * had never sent once. An accident is not a guarantee: a slow Magic Checkout
 * backfill or a change to the standard checkout would have started sending the
 * wrong message to real customers with nothing in the code to stop it.
 *
 * A held event still claims its idempotency key and still writes a log row, as
 * 'skipped' with the reason. It has to stay visible — an event that silently
 * vanished would be indistinguishable from one that was never triggered, which
 * is precisely the confusion that hid this for so long.
 */
export const HELD_EVENTS: OrderEvent[] = ["payment_received"];

export function isHeld(event: OrderEvent): boolean {
  return HELD_EVENTS.includes(event);
}

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

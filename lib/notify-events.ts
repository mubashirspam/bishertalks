/**
 * The customer-facing events, and nothing else.
 *
 * Its own module so the template definitions, the sender and the notification
 * log can all agree on the list without any of them importing a provider. When
 * Make.com goes, this file does not move.
 */

export type OrderEvent =
  | "confirmed"
  | "shipped"
  | "delivered"
  | "course_access";

export const ORDER_EVENTS: OrderEvent[] = [
  "confirmed",
  "shipped",
  "delivered",
  "course_access",
];

/**
 * Events that are written and deliberately NOT sent automatically.
 *
 * Empty today. The mechanism stays because withholding a message is a
 * different decision from deleting it, and doing it by commenting out a call
 * site is how a message comes back by accident six months later. Adding a name
 * here stops it at all three routes to the wire and logs the fact; removing
 * the name is the only step needed to start it again.
 *
 * `course_access` is the obvious candidate — Meta has rejected it twice, and
 * every attempt costs an API call and a failed row.
 */
export const HELD_EVENTS: OrderEvent[] = [];

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
  confirmed: "order.confirmed",
  shipped: "order.shipped",
  delivered: "order.delivered",
  course_access: "course.access",
};

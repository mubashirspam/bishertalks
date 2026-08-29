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
 * Withholding a message is a different decision from deleting it, and doing it
 * by commenting out a call site is how a message comes back by accident six
 * months later. Adding a name here stops it at every route to the wire and
 * logs the fact; removing the name is the only step needed to start it again.
 *
 * `course_access` is held as of 2026-08-29, and the reason is settled rather
 * than provisional: five templates have now been submitted for this one
 * message — `course_access`, `bonus_course_access`,
 * `neuro_order_confirm_track`, `course_order_confirmation` and the same body
 * again as MARKETING — and every one was auto-rejected as INCORRECT_CATEGORY
 * within seconds. Meta will not carry a course and a link on this account, in
 * either category.
 *
 * So the send was not failing occasionally; it could not succeed. Every
 * purchase was spending a Graph call to be refused and writing a failed row
 * that reads like an outage. Holding it says the true thing instead.
 *
 * Course access itself is unaffected — the grant is a database write, and the
 * customer can still reach the course by logging in with their mobile number.
 * Only the WhatsApp announcement is withheld. Lift this the day an appeal
 * succeeds, or the day it moves to email.
 */
export const HELD_EVENTS: OrderEvent[] = ["course_access"];

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

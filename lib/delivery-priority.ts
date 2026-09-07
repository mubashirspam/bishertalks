/**
 * How much of a hurry a parcel is in.
 *
 * Two values and no more. A three-point scale invites "medium", which is what
 * everything gets when somebody is entering forty sales and does not want to
 * think — and a flag that is true of most rows tells the packing table
 * nothing. Urgent has to be scarce to be worth printing.
 *
 * Stored on the order (migration 0063), not derived, because unlike
 * `deliveryStage` there is nothing to derive it from: it is a thing a person
 * knew at the counter and typed in.
 *
 * Deliberately independent of the courier. "Urgent" is what the buyer needs;
 * which service can actually deliver by then is the router's judgement, and
 * pinning urgency to Speed Post would mean the queue could not show a rush
 * parcel that went out with Delhivery because that is what was leaving today.
 */
export type DeliveryPriority = "normal" | "urgent";

export const DELIVERY_PRIORITIES: DeliveryPriority[] = ["normal", "urgent"];

export const PRIORITY_LABELS: Record<DeliveryPriority, string> = {
  normal: "Normal",
  urgent: "Urgent",
};

/** The one-line explanation the picker carries, so nobody has to guess. */
export const PRIORITY_HINTS: Record<DeliveryPriority, string> = {
  normal: "Goes out in the usual run",
  urgent: "Pack and hand over today — the buyer is waiting on a date",
};

/**
 * Red, and only for urgent.
 *
 * `normal` has no badge at all rather than a grey one: it is the state of
 * almost every row, and a badge on every row is a column of noise that makes
 * the few urgent ones harder to see, not easier.
 */
export const PRIORITY_BADGE: Record<DeliveryPriority, string> = {
  normal: "",
  urgent: "bg-red-100 text-red-800 border-red-200",
};

export function isDeliveryPriority(v: unknown): v is DeliveryPriority {
  return typeof v === "string" && (DELIVERY_PRIORITIES as string[]).includes(v);
}

/**
 * What the database gave us, made safe to index with.
 *
 * A row written before 0063, or by a path that does not set it, reads as
 * normal — which is what it is. Never throws: an unrecognised value is a
 * reason to show a parcel plainly, not to fail the page it is on.
 */
export function deliveryPriority(v: unknown): DeliveryPriority {
  return isDeliveryPriority(v) ? v : "normal";
}

import type { Courier } from "@/lib/couriers";

/**
 * What is actually happening to this parcel.
 *
 * `status` answers "where is it in the customer's journey". It cannot answer
 * "is it stuck, and whose problem is it" — a parcel reading Confirmed might be
 * unrouted, waiting on a sheet, refused by the courier, or one the courier
 * never received. Those need four different people to do four different things.
 *
 * So this is the second axis, derived from columns rather than stored, because
 * a stored copy is a thing that drifts. Every parcel has exactly one of these,
 * the order of the checks below is the priority order, and the last branch is
 * unreachable-by-construction rather than a default.
 *
 * The whole model, including why each state exists, is in
 * docs/delivery-states.md.
 */

export const HANDOVER_STATES = [
  "unrouted",
  "unserviceable",
  "checking",
  "ready",
  "send_failed",
  "held",
  "unconfirmed",
  "not_received",
  "with_courier",
  "handed_over",
  "legacy_unmatched",
] as const;

export type HandoverState = (typeof HANDOVER_STATES)[number];

/** What each state is called on screen, in an operator's words. */
export const HANDOVER_LABELS: Record<HandoverState, string> = {
  unrouted: "Not routed",
  unserviceable: "Not serviceable",
  checking: "Checking pincode",
  ready: "Ready to send",
  send_failed: "Send failed",
  held: "Held — check courier",
  unconfirmed: "Awaiting confirmation",
  not_received: "Not received",
  with_courier: "With the courier",
  handed_over: "Handed over",
  legacy_unmatched: "No reference",
};

/** The one line of explanation each needs, and the action it implies. */
export const HANDOVER_HINTS: Record<HandoverState, string> = {
  unrouted: "No courier chosen yet.",
  unserviceable: "This courier does not deliver to that pincode — route it to one that does.",
  checking: "We have not checked whether this courier reaches that pincode.",
  ready: "Routed and ready. Send it, or download the sheet.",
  send_failed: "The courier refused it. Fix what they named and send again.",
  held: "We never found out whether the send worked. Check the courier before sending again — it may already be there.",
  unconfirmed: "Handed over, but we have not yet asked the courier whether they have it.",
  not_received: "We asked, and the courier has no record of it. It never arrived.",
  with_courier: "The courier has it. Status comes from their scans.",
  handed_over: "Given to a courier who does not report back. Enter the tracking number by hand.",
  legacy_unmatched: "Shipped before reference numbers existed, so it cannot be matched automatically.",
};

/** Which need somebody to do something, for the "needs attention" filter. */
export const HANDOVER_NEEDS_ACTION: readonly HandoverState[] = [
  "unserviceable",
  "send_failed",
  "held",
  "not_received",
  "legacy_unmatched",
];

/**
 * Read off the row, never recomputed.
 *
 * The derivation lives in SQL (migration 0035, the `handover_state` column on
 * `portal_orders`) so that it can be filtered, counted and paged natively —
 * a state you can only compute in application code is a state you cannot work
 * from, because finding the seven parcels that need attention would mean
 * loading all of them.
 *
 * Keeping a second copy here would be a copy that drifts, so there is none.
 */
export function isHandoverState(v: unknown): v is HandoverState {
  return typeof v === "string" && (HANDOVER_STATES as readonly string[]).includes(v);
}

/** The subset worth surfacing as chips — the rest are reachable via "All". */
export const HANDOVER_CHIPS: readonly HandoverState[] = [
  "unrouted",
  "checking",
  "ready",
  "unconfirmed",
  "with_courier",
  "not_received",
  "unserviceable",
  "send_failed",
  "held",
  "handed_over",
  "legacy_unmatched",
];

/** Colours matching what each state means: green fine, amber waiting, red stuck. */
export const HANDOVER_TONE: Record<HandoverState, string> = {
  unrouted: "border-neutral-500 bg-neutral-100 text-neutral-800",
  checking: "border-blue-500 bg-blue-50 text-blue-700",
  ready: "border-blue-500 bg-blue-50 text-blue-700",
  unconfirmed: "border-amber-500 bg-amber-50 text-amber-800",
  with_courier: "border-green-600 bg-green-50 text-green-700",
  not_received: "border-red-600 bg-red-50 text-red-700",
  unserviceable: "border-red-600 bg-red-50 text-red-700",
  send_failed: "border-red-600 bg-red-50 text-red-700",
  held: "border-red-600 bg-red-50 text-red-700",
  handed_over: "border-neutral-500 bg-neutral-100 text-neutral-800",
  legacy_unmatched: "border-amber-500 bg-amber-50 text-amber-800",
};

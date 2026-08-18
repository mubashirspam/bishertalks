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

/** Only the columns the derivation reads — deliberately a narrow contract. */
export interface HandoverInput {
  courier_id: string | null;
  courier_reference: string | null;
  courier_entered_at: string | null;
  courier_sent_at: string | null;
  courier_send_error: string | null;
  courier_checked_at: string | null;
  tracking_number: string | null;
  pincode_serviceable: boolean | null;
}

const has = (v: string | null | undefined) => !!v && v.trim() !== "";

/**
 * The single decision. Order matters, and each branch is exclusive.
 *
 * `courier` is the row this parcel is routed to, or null. It is needed because
 * the same columns mean different things for different handoffs: a manual
 * courier will never produce a waybill, so "no waybill" is normal for it and a
 * problem for Delhivery.
 */
export function handoverState(
  order: HandoverInput,
  courier: Courier | null,
  { canTrack = false }: { canTrack?: boolean } = {}
): HandoverState {
  // A waybill is proof the courier has it. Checked first because it settles
  // the question outright, whatever else the row says.
  if (has(order.tracking_number)) return "with_courier";

  if (!order.courier_id || !courier) return "unrouted";

  // Cannot be delivered by this courier — nothing else about the row matters
  // until someone re-routes it.
  if (order.pincode_serviceable === false) return "unserviceable";

  // A send we started and could not confirm. Above every other error state,
  // because it is the only one where doing the obvious thing (retry) is wrong.
  if (has(order.courier_send_error) && has(order.courier_sent_at)) return "held";
  if (has(order.courier_send_error)) return "send_failed";

  // A courier that never reports back. Its parcels are done from our side the
  // moment they are handed over, so they must not sit in "awaiting" forever.
  if (!canTrack) {
    return has(order.courier_entered_at) ? "handed_over" : "ready";
  }

  // Trackable courier, no waybill. Three different reasons, three actions.
  if (!has(order.courier_entered_at)) {
    // Not handed over yet. Unrouted-but-serviceable is the normal resting
    // state of a fresh assignment; "checking" only if nobody has looked.
    if (order.pincode_serviceable === null) return "checking";
    return "ready";
  }

  // Handed over, and the courier has no waybill for us.
  if (!has(order.courier_reference)) return "legacy_unmatched";
  return has(order.courier_checked_at) ? "not_received" : "unconfirmed";
}

/**
 * What a person did about a lead.
 *
 * Kept apart from `payment_status` (what the payment gateway told us) and
 * `status` (where the parcel is). Those two are facts the system observes;
 * this is a human's note about a conversation, and merging them would make
 * "cancelled" mean two different things depending on who set it.
 *
 * Only meaningful for orders that aren't paid — a paid order needs shipping,
 * not chasing.
 */
export type FollowUpStatus =
  | "contacted"
  | "connected"
  | "not_responded"
  | "converted"
  | "already_purchased"
  | "not_interested";

/** Dropdown order — roughly how a call goes, ending in the ways it can close. */
export const FOLLOW_UP_STATUSES: FollowUpStatus[] = [
  "contacted",
  "connected",
  "not_responded",
  "converted",
  "already_purchased",
  "not_interested",
];

export const FOLLOW_UP_LABELS: Record<FollowUpStatus, string> = {
  contacted: "Followed up",
  connected: "Connected — spoke to them",
  not_responded: "Not responded",
  converted: "Converted — ordered",
  already_purchased: "Already purchased",
  not_interested: "Not interested",
};

/** Shorter, for the row where the rest of the line gives context. */
export const FOLLOW_UP_SHORT: Record<FollowUpStatus, string> = {
  contacted: "Followed up",
  connected: "Connected",
  not_responded: "Not responded",
  converted: "Converted",
  already_purchased: "Already bought",
  not_interested: "Not interested",
};

export const FOLLOW_UP_BADGE: Record<FollowUpStatus, string> = {
  contacted: "bg-blue-50 text-blue-700 border-blue-200",
  // Reached them, no answer yet — deliberately not green, which is reserved
  // for the one outcome that earned money.
  connected: "bg-indigo-50 text-indigo-700 border-indigo-200",
  // Amber because it is the one state that means "do something again".
  not_responded: "bg-amber-50 text-amber-700 border-amber-200",
  converted: "bg-green-50 text-green-700 border-green-200",
  already_purchased: "bg-neutral-100 text-neutral-600 border-neutral-200",
  not_interested: "bg-red-50 text-red-700 border-red-200",
};

export function isFollowUpStatus(v: string | null | undefined): v is FollowUpStatus {
  return !!v && (FOLLOW_UP_STATUSES as string[]).includes(v);
}

/**
 * Statuses that mean "stop chasing this one".
 *
 * Converted and already-purchased are both finished, for opposite reasons —
 * one is a win, the other a duplicate — and not-interested is a no. The other
 * three are all still open: you're waiting to hear back (contacted,
 * connected), or nobody has heard anything yet (not_responded).
 */
export const FOLLOW_UP_CLOSED: FollowUpStatus[] = [
  "converted",
  "already_purchased",
  "not_interested",
];

/** The filter options offered in the admin, including the two derived ones. */
export const FOLLOW_UP_FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "Any follow-up" },
  { value: "none", label: "Not contacted yet" },
  ...FOLLOW_UP_STATUSES.map((s) => ({ value: s, label: FOLLOW_UP_LABELS[s] })),
];

/**
 * What happened to one parcel during a routing run.
 *
 * The run used to report four numbers — routed, sent, held, failed — and a list
 * of refusals. That is enough to know a run went badly and not enough to know
 * what to do about it, because the interesting cases are per parcel and they
 * are not all the same kind of thing:
 *
 *   a parcel the courier refused          → send it somewhere else
 *   a parcel the courier already had      → nothing, it was already fine
 *   a parcel accepted but not written down → nothing at the courier, fix here
 *   a parcel whose outcome nobody knows   → ask the courier before touching it
 *
 * Lumping the last two in with the first — which is what pushing them into
 * `failed` did — tells someone to pick a different courier for a parcel that is
 * already on a van. So the outcome is a named thing shared by the route that
 * decides it and the screen that draws it, rather than a shape each end guesses.
 */

export const ROUTE_OUTCOMES = [
  "sent",
  "adopted",
  "save_failed",
  "refused",
  "unserviceable",
  "held",
  "routed",
  "skipped",
  "cleared",
] as const;

export type RouteOutcome = (typeof ROUTE_OUTCOMES)[number];

export interface ParcelOutcome {
  order_number: string;
  outcome: RouteOutcome;
  /** Present whenever the parcel is at the courier, however it got there. */
  waybill: string | null;
  /** The courier's wording, or ours when we are the ones who failed. */
  error: string | null;
}

interface OutcomeShape {
  /** Two or three words, for the chip on the row. */
  label: string;
  /** Drives colour. Nothing else branches on it. */
  tone: "good" | "warn" | "bad" | "neutral";
  /**
   * Is the shipment at the courier right now?
   *
   * The single most important bit in this file. Anything true here must never
   * be offered a second send — that is how one book becomes two parcels.
   */
  atCourier: boolean;
  /**
   * Would asking the courier again resolve this?
   *
   * True only where we genuinely do not know, or know but failed to store it.
   * Sync is the tool: it asks by order number, learns the waybill and clears
   * the hold. See app/api/admin/delivery/courier-sync/route.ts.
   */
  recheck: boolean;
  /** Safe to route to a different courier and send afresh. */
  reassignable: boolean;
  /** What the row says under the chip when there is no courier message. */
  detail: string;
}

export const OUTCOME: Record<RouteOutcome, OutcomeShape> = {
  sent: {
    label: "Sent",
    tone: "good",
    atCourier: true,
    recheck: false,
    reassignable: false,
    detail: "Created at the courier and the waybill is saved.",
  },
  adopted: {
    label: "Already there",
    tone: "good",
    atCourier: true,
    recheck: false,
    reassignable: false,
    detail:
      "The courier already had this shipment — we took their waybill instead " +
      "of creating a second one.",
  },
  save_failed: {
    label: "Sent — not saved",
    tone: "warn",
    atCourier: true,
    recheck: true,
    reassignable: false,
    detail:
      "The courier accepted it but we could not store the waybill. The parcel " +
      "is with them; only our record is behind.",
  },
  refused: {
    label: "Refused",
    tone: "bad",
    atCourier: false,
    recheck: false,
    reassignable: true,
    detail: "The courier said no. Nothing was created.",
  },
  unserviceable: {
    label: "Not serviced",
    tone: "bad",
    atCourier: false,
    recheck: false,
    reassignable: true,
    detail: "The courier does not deliver to this pincode, so it was not offered.",
  },
  held: {
    label: "Held",
    tone: "warn",
    atCourier: false,
    recheck: true,
    reassignable: false,
    detail:
      "We never learned the outcome. It may well be at the courier, so it is " +
      "held rather than retried.",
  },
  routed: {
    label: "Routed",
    tone: "neutral",
    atCourier: false,
    recheck: false,
    reassignable: true,
    detail: "The courier is set. Nothing was handed over.",
  },
  skipped: {
    label: "Skipped",
    tone: "neutral",
    atCourier: true,
    recheck: false,
    reassignable: false,
    detail: "Already with a courier — a parcel in transit keeps the courier carrying it.",
  },
  cleared: {
    label: "Cleared",
    tone: "neutral",
    atCourier: false,
    recheck: false,
    reassignable: true,
    detail: "The courier was removed from this parcel.",
  },
};

/** Parcels a person still has to do something about, in the order it matters. */
const ATTENTION_ORDER: RouteOutcome[] = [
  "save_failed",
  "held",
  "refused",
  "unserviceable",
];

export function needsAttention(outcome: RouteOutcome): boolean {
  return ATTENTION_ORDER.includes(outcome);
}

/** Sort so the rows someone must act on are the ones they read first. */
export function byUrgency(a: ParcelOutcome, b: ParcelOutcome): number {
  const rank = (o: RouteOutcome) => {
    const i = ATTENTION_ORDER.indexOf(o);
    return i === -1 ? ATTENTION_ORDER.length : i;
  };
  return rank(a.outcome) - rank(b.outcome);
}

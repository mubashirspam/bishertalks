import { istDayEndUTC } from "@/lib/format-date";

/**
 * The 4th edition pre-booking.
 *
 * Every order taken from now is a pre-order against a print run that has not
 * arrived yet. (Background, not copy: the pages deliberately do not discuss the
 * previous edition — they say what is open, not what has closed.)
 *
 * That changes three promises the site makes, and they are gathered here rather
 * than typed into each screen, because the expensive failure is them
 * disagreeing: a checkout that says 12 days and a WhatsApp that says 5–7 is a
 * support call per order.
 *
 *   how long delivery takes   longer, because it is printing
 *   what arrives immediately  the NLP course, which does not wait for a van
 *   how long this price lasts until the end of Saturday
 *
 * The price itself is NOT here. It lives in the `courses` table and is changed
 * in admin like any other price — a launch price hard-coded in the source is
 * one nobody can change on a Sunday morning.
 */

/**
 * The campaign as the screens receive it — always resolved on the server.
 *
 * `live` is the reason this is a prop rather than a call: it compares against
 * the clock, and a client component working it out for itself would render one
 * answer during SSR and another after hydration.
 */
export type PreorderFacts = {
  live: boolean;
  /** "Saturday" — the day the launch price holds until. */
  day: string;
  /** "1 Sept" — when an order placed now should arrive. */
  arrivesBy: string;
  deliveryDays: number;
};

/** Which edition is being taken orders for. */
export const EDITION_NUMBER = 4;

/**
 * The delivery promise, in days, and deliberately not "business days".
 *
 * A pre-order waits on a print run rather than on a courier, and a reader
 * counting business days for a book that is being printed will arrive at a
 * different date than we will. Calendar days are the honest unit here.
 */
export const PREORDER_DELIVERY_DAYS = 12;

/**
 * The last IST day the launch price stands, as YYYY-MM-DD.
 *
 * WHEN THIS DATE PASSES the page stops promising the launch price by itself —
 * every "only until Saturday" line disappears and the urgency framing goes with
 * it. It does not change what anyone is charged: set the new price in admin.
 * Leaving this date in the past with the old price still in the table is safe;
 * the site simply stops calling ₹699 a deadline offer.
 */
export const LAUNCH_OFFER_LAST_DAY = "2026-08-22";

/** The instant the launch price stops being the launch price. */
export function launchOfferEndsAt(): Date {
  // Exclusive end of that IST calendar day — the same helper the admin date
  // filters use, so "Saturday" means the same midnight everywhere.
  return new Date(istDayEndUTC(LAUNCH_OFFER_LAST_DAY));
}

/**
 * Is the launch price still on?
 *
 * Takes `now` so the server can decide once and hand the answer to the client
 * as a prop. Letting the browser work it out would mean the server rendering
 * one answer and the browser another for anyone loading the page across
 * midnight — a hydration mismatch on the single most important line of copy.
 */
export function launchOfferIsLive(now: number = Date.now()): boolean {
  return now < launchOfferEndsAt().getTime();
}

/**
 * "Saturday" — the weekday the offer runs until.
 *
 * Built from the last day at NOON, not from `launchOfferEndsAt()`. That instant
 * is the exclusive end of Saturday, which is to say midnight on Sunday, and
 * asking it for a weekday name answers "Sunday" — the deadline named as the day
 * after the deadline. Noon cannot slide across a date boundary in either
 * direction, whatever the conversion.
 */
export function launchOfferDayLabel(): string {
  return new Date(`${LAUNCH_OFFER_LAST_DAY}T12:00:00+05:30`).toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
  });
}

/** "22 Aug" — the same deadline as a date, for where a weekday is too vague. */
export function launchOfferDateLabel(): string {
  return new Date(`${LAUNCH_OFFER_LAST_DAY}T12:00:00+05:30`).toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
  });
}

/**
 * The same deadline in Malayalam — "ശനിയാഴ്ച".
 *
 * Derived rather than typed into the copy, so moving LAUNCH_OFFER_LAST_DAY
 * moves every line that names the day. A hard-coded weekday in a Malayalam
 * string is the one nobody remembers to change, and it would be wrong in the
 * language most of these readers are actually reading.
 */
export function launchOfferDayLabelMl(): string {
  return new Date(`${LAUNCH_OFFER_LAST_DAY}T12:00:00+05:30`).toLocaleDateString("ml-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
  });
}

/** "ഓഗസ്റ്റ് 22" — the deadline as a date, in Malayalam. */
export function launchOfferDateLabelMl(): string {
  return new Date(`${LAUNCH_OFFER_LAST_DAY}T12:00:00+05:30`).toLocaleDateString("ml-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "long",
  });
}

/**
 * The date a pre-order placed now should arrive by.
 *
 * Calendar days from today, so the page answers "when will it come" with a date
 * rather than making the reader do the arithmetic.
 */
export function preorderArrivesBy(now: Date = new Date()): string {
  const by = new Date(now.getTime() + PREORDER_DELIVERY_DAYS * 864e5);
  return by.toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
  });
}

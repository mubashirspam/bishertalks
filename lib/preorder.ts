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

/**
 * The instant the launch price stops being the launch price.
 *
 * The FALLBACK, used when nothing is scheduled on the Checkout tab. Since 0048
 * the real answer is `price_effective_at` — the moment the price actually
 * changes — because a page promising a deadline that is not when the number
 * moves is worse than one that promises nothing. See `resolveOfferDeadline`.
 */
export function launchOfferEndsAt(): Date {
  // Exclusive end of that IST calendar day — the same helper the admin date
  // filters use, so "Saturday" means the same midnight everywhere.
  return new Date(istDayEndUTC(LAUNCH_OFFER_LAST_DAY));
}

/**
 * The deadline this page should actually name.
 *
 * `scheduledAt` is the pending price change, read from the Checkout tab by the
 * server component. When there is one it wins: the clock on the page and the
 * moment the customer starts being charged more are then the same instant by
 * construction, rather than two dates somebody has to remember to keep in step.
 *
 * A scheduled change whose moment has already passed is NOT a deadline — it is
 * history, and the page should stop counting to it. That is what the second
 * half of `launchOfferIsLive` reads.
 */
export function resolveOfferDeadline(scheduledAt: Date | null): Date {
  return scheduledAt ?? launchOfferEndsAt();
}

/**
 * Is the launch price still on?
 *
 * Takes `now` so the server can decide once and hand the answer to the client
 * as a prop. Letting the browser work it out would mean the server rendering
 * one answer and the browser another for anyone loading the page across
 * midnight — a hydration mismatch on the single most important line of copy.
 */
export function launchOfferIsLive(
  now: number = Date.now(),
  deadline: Date = launchOfferEndsAt()
): boolean {
  return now < deadline.getTime();
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
export function launchOfferDayLabel(deadline: Date = launchOfferEndsAt()): string {
  return atNoonBefore(deadline).toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
  });
}

/**
 * Noon on the last day the offer stands, given the instant it ends.
 *
 * The deadline is the EXCLUSIVE end of a day — midnight — so asking it for a
 * weekday answers with the day after. Stepping back an hour lands inside the
 * final day, and noon of that day cannot slide across a date boundary in either
 * direction whatever the timezone conversion. Same trick the hardcoded version
 * used; it just has to work from an arbitrary instant now.
 */
function atNoonBefore(deadline: Date): Date {
  const istDay = new Date(deadline.getTime() - 3600_000).toLocaleDateString("en-CA", {
    timeZone: "Asia/Kolkata",
  });
  return new Date(`${istDay}T12:00:00+05:30`);
}

/** "22 Aug" — the same deadline as a date, for where a weekday is too vague. */
export function launchOfferDateLabel(deadline: Date = launchOfferEndsAt()): string {
  return atNoonBefore(deadline).toLocaleDateString("en-IN", {
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
export function launchOfferDayLabelMl(deadline: Date = launchOfferEndsAt()): string {
  return atNoonBefore(deadline).toLocaleDateString("ml-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
  });
}

/** "ഓഗസ്റ്റ് 22" — the deadline as a date, in Malayalam. */
export function launchOfferDateLabelMl(deadline: Date = launchOfferEndsAt()): string {
  return atNoonBefore(deadline).toLocaleDateString("ml-IN", {
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

/**
 * The first day the 4th edition actually goes out, as YYYY-MM-DD.
 *
 * A date rather than the word "തിങ്കളാഴ്ച", for the same reason
 * LAUNCH_OFFER_LAST_DAY is a date: a weekday typed into a Malayalam string is
 * the line nobody remembers to touch, and it goes on promising "Monday" every
 * week after the one it meant.
 */
export const EDITION_DISPATCH_FROM = "2026-08-24";

/** "തിങ്കളാഴ്ച" — the day dispatch starts, in Malayalam. */
export function editionDispatchDayLabelMl(): string {
  // Noon, not midnight — the same trick launchOfferDayLabelMl() uses, so no
  // timezone conversion can slide the answer onto the neighbouring day.
  return new Date(`${EDITION_DISPATCH_FROM}T12:00:00+05:30`).toLocaleDateString("ml-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
  });
}

/**
 * What the 4th edition will cost once the pre-order window closes, in rupees.
 *
 * NOT what anyone is charged. That is the scheduled price on the Checkout tab
 * (`checkout_settings.next_book_offer_rupees`, migration 0048), and it is what
 * customers actually pay the moment it lands. This constant is only the number
 * quoted back to a buyer who has ALREADY paid, to tell them what they are not
 * being asked for.
 *
 * KEEP IT MATCHED to the scheduled price. It is not read from the database
 * because the message is built synchronously inside admin client components,
 * and threading a database read through them to quote a figure at somebody who
 * has already been charged is not worth what it would cost. It is the one
 * number here a person has to keep in step by hand.
 */
export const NEXT_EDITION_PRICE = 749;

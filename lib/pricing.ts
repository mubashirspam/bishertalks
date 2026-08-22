/**
 * What the book costs, and when that changes.
 *
 * Split from lib/db/courses.ts the same way lib/gift.ts is split from
 * lib/db/gift.ts: this module is pure. No database client, no React cache, no
 * Next imports — which means the one function that decides what a customer is
 * charged can be reasoned about, and tested, on its own.
 *
 * That matters more here than anywhere else in the codebase. Everything below
 * ends in a real amount debited from a real card.
 */

export interface ProductPricing {
  /** Original price in whole rupees (the struck-through "MRP"). */
  price: number;
  /** Discounted price in whole rupees, or null if there's no offer. */
  offerPrice: number | null;
  /** What the customer pays before any promo, in whole rupees. */
  payable: number;
  /** Same as payable, in paise (for Razorpay / order amount). */
  payablePaise: number;
}

/**
 * The pricing row, exactly as stored (migration 0048).
 *
 * Two pairs and an instant. Which pair is in force is decided on read against
 * the clock — see `resolvePricing`.
 */
export interface PricingRow {
  book_price_rupees: number | null;
  book_offer_rupees: number | null;
  next_book_price_rupees: number | null;
  next_book_offer_rupees: number | null;
  price_effective_at: string | null;
}

/** Whole rupees from the env — the last-resort price this has always fallen to. */
export const envFallbackRupees = (): number =>
  Math.round(parseInt(process.env.BOOK_PRICE_PAISE || "49900", 10) / 100);

/**
 * Turn a price pair into the shape callers use.
 *
 * An offer only counts if it actually undercuts the price, so a stale higher
 * "offer" can never raise what somebody is charged.
 */
export function shapePair(price: number, offer: number | null): ProductPricing {
  const offerPrice = offer != null && offer < price ? offer : null;
  const payable = offerPrice ?? price;
  return { price, offerPrice, payable, payablePaise: payable * 100 };
}

/**
 * Which price is in force, right now.
 *
 * THIS IS THE SCHEDULE. Nothing fires at the appointed hour — there is no
 * scheduler in this deployment (vercel.json has no crons, and the courier
 * runbook says the same) and building the price on a job nobody has set up
 * would be building it on sand. Instead every read asks the clock, and the
 * pages that show a price are force-dynamic anyway.
 *
 * That is better than a job on every axis that matters: exact to the second,
 * impossible to miss, impossible to double-fire, and a moment set in the past
 * simply applies immediately.
 *
 * `now` is a parameter so the caller decides the instant. That is what lets the
 * cached path cache the ROW and still resolve fresh — see
 * `getCachedProductPricing` in lib/db/courses.ts.
 */
export function resolvePricing(
  row: PricingRow | null,
  now: number = Date.now()
): ProductPricing {
  const due =
    row?.price_effective_at != null &&
    row.next_book_price_rupees != null &&
    new Date(row.price_effective_at).getTime() <= now;

  if (due) {
    return shapePair(row!.next_book_price_rupees!, row!.next_book_offer_rupees);
  }

  return shapePair(
    row?.book_price_rupees ?? envFallbackRupees(),
    row?.book_offer_rupees ?? null
  );
}

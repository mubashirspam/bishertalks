/**
 * Gift wrapping.
 *
 * One place, because four things have to agree: the checkbox in the checkout,
 * the total shown beside it, the route that charges the card, and the packing
 * slip that tells someone to actually wrap the thing. If the browser could name
 * its own gift charge it could also name a charge of zero, so the fee is a
 * constant here and the server reads a boolean, never an amount.
 *
 * Flat per order, not per book: it is one parcel with one ribbon on it,
 * whether there are two copies inside or five.
 */

/** What wrapping costs, in paise. */
export const GIFT_WRAP_PAISE = 5_900;

/** The same number in whole rupees, for anything that renders a price. */
export const GIFT_WRAP_RUPEES = GIFT_WRAP_PAISE / 100;

/**
 * How long a message may be.
 *
 * It is hand-copied onto a card that fits inside a paperback. Past roughly this
 * much it stops fitting, and a message trimmed by the printer is worse than one
 * the customer was told to shorten.
 */
export const MAX_GIFT_MESSAGE = 120;

/** The fee this order owes. Takes the flag, never a client-supplied amount. */
export function giftChargePaise(isGift: unknown): number {
  return isGift === true ? GIFT_WRAP_PAISE : 0;
}

/**
 * Clean up a message before it is stored.
 *
 * Control characters and newlines are flattened because this ends up in a PDF
 * cell and a WhatsApp line, neither of which survives a customer pasting three
 * blank lines into it. Returns null for anything empty once trimmed, so the
 * column holds a message or nothing — never an empty string that reaches the
 * packing slip as a blank gift card someone still has to write out.
 */
export function sanitizeGiftMessage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_GIFT_MESSAGE);
  return cleaned || null;
}

/**
 * Gift wrapping.
 *
 * One place, because four things have to agree: the checkbox in the checkout,
 * the total shown beside it, the route that charges the card, and the packing
 * slip that tells someone to actually wrap the thing. If the browser could name
 * its own gift charge it could also name a charge of zero, so every function
 * here takes the settings as an argument and the server passes the ones it read
 * from the database — the client's copy is never trusted for a charge.
 *
 * Flat per order, not per book: it is one parcel with one ribbon on it,
 * whether there are two copies inside or five.
 *
 * The fee and the on/off switch are set in the admin (migration 0029). This
 * module holds the shape and the arithmetic; lib/db/gift.ts does the reading.
 */

export interface GiftSettings {
  /** Off hides the option at checkout. Orders already placed are unaffected. */
  isEnabled: boolean;
  /** What wrapping costs, in paise. */
  chargePaise: number;
}

/**
 * What wrapping costs when nobody has said otherwise.
 *
 * Matches the column defaults in migration 0029, and stands in when the
 * settings row cannot be read at all — a database blip should degrade to the
 * price we have always charged, not to free wrapping or to no gift option.
 */
export const DEFAULT_GIFT_SETTINGS: GiftSettings = {
  isEnabled: true,
  chargePaise: 5_900,
};

/**
 * The most the fee may be set to.
 *
 * Not a taste judgement — orders_gift_charge_check (migration 0027) refuses any
 * order whose gift_charge_paise is above this, so a fee set higher would be
 * priced at checkout and then rejected when the order row was written. Keep
 * this, the CHECK on gift_settings, and the one on orders in step.
 */
export const MAX_GIFT_CHARGE_PAISE = 100_000;

/** The same number in whole rupees, for anything that renders a price. */
export const giftRupees = (settings: GiftSettings): number =>
  Math.round(settings.chargePaise / 100);

/**
 * How long a message may be.
 *
 * It is hand-copied onto a card that fits inside a paperback. Past roughly this
 * much it stops fitting, and a message trimmed by the printer is worse than one
 * the customer was told to shorten.
 *
 * Fixed rather than configurable: it is a property of the card, not a price.
 */
export const MAX_GIFT_MESSAGE = 120;

/**
 * The fee this order owes.
 *
 * Takes the flag and the settings, never a client-supplied amount. Wrapping
 * switched off means zero whatever the browser sends — a page left open since
 * before it was turned off must not still be able to buy it.
 */
export function giftChargePaise(isGift: unknown, settings: GiftSettings): number {
  if (!settings.isEnabled) return 0;
  return isGift === true ? settings.chargePaise : 0;
}

/**
 * Is this order a gift, given what wrapping is doing today?
 *
 * The one place that decides, so the charge, the stored flag and the stored
 * message can never disagree about it — an order marked as a gift that was
 * charged nothing is a parcel somebody wraps for free.
 */
export function isGiftOrder(isGift: unknown, settings: GiftSettings): boolean {
  return isGift === true && settings.isEnabled;
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

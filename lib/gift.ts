/**
 * Gift wrapping, and the signed copies offered inside it.
 *
 * One place, because four things have to agree: the checkbox in the checkout,
 * the total shown beside it, the route that charges the card, and the packing
 * slip that tells someone to actually wrap the thing. If the browser could name
 * its own gift charge it could also name a charge of zero, so every function
 * here takes the settings as an argument and the server passes the ones it read
 * from the database — the client's copy is never trusted for a charge.
 *
 * Wrapping is flat per order — one parcel with one ribbon on it, whether there
 * are two copies inside or five.
 *
 * Signing costs nothing (migration 0041). It is a tick box inside the gift
 * option, not a second thing to sell: someone who has already paid to have a
 * parcel wrapped and a card written should be able to ask for the books to be
 * signed and watch the total not move. So it carries a flag and no money, and
 * nothing in this module prices it.
 *
 * It is still only ever offered with wrapping — an option inside the gift box,
 * not a third thing on the page. `isSignedOrder` is what enforces that, and
 * orders_signed_needs_gift_check (migration 0040) enforces it again at the
 * table, so neither a stale page nor a forged request can produce a signed
 * order that nobody was asked to wrap.
 *
 * The fee and both on/off switches are set in the admin (migrations 0029 and
 * 0040). This module holds the shape and the arithmetic; lib/db/gift.ts does
 * the reading.
 */

export interface GiftSettings {
  /** Off hides the option at checkout. Orders already placed are unaffected. */
  isEnabled: boolean;
  /** What wrapping costs, in paise. */
  chargePaise: number;
  /**
   * Off hides the signing option and leaves wrapping exactly as it was.
   *
   * Its own switch rather than a shared one, because the two become
   * unavailable for different reasons: nobody in the office to wrap parcels
   * this week is not the same as the author being away and unable to sign.
   *
   * There is no fee beside it. Signing is free — see the note at the top.
   */
  signedIsEnabled: boolean;
}

/**
 * What wrapping costs, and what is on offer, when nobody has said otherwise.
 *
 * Matches the column defaults in migrations 0029 and 0040, and stands in when
 * the settings row cannot be read at all — a database blip should degrade to
 * the price we have always charged, not to free wrapping or to no gift option.
 */
export const DEFAULT_GIFT_SETTINGS: GiftSettings = {
  isEnabled: true,
  chargePaise: 5_900,
  signedIsEnabled: true,
};

/**
 * The most the wrapping fee may be set to.
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
 * The wrapping fee this order owes.
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
 * Is this order getting signed copies?
 *
 * Three things have to hold, and this is the only place that checks all three:
 * the customer asked, signing is on offer, and the order is a gift at all.
 * That last one is what stops an untick of "make it a gift" leaving the signing
 * flag behind on a parcel with no wrapping and no card — the checkout hides the
 * sub-option the moment the box is cleared, but the browser still holds the old
 * value, and it is this function the server asks rather than the page.
 *
 * Nothing is charged either way. What this decides is what somebody has to do
 * to the parcel, which is why it is still worth getting exactly right.
 */
export function isSignedOrder(
  isSigned: unknown,
  isGift: unknown,
  settings: GiftSettings
): boolean {
  return (
    isSigned === true && settings.signedIsEnabled && isGiftOrder(isGift, settings)
  );
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

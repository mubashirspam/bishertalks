/**
 * What the checkout shows.
 *
 * Split from lib/db/checkout-settings.ts for the same reason lib/gift.ts is
 * split from lib/db/gift.ts: this module is imported by the checkout forms,
 * which are client components, and dragging the service-role client into that
 * import graph would put the database key in the browser bundle.
 *
 * One setting so far — whether the promo code field is offered — and the shape
 * exists so the next one does not need a second round trip to answer.
 */

export interface CheckoutSettings {
  /**
   * Show the "Promo code" field at checkout.
   *
   * Off hides it entirely. It does not disable the codes: they stay defined,
   * and start working again the moment this is switched back on. Nor does it
   * touch referrals, which are applied from the attribution cookie and never
   * from anything typed into that box.
   */
  promoFieldIsEnabled: boolean;
}

/**
 * What the checkout shows when nobody has said otherwise.
 *
 * Matches the column default in migration 0042, and stands in when the settings
 * row cannot be read at all. The honest fallback is the checkout we have always
 * shipped — a database blip should not silently take a field away from a
 * customer who is mid-purchase with a code in their hand.
 */
export const DEFAULT_CHECKOUT_SETTINGS: CheckoutSettings = {
  promoFieldIsEnabled: true,
};

/**
 * May this request apply a typed promo code?
 *
 * The one place that decides, so the field the customer sees and the discount
 * the server grants can never disagree. A page left open since before the field
 * was switched off still posts a `promoCode`, and this is what refuses it.
 *
 * Deliberately narrow: it answers only for codes somebody typed. Referral
 * discounts do not come through here and are unaffected.
 */
export function promoCodeAllowed(settings: CheckoutSettings): boolean {
  return settings.promoFieldIsEnabled;
}

/**
 * Magic Checkout is provisioned per-merchant by Razorpay. Until it's enabled on
 * the account, the Orders API rejects the integration outright:
 *
 *   BAD_REQUEST_ERROR — "one_click_checkout is/are not required and should not
 *   be sent" (reason: extra_field_sent)
 *
 * So the whole Magic Checkout path sits behind this flag. Off: the site keeps
 * using the existing Standard Checkout (address form + prepaid). On: Razorpay
 * collects the address and we backfill it after payment.
 *
 * Flip by setting NEXT_PUBLIC_MAGIC_CHECKOUT=true once Razorpay confirms Magic
 * Checkout is live on your account AND the platform is set to
 * "Custom E-Commerce Platform" with the shipping-info URL configured.
 *
 * NEXT_PUBLIC_ so the server route and the browser agree on which flow is
 * active — they must never disagree, or the order shape won't match the UI.
 */
export const MAGIC_CHECKOUT_ENABLED =
  process.env.NEXT_PUBLIC_MAGIC_CHECKOUT === "true";

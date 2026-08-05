import crypto from "crypto";

/**
 * HMAC token for the post-payment address link.
 *
 * The address form is reachable without a login, so the order number alone
 * can't authorise it — order numbers are short and guessable enough that
 * someone could enumerate them and read or overwrite another customer's
 * delivery address. The token proves the link came from us.
 */
function secret(): string {
  return (
    process.env.INTERNAL_API_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "dev-insecure-secret"
  );
}

export function signOrderToken(orderNumber: string): string {
  return crypto
    .createHmac("sha256", secret())
    .update(`address:${orderNumber}`)
    .digest("hex")
    .slice(0, 32);
}

/** Constant-time check that `token` was issued for `orderNumber`. */
export function verifyOrderToken(
  orderNumber: string,
  token: string | undefined | null
): boolean {
  if (!token) return false;
  const expected = signOrderToken(orderNumber);
  if (token.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

/** Full URL of the address form for an order. */
export function addressUrl(orderNumber: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || "https://bishertalks.com";
  return `${base}/neuro-code/address?id=${orderNumber}&t=${signOrderToken(orderNumber)}`;
}

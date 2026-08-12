/**
 * How many copies of the book are in an order.
 *
 * One place, because three of them have to agree: the stepper in the checkout,
 * the promo preview that prices the basket, and the order route that charges
 * the card. If the browser could name its own quantity, it could also name a
 * quantity of zero — or of 10,000 — so every entry point clamps through here
 * and the server's answer is the one that counts.
 *
 * The bonus course is deliberately not part of this. It's one login per
 * customer however many books they buy, so multiplying it would be selling
 * something that cannot be delivered twice.
 */

/** More than this is a wholesale order, and a conversation, not a checkout. */
export const MAX_BOOKS = 10;

export function clampQuantity(value: unknown): number {
  const n =
    typeof value === "number" ? value : parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return 1;
  return Math.min(Math.max(Math.trunc(n), 1), MAX_BOOKS);
}

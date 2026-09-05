/**
 * Which sales count as money, and the one place that is decided.
 *
 * A book can leave this shop two ways. Almost all of them go through the
 * checkout: Razorpay takes the payment, the webhook marks the order paid, and
 * the amount is part of a settlement that lands in the bank. A few are sold
 * directly — the customer scans a QR code, pays by UPI, and sends their
 * address over WhatsApp. Both produce a parcel. Only one produces a Razorpay
 * settlement.
 *
 * The shop's decision (migration 0061) is that the second kind is kept out of
 * every revenue, book and stock figure and reported on its own. The reason is
 * reconciliation: the dashboard's Total revenue is checked against Razorpay's
 * settlement statement, and a figure that silently mixes in money Razorpay
 * never saw cannot be checked against anything. It would not read as a
 * definition change, it would read as the dashboard being wrong.
 *
 * ── Why this module exists rather than an `.eq()` in each query ──
 *
 * There are seven separate places that sum money or count books, and they do
 * not look alike — some are Supabase queries, some reduce over rows already
 * fetched for another purpose. Spreading the rule across all seven means the
 * eighth one, written in six months by someone who has never read migration
 * 0061, silently reintroduces the bug. The rule lives here, is imported by
 * name, and says in one place what it is for.
 *
 * IMPORTANT: this is NOT `orders.source`. That column is attribution — where
 * the customer came from — and a manual sale has one of those too. Somebody
 * who saw an Instagram post and paid by UPI is `source = 'instagram'` and
 * `sales_channel = 'manual'`, and both facts are true at once.
 */

export const SALES_CHANNELS = ["online", "manual"] as const;
export type SalesChannel = (typeof SALES_CHANNELS)[number];

export function isSalesChannel(v: unknown): v is SalesChannel {
  return typeof v === "string" && (SALES_CHANNELS as readonly string[]).includes(v);
}

export const SALES_CHANNEL_LABELS: Record<SalesChannel, string> = {
  online: "Online checkout",
  manual: "Direct sale",
};

/** How the money arrived on a direct sale. */
export const MANUAL_PAYMENT_METHODS = ["upi", "cash", "bank", "other"] as const;
export type ManualPaymentMethod = (typeof MANUAL_PAYMENT_METHODS)[number];

export function isManualPaymentMethod(v: unknown): v is ManualPaymentMethod {
  return (
    typeof v === "string" && (MANUAL_PAYMENT_METHODS as readonly string[]).includes(v)
  );
}

export const MANUAL_PAYMENT_LABELS: Record<ManualPaymentMethod, string> = {
  upi: "UPI / QR code",
  cash: "Cash",
  bank: "Bank transfer",
  other: "Other",
};

/**
 * The filter every money, book and stock query must carry.
 *
 * Written as a column/value pair rather than a helper that takes a query,
 * because the callers are not all Supabase builders — some of them are reduces
 * over rows fetched for another purpose, and those need the same rule in a
 * shape they can use. `REVENUE_SCOPE.column` is what goes in a `.select()`;
 * `countsAsRevenue(row)` is what filters an array.
 */
export const REVENUE_SCOPE = {
  column: "sales_channel",
  value: "online" satisfies SalesChannel,
} as const;

/**
 * Narrow a Supabase query to the sales that count as revenue.
 *
 *     const { data } = await onlineOnly(
 *       supabaseAdmin.from("orders").select("amount_paise").eq("payment_status", "paid")
 *     );
 *
 * Generic over the builder so it can sit anywhere in a chain without the
 * caller losing the query's type.
 */
export function onlineOnly<T extends { eq(column: string, value: string): T }>(
  query: T
): T {
  return query.eq(REVENUE_SCOPE.column, REVENUE_SCOPE.value);
}

/**
 * Does this row's money belong in a revenue figure?
 *
 * Tolerates a missing column deliberately. A query written before 0061 that
 * does not select `sales_channel` yields `undefined` here, and treating that as
 * revenue keeps the pre-existing behaviour of every such caller rather than
 * silently zeroing a dashboard the day this ships. New callers select the
 * column; old ones keep working until they are moved over.
 */
export function countsAsRevenue(row: { sales_channel?: string | null }): boolean {
  return row.sales_channel !== "manual";
}

/** The complement, for the direct-sale figures reported on their own. */
export function isDirectSale(row: { sales_channel?: string | null }): boolean {
  return row.sales_channel === "manual";
}

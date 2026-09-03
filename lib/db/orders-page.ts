import { cache } from "react";
import { buildOrdersQuery } from "@/lib/db/orders-query";
import {
  buildDeliveryQuery,
  parseDeliveryFilters,
  type DeliveryFilters,
} from "@/lib/db/delivery-query";

/**
 * Page fetches, memoised for the duration of one request.
 *
 * These exist so a screen can stream in pieces without querying twice. The
 * orders table and the "N orders matching" line in the filter bar are rendered
 * by separate Suspense boundaries, but both call the same function with the
 * same arguments — React's `cache` collapses that into a single database round
 * trip, and both boundaries resolve from it.
 *
 * Arguments are primitives on purpose. `cache` keys on argument identity, so
 * passing a filters object would create a new key on every call and quietly
 * double the queries — the exact problem this is meant to avoid.
 */
export const fetchOrdersPage = cache(async function fetchOrdersPage(
  stage: string | undefined,
  q: string | undefined,
  from: string | undefined,
  to: string | undefined,
  source: string | undefined,
  followUp: string | undefined,
  books: string | undefined,
  pageNum: number,
  perPage: number
) {
  const { data, count, error } = await buildOrdersQuery({
    stage, q, from, to, source, followUp, books,
  }).range(
    pageNum * perPage,
    (pageNum + 1) * perPage - 1
  );

  if (error) console.error("[Orders] query failed:", error.message);

  return { rows: (data ?? []) as unknown as OrdersPageRow[], count: count ?? 0 };
});

export interface OrdersPageRow {
  id: string;
  order_number: string;
  buyer_name: string | null;
  buyer_phone: string | null;
  amount_paise: number;
  quantity: number;
  is_gift: boolean;
  is_signed: boolean;
  payment_status: string;
  /** Sent back through Razorpay (0055). 0 on every order never refunded. */
  refunded_paise: number;
  address_line1: string | null;
  razorpay_order_id: string | null;
  city: string | null;
  state: string | null;
  created_at: string;
  paid_at: string | null;
  ordered_at: string;
  source: string | null;
  utm_campaign: string | null;
}

/** Same trick for the delivery queue. */
export const fetchDeliveryPage = cache(async function fetchDeliveryPage(
  /**
   * Every filter, as a canonical query string — `stage=all&gift=yes&…`.
   *
   * One argument rather than one per filter, and a string because `cache` keys
   * on argument identity: an object would be a fresh key on every call and
   * quietly double the queries, which is the whole reason this module exists.
   *
   * It used to take the filters as eight positional primitives, and `courier`
   * and `handover` were never among them — so choosing a courier moved the tab
   * counts and the stats strip, which read the filters directly, while the rows
   * underneath ignored it. Adding a filter now means adding it to
   * `parseDeliveryFilters` and nowhere else; there is no second list to forget.
   */
  filterKey: string,
  pageNum: number,
  perPage: number
) {
  // Defaulting is `parseDeliveryFilters`' job — it's what the tab counts and
  // the label PDF already go through. This function used to re-derive the
  // default itself, and when the default flipped to newest-first the copy
  // here didn't: picking "Newest first" clears the ?sort param, the stale
  // fallback read the absent value as "oldest", and the sort silently never
  // worked. One source of truth, so it can't drift again.
  const filters: DeliveryFilters = parseDeliveryFilters(
    new URLSearchParams(filterKey)
  );

  const { data, count, error } = await buildDeliveryQuery(filters).range(
    pageNum * perPage,
    (pageNum + 1) * perPage - 1
  );

  if (error) console.error("[Delivery] query failed:", error.message);

  return { rows: data ?? [], count: count ?? 0, filters };
});

/**
 * The filter half of a search-params object, as a stable string.
 *
 * Sorted, so two URLs carrying the same filters in a different order are one
 * cache key rather than two. `page` is dropped because it is not a filter —
 * leaving it in would make every page of the same query miss the memo.
 */
export function deliveryFilterKey(
  params: Record<string, string | undefined>
): string {
  const entries = Object.entries(params)
    .filter(([k, v]) => k !== "page" && v)
    .sort(([a], [b]) => a.localeCompare(b)) as [string, string][];
  return new URLSearchParams(entries).toString();
}

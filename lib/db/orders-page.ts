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
  pageNum: number,
  perPage: number
) {
  const { data, count, error } = await buildOrdersQuery({
    stage, q, from, to, source, followUp,
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
  payment_status: string;
  address_line1: string | null;
  razorpay_order_id: string | null;
  city: string | null;
  state: string | null;
  created_at: string;
  source: string | null;
  utm_campaign: string | null;
}

/** Same trick for the delivery queue. */
export const fetchDeliveryPage = cache(async function fetchDeliveryPage(
  stage: string | undefined,
  q: string | undefined,
  from: string | undefined,
  to: string | undefined,
  sort: string | undefined,
  pageNum: number,
  perPage: number
) {
  // Defaulting is `parseDeliveryFilters`' job — it's what the tab counts and
  // the label PDF already go through. This function used to re-derive the
  // default itself, and when the default flipped to newest-first the copy
  // here didn't: picking "Newest first" clears the ?sort param, the stale
  // fallback read the absent value as "oldest", and the sort silently never
  // worked. One source of truth, so it can't drift again.
  const filters: DeliveryFilters = parseDeliveryFilters({ stage, q, from, to, sort });

  const { data, count, error } = await buildDeliveryQuery(filters).range(
    pageNum * perPage,
    (pageNum + 1) * perPage - 1
  );

  if (error) console.error("[Delivery] query failed:", error.message);

  return { rows: data ?? [], count: count ?? 0, filters };
});

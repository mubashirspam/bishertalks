import { cache } from "react";
import { unstable_cache } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  applyDeliveryFilter,
  isDeliveryStage,
  DELIVERY_STAGES,
  type DeliveryStage,
} from "@/lib/delivery-stage";
import { istDayStartUTC, istDayEndUTC } from "@/lib/format-date";
import { DELIVERY_TAG, DELIVERY_CACHE_SECONDS } from "@/lib/db/cache-tags";

export interface DeliveryFilters {
  /** A DeliveryStage, or undefined / "all" for the whole queue. */
  stage?: string;
  q?: string;
  /** IST calendar dates, YYYY-MM-DD, both inclusive. */
  from?: string;
  to?: string;
  /** Newest first is the default, so the freshest orders surface immediately. */
  sort?: "oldest" | "newest";
  /** A staff id, or "none" for parcels nobody is carrying yet. */
  agent?: string;
  /** A courier id, or "none" for parcels with no courier chosen yet. */
  courier?: string;
  /** A handover_state value (0035) — what is actually happening to it. */
  handover?: string;
  /** Copies in the parcel: "multi" for 2+, "single" for exactly one, or "all". */
  books?: string;
  /** Gift wrapping: "yes" for gifts only, "no" for plain parcels, or "all". */
  gift?: string;
  /** Signed copies: "yes" for the ones that need signing, or "all". */
  signed?: string;
}

/** Shape of the columns selected below. */
export interface DeliveryRow {
  id: string;
  order_number: string;
  buyer_name: string | null;
  buyer_phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  district: string | null;
  state: string | null;
  pincode: string | null;
  amount_paise: number;
  quantity: number;
  /** Wrap it, and write the card the admin order page shows (0027). */
  is_gift: boolean;
  gift_message: string | null;
  /** Sign every copy before wrapping it (0040) — printed on the label. */
  is_signed: boolean;
  /** When it was paid (0043), and the order date derived from it. */
  paid_at: string | null;
  ordered_at: string;
  /**
   * Where the parcel is in the queue, derived by the view (0045).
   *
   * Read this rather than recomputing it from status/agent/courier — the view
   * is the one definition now, and the badge on a row must not be able to
   * disagree with the tab the row is sitting in.
   */
  delivery_stage: DeliveryStage;
  status: string;
  courier_name: string | null;
  tracking_number: string | null;
  label_downloaded_at: string | null;
  label_download_count: number;
  assigned_agent_id: string | null;
  assigned_at: string | null;
  courier_entered_at: string | null;
  /** Which logistics partner carries it, or null if undecided (0030). */
  courier_id: string | null;
  /** When their API accepted it — the tick beside the courier's name. */
  courier_sent_at: string | null;
  /** Why the last send failed, shown loudly on the row. */
  courier_send_error: string | null;
  /** The courier's latest scan, in their wording. */
  courier_last_scan: string | null;
  /** What is actually happening to it — see docs/delivery-states.md. */
  handover_state: string | null;
  courier_last_scan_at: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  created_at: string;
}

export const DELIVERY_COLUMNS =
  "id,order_number,buyer_name,buyer_phone,address_line1,address_line2,city,district,state,pincode," +
  "amount_paise,quantity,is_gift,gift_message,is_signed," +
  "status,courier_name,tracking_number,label_downloaded_at,label_download_count," +
  "assigned_agent_id,assigned_at,courier_entered_at," +
  "courier_id,courier_sent_at,courier_send_error," +
  "courier_last_scan,courier_last_scan_at,handover_state," +
  "shipped_at,delivered_at,created_at,paid_at,ordered_at,delivery_stage";

const isDate = (s?: string): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Guards the agent filter — an id off a URL goes straight into a query. */
const isUuid = (s?: string): s is string =>
  !!s && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/**
 * Single source of truth for the delivery queue, shared by the list, the label
 * PDF and the "select everything matching these filters" bulk actions — so
 * what you print is always exactly what you were looking at.
 *
 * The base scope is the definition of "shippable": paid, and we know where to
 * send it. Anything missing either belongs in the funnel at /admin/orders, not
 * here.
 */
export function buildDeliveryQuery(
  filters: DeliveryFilters,
  { countOnly = false, columns = DELIVERY_COLUMNS } = {}
) {
  // portal_orders rather than orders: same rows, plus the derived
  // handover_state the filters below need (migration 0035). Reading a view
  // costs nothing here — it is a projection, not a materialisation.
  let query = supabaseAdmin
    .from("portal_orders")
    .select(countOnly ? "id" : columns, { count: "exact", head: countOnly })
    .eq("payment_status", "paid")
    .not("address_line1", "is", null)
    .order("ordered_at", { ascending: filters.sort === "oldest" });

  if (isDeliveryStage(filters.stage)) {
    query = applyDeliveryFilter(query, filters.stage);
  }

  // "Whose parcels am I looking at" — the question the delivery page exists to
  // answer now that several agents work the same queue.
  if (filters.agent === "none") {
    query = query.is("assigned_agent_id", null);
  } else if (isUuid(filters.agent)) {
    query = query.eq("assigned_agent_id", filters.agent);
  }

  // The other half of "who is holding this parcel" — the agent carries it to
  // the courier, and the courier takes it from there. Same guard on the id,
  // for the same reason: it comes straight off a URL.
  if (filters.handover) query = query.eq("handover_state", filters.handover);

  if (filters.courier === "none") {
    query = query.is("courier_id", null);
  } else if (isUuid(filters.courier)) {
    query = query.eq("courier_id", filters.courier);
  }

  // What is physically in the parcel — the two things that change how it is
  // packed, and the reason someone filters this screen before a packing run.
  //
  // `quantity` is NOT NULL DEFAULT 1 and `is_gift` NOT NULL DEFAULT FALSE, so
  // plain comparisons catch every old row without an `or (... is null)` arm.
  if (filters.books === "multi") query = query.gte("quantity", 2);
  else if (filters.books === "single") query = query.eq("quantity", 1);

  if (filters.gift === "yes") query = query.eq("is_gift", true);
  else if (filters.gift === "no") query = query.eq("is_gift", false);

  if (filters.signed === "yes") query = query.eq("is_signed", true);

  // The dates are IST calendar days; ordered_at is UTC. Converted, or the
  // filter is 5h30m out and silently drops early-morning orders.
  //
  // ordered_at matches the orders list and the portal's ist_day. Every row in
  // this scope is paid, so for all of them ordered_at is the payment date.
  if (isDate(filters.from)) query = query.gte("ordered_at", istDayStartUTC(filters.from));
  if (isDate(filters.to)) query = query.lt("ordered_at", istDayEndUTC(filters.to));

  if (filters.q) {
    const q = filters.q.replace(/[%,()]/g, "");
    if (q) {
      query = query.or(
        `order_number.ilike.%${q}%,buyer_name.ilike.%${q}%,buyer_phone.ilike.%${q}%,pincode.ilike.%${q}%,tracking_number.ilike.%${q}%`
      );
    }
  }

  return query;
}

export type StageCounts = Record<string, number>;

/**
 * How many orders sit in each queue stage under the current date/search
 * filters. Shown on the tabs, because "what's waiting" is the first question
 * anyone opening this page has — and an empty tab you can see is faster than
 * one you have to click.
 */
export const deliveryStageCounts = cache(async function deliveryStageCounts(
  filters: DeliveryFilters
): Promise<StageCounts> {
  // One GROUP BY instead of eight COUNTs (migration 0045). The stage is not
  // passed: the tabs show what every stage holds under the *other* filters, so
  // narrowing to the selected one would make each tab report its own size.
  const { data, error } = await supabaseAdmin.rpc(
    "delivery_counts",
    scopeArgs(filters)
  );

  // Zeroes rather than a throw: the tabs are navigation, and a screen that
  // refuses to render because a badge failed is worse than a screen of zeroes.
  if (error) {
    console.error("[Delivery] stage counts failed:", error.message);
    return Object.fromEntries(["all", ...DELIVERY_STAGES].map((s) => [s, 0]));
  }

  const rows = (data ?? []) as { stage: string; n: number }[];

  // Every tab needs a number, including the empty ones the GROUP BY omits.
  const counts: StageCounts = Object.fromEntries(
    DELIVERY_STAGES.map((s) => [s, 0])
  );
  for (const row of rows) counts[row.stage] = Number(row.n) || 0;

  // Summed here rather than asked for, so the total can never disagree with the
  // parts it is displayed beside.
  counts.all = DELIVERY_STAGES.reduce((n, s) => n + (counts[s] ?? 0), 0);

  return counts;
});

/**
 * The filter arguments both aggregate functions take (migration 0045).
 *
 * Kept beside `buildDeliveryQuery` on purpose: these two are the pair that must
 * agree. Anything added to the query above has to be added here, to
 * `delivery_scope` in SQL, and to `parseDeliveryFilters` — and if it is missed,
 * the tab counts stop matching the rows inside the tab.
 *
 * `undefined` becomes null, which the SQL reads as "no filter".
 */
export function scopeArgs(filters: DeliveryFilters) {
  return {
    p_from: isDate(filters.from) ? istDayStartUTC(filters.from) : null,
    p_to: isDate(filters.to) ? istDayEndUTC(filters.to) : null,
    p_q: filters.q || null,
    p_agent: filters.agent || null,
    p_courier: filters.courier || null,
    p_handover: filters.handover || null,
    p_books: filters.books || null,
    p_gift: filters.gift || null,
    p_signed: filters.signed || null,
  };
}

/**
 * Parcels nobody is carrying yet — the sidebar's badge.
 *
 * Cached across requests, which the counts above deliberately are not. The
 * difference is who is asking: the tab counts belong to the delivery screen and
 * must agree with the rows beside them, while this one is a badge rendered by
 * the admin layout on *every* admin page.
 *
 * That made it the most-run query in the application. It counts through
 * `portal_orders` — a view with a join to `couriers` and a CASE expression — so
 * no index can help it, and it was paying that scan to draw a number next to a
 * nav item, on screens that have nothing to do with delivery.
 *
 * A minute stale is the right answer for a badge. `revalidateDelivery()` drops
 * it early when something actually moves.
 *
 * Lives here rather than in the layout so the layout holds no SQL, and so the
 * next thing that wants this number gets the cached one.
 */
export const countUnassignedParcels = unstable_cache(
  async (): Promise<number> => {
    const { count, error } = await buildDeliveryQuery(
      { stage: "new" },
      { countOnly: true }
    );

    // Not thrown: this feeds one badge, and an admin panel that 500s because a
    // count failed would be a far worse outcome than a missing number.
    if (error) {
      console.error("[Sidebar] new-parcel count failed:", error.message);
      return 0;
    }
    return count ?? 0;
  },
  ["delivery-unassigned-count"],
  { tags: [DELIVERY_TAG], revalidate: DELIVERY_CACHE_SECONDS }
);

/** Read filters off a URL / request, ignoring anything we don't recognise. */
export function parseDeliveryFilters(
  p: Pick<URLSearchParams, "get"> | Record<string, string | undefined>
): DeliveryFilters {
  const get = (k: string) =>
    typeof (p as URLSearchParams).get === "function"
      ? ((p as URLSearchParams).get(k) ?? undefined)
      : (p as Record<string, string | undefined>)[k];

  return {
    stage: get("stage"),
    q: get("q"),
    from: get("from"),
    to: get("to"),
    sort: get("sort") === "oldest" ? "oldest" : "newest",
    agent: get("agent"),
    courier: get("courier"),
    handover: get("handover"),
    books: get("books"),
    gift: get("gift"),
    signed: get("signed"),
  };
}

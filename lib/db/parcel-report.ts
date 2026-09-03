import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fetchAllRows, type PageResult } from "@/lib/db/paginate";
import {
  reportArgs,
  summaryArgs,
  bucketFor,
  type ReportFilters,
} from "@/lib/report-filters";
import type { DeliveryStage } from "@/lib/delivery-stage";

/**
 * Reading the reports screen.
 *
 * Three functions, all of them going through the one SQL scope in migration
 * 0058: the summary at the top, a page of rows for the table, and every
 * matching row for the export. That is the property worth protecting — a count
 * on this screen and the list behind it are the same query, so clicking a
 * number can never land on a list that disagrees with it.
 */

/** One parcel, as `report_scope` returns it. */
export interface ReportRow {
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
  refunded_paise: number;
  quantity: number;
  is_gift: boolean;
  is_signed: boolean;
  courier_id: string | null;
  assigned_agent_id: string | null;
  delivery_stage: DeliveryStage;
  handover_state: string | null;
  status: string;
  ordered_at: string;
  /** When the courier was chosen (0057) — the date this screen can filter on. */
  courier_assigned_at: string | null;
  assigned_at: string | null;
  courier_entered_at: string | null;
  courier_sent_at: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  returned_at: string | null;
  tracking_number: string | null;
  courier_reference: string | null;
  postal_barcode: string | null;
  /** Whole IST days from the order to its delivery, return, or now. */
  days_pending: number;
  /** Shipped to delivered, or shipped to now. Null if it never shipped. */
  days_in_transit: number | null;
  is_late: boolean;
}

export interface CourierStat {
  id: string;
  parcels: number;
  not_shipped: number;
  in_transit: number;
  delivered: number;
  returned: number;
  cancelled: number;
  late: number;
  avg_days: number | null;
}

export interface ReportAgentStat {
  id: string;
  parcels: number;
  holding: number;
  in_transit: number;
  delivered: number;
  returned: number;
  late: number;
}

export interface StateStat {
  name: string;
  parcels: number;
  delivered: number;
  returned: number;
  late: number;
  avg_days: number | null;
}

export interface TimeBucket {
  bucket: string;
  shipped: number;
  delivered: number;
}

export interface ReportSummary {
  headline: {
    parcels: number;
    late: number;
    not_shipped: number;
    in_transit: number;
    delivered: number;
    returned: number;
    cancelled: number;
    books: number;
    revenue_paise: number;
    avg_days: number | null;
    median_days: number | null;
  };
  totals: Record<string, number>;
  ageing: Record<string, number>;
  couriers: CourierStat[];
  agents: ReportAgentStat[];
  buckets: TimeBucket[];
  states: StateStat[];
  bucketUnit: "day" | "month";
}

/** What the screen shows when the aggregate could not be read at all. */
const EMPTY: ReportSummary = {
  headline: {
    parcels: 0, late: 0, not_shipped: 0, in_transit: 0, delivered: 0,
    returned: 0, cancelled: 0, books: 0, revenue_paise: 0,
    avg_days: null, median_days: null,
  },
  totals: {},
  ageing: {},
  couriers: [],
  agents: [],
  buckets: [],
  states: [],
  bucketUnit: "month",
};

const num = (v: unknown): number => Number(v) || 0;
const maybe = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

/**
 * Every figure above the table, in one round trip.
 *
 * Memoised per request because the page renders the tiles, the courier table,
 * the ageing bar and the time chart in separate components, and they must all
 * be the same read — two calls could straddle an order being marked delivered
 * and the tiles would then disagree with the table underneath them.
 */
export const reportSummary = cache(async function reportSummary(
  filters: ReportFilters
): Promise<ReportSummary> {
  const { data, error } = await supabaseAdmin.rpc(
    "report_summary",
    summaryArgs(filters, bucketFor(filters))
  );

  // Zeroes rather than a throw. The tiles are a heading, and a screen that
  // refuses to render because an aggregate failed is worse than one showing
  // nothing — especially when the table below it would have worked.
  if (error) {
    console.error("[Reports] summary failed:", error.message);
    return EMPTY;
  }

  const raw = (data ?? {}) as Record<string, unknown>;
  const h = (raw.headline ?? {}) as Record<string, unknown>;

  return {
    headline: {
      parcels: num(h.parcels),
      late: num(h.late),
      not_shipped: num(h.not_shipped),
      in_transit: num(h.in_transit),
      delivered: num(h.delivered),
      returned: num(h.returned),
      cancelled: num(h.cancelled),
      books: num(h.books),
      revenue_paise: num(h.revenue_paise),
      // Null, not zero: "no parcel has been delivered yet" and "delivery takes
      // no time" are different facts and the tile says so.
      avg_days: maybe(h.avg_days),
      median_days: maybe(h.median_days),
    },
    totals: Object.fromEntries(
      Object.entries((raw.totals ?? {}) as Record<string, unknown>).map(
        ([k, v]) => [k, num(v)]
      )
    ),
    ageing: Object.fromEntries(
      Object.entries((raw.ageing ?? {}) as Record<string, unknown>).map(
        ([k, v]) => [k, num(v)]
      )
    ),
    couriers: ((raw.couriers ?? []) as Record<string, unknown>[]).map((c) => ({
      id: String(c.id),
      parcels: num(c.parcels),
      not_shipped: num(c.not_shipped),
      in_transit: num(c.in_transit),
      delivered: num(c.delivered),
      returned: num(c.returned),
      cancelled: num(c.cancelled),
      late: num(c.late),
      avg_days: maybe(c.avg_days),
    })),
    agents: ((raw.agents ?? []) as Record<string, unknown>[]).map((a) => ({
      id: String(a.id),
      parcels: num(a.parcels),
      holding: num(a.holding),
      in_transit: num(a.in_transit),
      delivered: num(a.delivered),
      returned: num(a.returned),
      late: num(a.late),
    })),
    buckets: ((raw.buckets ?? []) as Record<string, unknown>[]).map((b) => ({
      bucket: String(b.bucket),
      shipped: num(b.shipped),
      delivered: num(b.delivered),
    })),
    states: ((raw.states ?? []) as Record<string, unknown>[]).map((s) => ({
      name: String(s.name),
      parcels: num(s.parcels),
      delivered: num(s.delivered),
      returned: num(s.returned),
      late: num(s.late),
      avg_days: maybe(s.avg_days),
    })),
    bucketUnit: raw.bucket_unit === "day" ? "day" : "month",
  };
});

/**
 * How the table is sorted.
 *
 * "Longest waiting" sorts on `days_pending` rather than on a date, which is
 * not the same as "oldest": a delivered parcel's days_pending stopped when it
 * arrived, so this puts the parcels still waiting at the top, which is what
 * somebody asking for it wants to see.
 */
function orderFor(filters: ReportFilters): { column: string; ascending: boolean } {
  if (filters.sort === "age") return { column: "days_pending", ascending: false };
  return { column: "ordered_at", ascending: filters.sort === "oldest" };
}

/**
 * One page of the table.
 *
 * Reads the scope function through PostgREST rather than rebuilding the
 * filters in a query builder, so there is no second copy to drift. `count:
 * exact` gives the paging its total, and it is the same total the tiles above
 * were counted from.
 */
export const fetchReportPage = cache(async function fetchReportPage(
  filters: ReportFilters,
  page: number,
  perPage: number
): Promise<{ rows: ReportRow[]; count: number }> {
  const { column, ascending } = orderFor(filters);

  const { data, count, error } = await supabaseAdmin
    .rpc("report_scope", reportArgs(filters), { count: "exact" })
    // Tie-broken on the order number, so paging is stable. Without it two rows
    // sharing a date can swap between page 1 and page 2 and one of them is
    // never seen.
    .order(column, { ascending })
    .order("order_number", { ascending: true })
    .range(page * perPage, page * perPage + perPage - 1);

  if (error) {
    console.error("[Reports] page failed:", error.message);
    return { rows: [], count: 0 };
  }

  return { rows: (data ?? []) as ReportRow[], count: count ?? 0 };
});

/** A ceiling that is about spreadsheet sanity, not about PostgREST. */
export const EXPORT_MAX = 50_000;

/**
 * Every matching parcel, for the export.
 *
 * Paged, because PostgREST caps a response at 1000 rows silently — an export
 * quietly missing rows is worse than one that fails, because it gets filed and
 * acted on. See lib/db/paginate.ts.
 */
export async function fetchReportRows(
  filters: ReportFilters
): Promise<{ rows: ReportRow[]; truncated: boolean }> {
  const { column, ascending } = orderFor(filters);

  return fetchAllRows<ReportRow>(
    (from, to) =>
      supabaseAdmin
        .rpc("report_scope", reportArgs(filters))
        .order(column, { ascending })
        .order("order_number", { ascending: true })
        .range(from, to) as unknown as PromiseLike<PageResult<ReportRow>>,
    { label: "parcel report export", max: EXPORT_MAX }
  );
}

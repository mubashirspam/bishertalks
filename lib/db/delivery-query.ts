import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  applyDeliveryFilter,
  isDeliveryStage,
  DELIVERY_STAGES,
} from "@/lib/delivery-stage";
import { istDayStartUTC, istDayEndUTC } from "@/lib/format-date";

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
  status: string;
  courier_name: string | null;
  tracking_number: string | null;
  label_downloaded_at: string | null;
  label_download_count: number;
  assigned_agent_id: string | null;
  assigned_at: string | null;
  courier_entered_at: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  created_at: string;
}

export const DELIVERY_COLUMNS =
  "id,order_number,buyer_name,buyer_phone,address_line1,address_line2,city,district,state,pincode," +
  "amount_paise,quantity,is_gift,gift_message," +
  "status,courier_name,tracking_number,label_downloaded_at,label_download_count," +
  "assigned_agent_id,assigned_at,courier_entered_at,shipped_at,delivered_at,created_at";

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
  let query = supabaseAdmin
    .from("orders")
    .select(countOnly ? "id" : columns, { count: "exact", head: countOnly })
    .eq("payment_status", "paid")
    .not("address_line1", "is", null)
    .order("created_at", { ascending: filters.sort === "oldest" });

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

  // created_at is UTC; the admin thinks in IST calendar days.
  if (isDate(filters.from)) query = query.gte("created_at", istDayStartUTC(filters.from));
  if (isDate(filters.to)) query = query.lt("created_at", istDayEndUTC(filters.to));

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
  const stages = ["all", ...DELIVERY_STAGES];

  const results = await Promise.all(
    stages.map((stage) =>
      buildDeliveryQuery({ ...filters, stage }, { countOnly: true })
    )
  );

  return Object.fromEntries(
    stages.map((stage, i) => [stage, results[i].count ?? 0])
  );
});

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
  };
}

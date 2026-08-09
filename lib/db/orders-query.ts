import { supabaseAdmin } from "@/lib/supabase/admin";
import { applyStageFilter, type OrderStage } from "@/lib/order-stage";
import { istDayStartUTC, istDayEndUTC } from "@/lib/format-date";

export interface OrderFilters {
  stage?: string;
  q?: string;
  /** IST calendar dates, YYYY-MM-DD, both inclusive. */
  from?: string;
  to?: string;
  /** Traffic channel the order came from. */
  source?: string;
  /** Follow-up state: a FollowUpStatus, "none" for untouched, or "all". */
  followUp?: string;
}

/** Shape of the columns selected below. */
export interface OrderRow {
  id: string;
  order_number: string;
  buyer_name: string | null;
  buyer_phone: string | null;
  buyer_email: string | null;
  amount_paise: number;
  discount_paise: number;
  promo_code: string | null;
  payment_status: string;
  status: string;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  district: string | null;
  state: string | null;
  pincode: string | null;
  razorpay_order_id: string | null;
  razorpay_payment_id: string | null;
  checkout_type: string | null;
  created_at: string;
  address_submitted_at: string | null;
  source: string | null;
  first_source: string | null;
  utm_campaign: string | null;
  follow_up_status: string | null;
  follow_up_at: string | null;
  follow_up_note: string | null;
}

export const ORDER_COLUMNS =
  "id,order_number,buyer_name,buyer_phone,buyer_email,amount_paise,discount_paise,promo_code," +
  "payment_status,status,address_line1,address_line2,city,district,state,pincode," +
  "razorpay_order_id,razorpay_payment_id,checkout_type,created_at,address_submitted_at," +
  "source,first_source,utm_campaign,follow_up_status,follow_up_at,follow_up_note";

const isDate = (s?: string): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

/**
 * Single source of truth for the admin orders query, so the table and the
 * CSV/Excel export can never disagree about what a filter means.
 */
export function buildOrdersQuery(filters: OrderFilters) {
  let query = supabaseAdmin
    .from("orders")
    .select(ORDER_COLUMNS, { count: "exact" })
    .order("created_at", { ascending: false });

  const stage = filters.stage;
  if (stage && stage !== "all") {
    query = applyStageFilter(query, stage as OrderStage);
  }

  // Dates are IST calendar days but created_at is UTC — convert, or the filter
  // is 5h30m out and silently drops early-morning orders.
  if (isDate(filters.from)) query = query.gte("created_at", istDayStartUTC(filters.from));
  if (isDate(filters.to)) query = query.lt("created_at", istDayEndUTC(filters.to));

  // Plain equality: the column defaults to 'direct' and was backfilled, so
  // there are no NULLs to special-case. The search box below owns the one
  // `or` this query gets.
  if (filters.source && filters.source !== "all") {
    query = query.eq("source", filters.source);
  }

  // "none" is the working list — unpaid and nobody has rung them yet.
  if (filters.followUp && filters.followUp !== "all") {
    query =
      filters.followUp === "none"
        ? query.is("follow_up_status", null)
        : query.eq("follow_up_status", filters.followUp);
  }

  if (filters.q) {
    const q = filters.q.replace(/[%,()]/g, "");
    if (q) {
      query = query.or(
        `order_number.ilike.%${q}%,buyer_name.ilike.%${q}%,buyer_phone.ilike.%${q}%`
      );
    }
  }

  return query;
}

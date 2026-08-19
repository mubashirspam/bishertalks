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
  /** Copies in the order: "multi" for 2+, "single" for exactly one, or "all". */
  books?: string;
}

/** Shape of the columns selected below. */
export interface OrderRow {
  id: string;
  order_number: string;
  buyer_name: string | null;
  buyer_phone: string | null;
  buyer_email: string | null;
  amount_paise: number;
  /** Copies of the book. NOT NULL DEFAULT 1 in the schema — see 0023. */
  quantity: number;
  /** Gift wrapping (0027). NOT NULL DEFAULT FALSE / 0. */
  is_gift: boolean;
  gift_message: string | null;
  gift_charge_paise: number;
  /** Signed copies (0040). Only ever set on a gift, and free (0041). */
  is_signed: boolean;
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
  /** When checkout began. Not the order date — see `ordered_at`. */
  created_at: string;
  /** When it was paid (0043). Null if unpaid, or paid before that migration. */
  paid_at: string | null;
  /** COALESCE(paid_at, created_at) — what this screen sorts and filters by. */
  ordered_at: string;
  address_submitted_at: string | null;
  source: string | null;
  first_source: string | null;
  utm_campaign: string | null;
  follow_up_status: string | null;
  follow_up_at: string | null;
  follow_up_note: string | null;
}

export const ORDER_COLUMNS =
  "id,order_number,buyer_name,buyer_phone,buyer_email,amount_paise,quantity," +
  "is_gift,gift_message,gift_charge_paise,is_signed,discount_paise,promo_code," +
  "payment_status,status,address_line1,address_line2,city,district,state,pincode," +
  "razorpay_order_id,razorpay_payment_id,checkout_type," +
  "created_at,paid_at,ordered_at,address_submitted_at," +
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
    // ordered_at, not created_at: an order paid last night after its customer
    // first opened the checkout five days ago belongs at the top of this list,
    // not five days down it.
    .order("ordered_at", { ascending: false });

  const stage = filters.stage;
  if (stage && stage !== "all") {
    query = applyStageFilter(query, stage as OrderStage);
  }

  // Dates are IST calendar days but ordered_at is UTC — convert, or the filter
  // is 5h30m out and silently drops early-morning orders.
  //
  // Both ends read ordered_at, and they have to agree: a range with one end on
  // created_at would drop exactly the orders this column exists for — the ones
  // paid days after checkout started.
  if (isDate(filters.from)) query = query.gte("ordered_at", istDayStartUTC(filters.from));
  if (isDate(filters.to)) query = query.lt("ordered_at", istDayEndUTC(filters.to));

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

  // Multi-copy buyers are the ones worth a call: they're gifting, reselling or
  // running a session, and that's a different conversation from a single copy.
  // `quantity` is NOT NULL DEFAULT 1, so a plain comparison catches every old
  // row correctly without an `or (quantity is null)` arm.
  if (filters.books === "multi") query = query.gte("quantity", 2);
  else if (filters.books === "single") query = query.eq("quantity", 1);

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

import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { istDayStartUTC, istDayEndUTC } from "@/lib/format-date";
import type { OrderStatus } from "@/lib/types/order";

/**
 * The delivery portal's data.
 *
 * Deliberately its own query rather than a reuse of `buildDeliveryQuery`: that
 * one is organised around the *label printing* workflow (to_print / packed are
 * derived from whether a PDF was generated), and the portal has no printing at
 * all.
 *
 * The scope is the same definition of shippable the master queue uses — paid,
 * and we know where to send it. An order missing either belongs in the funnel
 * at /admin/orders, not in front of someone packing parcels.
 */

/**
 * The tick columns, in the order the work happens.
 *
 * "Confirmed" is the odd one out and the reason this isn't just a status list:
 * it means the agent has entered the address into the courier's system, which
 * is recorded on `courier_entered_at` (migration 0016). The other three are
 * fulfilment statuses the customer also sees.
 */
export const PORTAL_STATUS_STEPS = [
  "processing",
  "shipped",
  "delivered",
] as const satisfies readonly OrderStatus[];

export type PortalStatusStep = (typeof PORTAL_STATUS_STEPS)[number];

/** Column headings, in the agent's words rather than the database's. */
export const PORTAL_STEP_LABELS: Record<PortalStatusStep, string> = {
  processing: "Packed",
  shipped: "Shipped",
  delivered: "Delivered",
};

/** What the first column means, spelled out where an agent will see it. */
export const ENTERED_LABEL = "Confirmed";
export const ENTERED_HINT = "Address entered in the courier's system";

/**
 * Statuses the portal can filter by.
 *
 * No 'cancelled': a cancelled order is not a parcel, there is nothing for an
 * agent to do with one, and reversing a cancellation is an owner's decision
 * made on the order screen. They are excluded from the query outright, so the
 * filter has nothing to offer either.
 */
export const PORTAL_STATUSES = [
  "confirmed",
  ...PORTAL_STATUS_STEPS,
  "returned",
] as const satisfies readonly OrderStatus[];

export function isPortalStatus(v: string | undefined): v is OrderStatus {
  return !!v && (PORTAL_STATUSES as readonly string[]).includes(v);
}

/**
 * Filter labels.
 *
 * 'confirmed' is shown as "New" here on purpose — now that the Confirmed tick
 * means "entered with the courier", calling the payment status the same thing
 * two inches away would be the exact confusion this change fixes.
 */
export const PORTAL_STATUS_LABELS: Record<string, string> = {
  confirmed: "New",
  processing: "Packed",
  shipped: "Shipped",
  delivered: "Delivered",
  returned: "Returned",
};

export interface PortalRow {
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
  status: OrderStatus;
  courier_entered_at: string | null;
  created_at: string;
}

const PORTAL_COLUMNS =
  "id,order_number,buyer_name,buyer_phone,address_line1,address_line2,city,district," +
  "state,pincode,amount_paise,status,courier_entered_at,created_at";

const isDate = (s?: string): s is string => /^\d{4}-\d{2}-\d{2}$/.test(s ?? "");

/**
 * One page of parcels, newest first.
 *
 * Memoised per request so the header count and the grid resolve from a single
 * round trip, the same way the orders list does.
 */
export const fetchPortalPage = cache(async function fetchPortalPage(
  date: string | undefined,
  status: string | undefined,
  /** "1" = only parcels not yet entered with the courier — the to-do list. */
  pending: string | undefined,
  pageNum: number,
  perPage: number
) {
  let query = supabaseAdmin
    .from("orders")
    .select(PORTAL_COLUMNS, { count: "exact" })
    .eq("payment_status", "paid")
    .not("address_line1", "is", null)
    .neq("status", "cancelled")
    // Newest first: a parcel that just came in is the one nobody has touched.
    .order("created_at", { ascending: false });

  // created_at is UTC but the day is an IST calendar day — convert, or the
  // filter is 5h30m out and silently drops the early-morning orders.
  if (isDate(date)) {
    query = query
      .gte("created_at", istDayStartUTC(date))
      .lt("created_at", istDayEndUTC(date));
  }

  if (isPortalStatus(status)) query = query.eq("status", status);
  if (pending === "1") query = query.is("courier_entered_at", null);

  const { data, count, error } = await query.range(
    pageNum * perPage,
    (pageNum + 1) * perPage - 1
  );

  if (error) console.error("[Portal] query failed:", error.message);

  return { rows: (data ?? []) as unknown as PortalRow[], count: count ?? 0 };
});

/**
 * Record (or undo) "I've entered this into the courier's system".
 *
 * `onlyIfUnset` is what makes ticking a later stage imply this one without
 * rewriting the time it actually happened: an agent who jumps straight to
 * Packed clearly entered it first, but if they'd already ticked Confirmed an
 * hour ago that is the timestamp worth keeping.
 */
export async function setCourierEntered(
  orderNumber: string,
  entered: boolean,
  { onlyIfUnset = false } = {}
): Promise<boolean> {
  let query = supabaseAdmin
    .from("orders")
    .update({
      courier_entered_at: entered ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("order_number", orderNumber);

  if (onlyIfUnset) query = query.is("courier_entered_at", null);

  const { data, error } = await query.select("order_number");

  if (error) {
    console.error("[Portal] courier_entered update failed:", error.message);
    throw new Error(error.message);
  }
  return !!data?.length;
}

import { supabaseAdmin } from "@/lib/supabase/admin";
import { fetchAllRows, type PageResult } from "@/lib/db/paginate";
import { CONTACT_COLUMNS, type ContactRow } from "@/lib/delivery/contacts";
import type { OrderStatus } from "@/lib/types/order";

/**
 * Where every paid parcel actually is, by courier.
 *
 * The dashboard has revenue and a day's activity; what it never had was the
 * one table that answers "what is stuck, and with whom" — which is the
 * question that matters once parcels go out through four different channels.
 * A courier's whole column sitting in Confirmed reads very differently from
 * the same count spread across Packed, Shipped and Delivered, and no
 * per-courier total can show that.
 *
 * Counted over paid orders only. An unpaid order is not a parcel.
 */

/** The row a parcel is counted from — deliberately the two fields, nothing more. */
export interface StatusCountable {
  status: string;
  courier_id: string | null;
}

/**
 * The columns, in pipeline order.
 *
 * Fixed rather than derived from the data, so an empty column still appears:
 * "no parcel anywhere is Returned" is information, and a table that silently
 * drops the column cannot say it. Anything a future migration adds shows up
 * via `extraStatuses` below rather than being counted into nothing.
 */
export const STATUS_COLUMNS: readonly OrderStatus[] = [
  "confirmed",
  "processing",
  "shipped",
  "out_for_delivery",
  "delivered",
  "returned",
  "cancelled",
];

/** The words the admin panel uses for each, which are not the database's. */
export const STATUS_COLUMN_LABELS: Record<string, string> = {
  confirmed: "Confirmed",
  processing: "Packed",
  shipped: "Shipped",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  returned: "Returned",
  cancelled: "Cancelled",
};

/**
 * The key standing in for "no courier yet" in a URL.
 *
 * A real key rather than an omitted parameter, because the drill-down has to
 * tell "unrouted parcels" apart from "every courier" — 432 of them are sitting
 * unrouted, which is the largest single cell in the table and the one most
 * worth being able to click.
 */
export const NO_COURIER = "none";

/** Any status present in the data that `STATUS_COLUMNS` does not name. */
export function extraStatuses(rows: StatusCountable[]): string[] {
  const known = new Set<string>(STATUS_COLUMNS);
  return [...new Set(rows.map((r) => r.status).filter((s) => !known.has(s)))].sort();
}

/**
 * counts[courierKey][status] — one pass, no query.
 *
 * Takes rows the caller already has. The dashboard reads every paid order for
 * its revenue figures anyway, so counting them again server-side would be a
 * second full-table read to answer a question the first one already carries.
 */
export function courierStatusCounts(
  rows: StatusCountable[]
): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const key = r.courier_id ?? NO_COURIER;
    const byStatus = out.get(key) ?? new Map<string, number>();
    byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);
    out.set(key, byStatus);
  }
  return out;
}

/**
 * The parcels behind one cell of that table.
 *
 * Paid orders with this courier and this status, oldest first — the same scope
 * the counts were taken over, so the list length always equals the number that
 * was clicked. That is the only property of this function that really matters:
 * a drill-down that disagrees with its own count teaches people to distrust
 * both.
 *
 * `courierKey` is a courier id, `NO_COURIER` for the unrouted pile, or null
 * for every courier at once.
 */
export async function fetchStatusContacts(
  courierKey: string | null,
  status: string | null
): Promise<{ rows: ContactRow[]; truncated: boolean }> {
  return fetchAllRows<ContactRow>(
    (from, to) => {
      let q = supabaseAdmin
        .from("orders")
        .select(CONTACT_COLUMNS)
        .eq("payment_status", "paid");

      if (status) q = q.eq("status", status);
      if (courierKey === NO_COURIER) q = q.is("courier_id", null);
      else if (courierKey) q = q.eq("courier_id", courierKey);

      return q
        .order("ordered_at", { ascending: true })
        .range(from, to) as unknown as PromiseLike<PageResult<ContactRow>>;
    },
    { label: "courier/status drill-down" }
  );
}

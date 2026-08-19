export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-auth";
import { buildOrdersQuery, type OrderRow } from "@/lib/db/orders-query";
import { fetchAllRows } from "@/lib/db/paginate";
import { orderStage, STAGE_LABELS } from "@/lib/order-stage";
import { formatIST } from "@/lib/format-date";
import { SOURCE_LABELS, isTrafficSource } from "@/lib/attribution";
import { FOLLOW_UP_LABELS, isFollowUpStatus } from "@/lib/follow-up";
import { toCSV, toXLSX } from "@/lib/export";

const HEADERS = [
  "Order number", "Date & time (IST)", "Stage", "Name", "Phone", "Email",
  "Amount (₹)", "Books", "Gift", "Gift message", "Gift charge (₹)",
  "Signed",
  "Discount (₹)", "Promo", "Payment status", "Fulfilment status",
  "Address", "Landmark", "Area", "District", "State", "Pincode",
  "Razorpay payment ID", "Checkout", "Address submitted (IST)",
  "Came from", "First touch", "Campaign",
  "Follow-up", "Followed up (IST)", "Follow-up note",
];

/**
 * Export the orders list as CSV or Excel.
 *
 * Uses the same query builder as the admin table, so an export always matches
 * exactly what the filters showed on screen.
 */
/** A ceiling that is about spreadsheet sanity, not about PostgREST. */
const EXPORT_MAX = 50_000;

export async function GET(request: NextRequest) {
  // Contains every customer's name, phone and address — admin only.
  const auth = await requirePermission("orders.export");
  if (!auth.ok) return auth.response;

  const p = request.nextUrl.searchParams;
  const format = p.get("format") === "xlsx" ? "xlsx" : "csv";

  const filters = {
    stage: p.get("stage") ?? undefined,
    q: p.get("q") ?? undefined,
    from: p.get("from") ?? undefined,
    to: p.get("to") ?? undefined,
    source: p.get("source") ?? undefined,
    followUp: p.get("followUp") ?? undefined,
    books: p.get("books") ?? undefined,
  };

  // Paged. The `.limit(5000)` this replaces never worked: PostgREST caps a
  // response at 1000 rows, so every export past the thousandth order silently
  // stopped there — and an export that is quietly missing rows is worse than
  // one that fails, because it gets filed and acted on.
  const { rows: data, truncated } = await fetchAllRows<Record<string, unknown>>(
    (from, to) => buildOrdersQuery(filters).range(from, to) as never,
    { label: "orders export", max: EXPORT_MAX }
  );

  if (truncated) {
    console.warn(`[Export] hit the ${EXPORT_MAX}-row ceiling — the file is partial`);
  }

  const rupees = (paise: number | null) => Math.round((paise ?? 0) / 100);

  const rows = ((data ?? []) as unknown as OrderRow[]).map((o) => [
    o.order_number,
    formatIST(o.created_at),
    STAGE_LABELS[orderStage(o)],
    o.buyer_name ?? "",
    // Leading apostrophe stops Excel dropping the leading digit / switching to
    // scientific notation on long numeric strings.
    o.buyer_phone ? `'${o.buyer_phone}` : "",
    o.buyer_email ?? "",
    rupees(o.amount_paise),
    o.quantity ?? 1,
    o.is_gift ? "Yes" : "",
    o.gift_message ?? "",
    o.gift_charge_paise ? rupees(o.gift_charge_paise) : "",
    o.is_signed ? "Yes" : "",
    rupees(o.discount_paise),
    o.promo_code ?? "",
    o.payment_status,
    o.status,
    o.address_line1 ?? "",
    o.address_line2 ?? "",
    o.city ?? "",
    o.district ?? "",
    o.state ?? "",
    o.pincode ? `'${o.pincode}` : "",
    o.razorpay_payment_id ?? "",
    o.checkout_type ?? "",
    o.address_submitted_at ? formatIST(o.address_submitted_at) : "",
    isTrafficSource(o.source) ? SOURCE_LABELS[o.source] : "",
    isTrafficSource(o.first_source) ? SOURCE_LABELS[o.first_source] : "",
    o.utm_campaign ?? "",
    isFollowUpStatus(o.follow_up_status) ? FOLLOW_UP_LABELS[o.follow_up_status] : "",
    o.follow_up_at ? formatIST(o.follow_up_at) : "",
    o.follow_up_note ?? "",
  ]);

  const stamp = new Date().toISOString().slice(0, 10);
  const stagePart = p.get("stage") && p.get("stage") !== "all" ? `-${p.get("stage")}` : "";
  const filename = `orders${stagePart}-${stamp}.${format}`;

  const body =
    format === "xlsx"
      ? new Uint8Array(toXLSX(HEADERS, rows, "Orders"))
      : toCSV(HEADERS, rows);

  return new NextResponse(body, {
    headers: {
      "Content-Type":
        format === "xlsx"
          ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          : "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

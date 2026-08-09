export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-auth";
import { buildOrdersQuery, type OrderRow } from "@/lib/db/orders-query";
import { orderStage, STAGE_LABELS } from "@/lib/order-stage";
import { formatIST } from "@/lib/format-date";
import { SOURCE_LABELS, isTrafficSource } from "@/lib/attribution";
import { FOLLOW_UP_LABELS, isFollowUpStatus } from "@/lib/follow-up";
import { toCSV, toXLSX } from "@/lib/export";

const HEADERS = [
  "Order number", "Date & time (IST)", "Stage", "Name", "Phone", "Email",
  "Amount (₹)", "Discount (₹)", "Promo", "Payment status", "Fulfilment status",
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
export async function GET(request: NextRequest) {
  // Contains every customer's name, phone and address — admin only.
  const auth = await requirePermission("orders.export");
  if (!auth.ok) return auth.response;

  const p = request.nextUrl.searchParams;
  const format = p.get("format") === "xlsx" ? "xlsx" : "csv";

  const { data, error } = await buildOrdersQuery({
    stage: p.get("stage") ?? undefined,
    q: p.get("q") ?? undefined,
    from: p.get("from") ?? undefined,
    to: p.get("to") ?? undefined,
    source: p.get("source") ?? undefined,
    followUp: p.get("followUp") ?? undefined,
  }).limit(5000);

  if (error) {
    console.error("[Export] query failed:", error.message);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
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

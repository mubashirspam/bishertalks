export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-auth";
import { parseReportFilters, DATE_MODE_LABELS } from "@/lib/report-filters";
import {
  fetchReportRows,
  reportSummary,
  EXPORT_MAX,
  type ReportRow,
} from "@/lib/db/parcel-report";
import { listCouriers } from "@/lib/db/couriers";
import { listStaff } from "@/lib/db/staff";
import { DELIVERY_LABELS, type DeliveryStage } from "@/lib/delivery-stage";
import { isHandoverState, HANDOVER_LABELS } from "@/lib/delivery/handover";
import { formatIST, formatISTDate } from "@/lib/format-date";
import { toCSV, toXLSXWorkbook } from "@/lib/export";

/**
 * The reports screen, as a spreadsheet.
 *
 * Reads the same `report_scope` function the screen does, through the same
 * filter parser, from the query string the screen was showing — so the file
 * and the page are the same query by construction rather than by two
 * implementations agreeing. An export that quietly differs from the screen is
 * worse than no export, because it gets filed and acted on.
 *
 * Excel gets two tabs. The Parcels tab is the rows; the Summary tab is the
 * counts from the top of the screen, plus a written record of which filters
 * produced them. That second tab is the point: a spreadsheet that lands in
 * somebody's inbox with no statement of what it covers becomes an argument
 * three weeks later about what it covered.
 *
 * CSV gets the rows only — it is the format people feed to other tools, and a
 * header block would break every one of them.
 */

const HEADERS = [
  "Order number",
  "Ordered (IST)",
  "Assigned to courier (IST)",
  "Assigned to agent (IST)",
  "Entered with courier (IST)",
  "Handed to courier API (IST)",
  "Shipped (IST)",
  "Delivered (IST)",
  "Returned (IST)",
  "Days pending",
  "Days in transit",
  "Late",
  "Where it is",
  "Handover state",
  "Courier",
  "Delivery agent",
  "Waybill",
  "Courier reference",
  "Postal article",
  "Customer",
  "Phone",
  "Address",
  "Landmark",
  "Area",
  "District",
  "State",
  "Pincode",
  "Books",
  "Gift",
  "Signed",
  "Amount (₹)",
  "Refunded (₹)",
  "Kept (₹)",
];

const rupees = (paise: number | null) => Math.round((paise ?? 0) / 100);

export async function GET(request: NextRequest) {
  // Holds every customer's name, phone and home address — the same trust the
  // orders export answers to, and the same permission.
  const auth = await requirePermission("orders.export");
  if (!auth.ok) return auth.response;

  const p = request.nextUrl.searchParams;
  const format = p.get("format") === "csv" ? "csv" : "xlsx";
  const filters = parseReportFilters(p);

  const [{ rows, truncated }, couriers, staff] = await Promise.all([
    fetchReportRows(filters),
    listCouriers(),
    listStaff(),
  ]);

  if (truncated) {
    console.warn(`[Reports] export hit the ${EXPORT_MAX}-row ceiling — the file is partial`);
  }

  const courierNames = new Map(couriers.map((c) => [c.id, c.name]));
  const agentNames = new Map(staff.map((s) => [s.id, s.name]));

  const body = rows.map((r: ReportRow) => [
    r.order_number,
    formatIST(r.ordered_at),
    r.courier_assigned_at ? formatIST(r.courier_assigned_at) : "",
    r.assigned_at ? formatIST(r.assigned_at) : "",
    r.courier_entered_at ? formatIST(r.courier_entered_at) : "",
    r.courier_sent_at ? formatIST(r.courier_sent_at) : "",
    r.shipped_at ? formatIST(r.shipped_at) : "",
    r.delivered_at ? formatIST(r.delivered_at) : "",
    r.returned_at ? formatIST(r.returned_at) : "",
    r.days_pending,
    // Blank rather than 0 on a parcel that never shipped: a column of zeros
    // reads as "shipped and arrived the same day", which is a different fact.
    r.days_in_transit ?? "",
    r.is_late ? "Yes" : "",
    DELIVERY_LABELS[r.delivery_stage as DeliveryStage] ?? r.delivery_stage,
    isHandoverState(r.handover_state) ? HANDOVER_LABELS[r.handover_state] : "",
    r.courier_id ? (courierNames.get(r.courier_id) ?? "Unknown courier") : "",
    r.assigned_agent_id ? (agentNames.get(r.assigned_agent_id) ?? "Removed agent") : "",
    r.tracking_number ?? "",
    r.courier_reference ?? "",
    r.postal_barcode ?? "",
    r.buyer_name ?? "",
    // Leading apostrophe stops Excel dropping the leading digit or switching
    // to scientific notation on long numeric strings.
    r.buyer_phone ? `'${r.buyer_phone}` : "",
    r.address_line1 ?? "",
    r.address_line2 ?? "",
    r.city ?? "",
    r.district ?? "",
    r.state ?? "",
    r.pincode ? `'${r.pincode}` : "",
    r.quantity ?? 1,
    r.is_gift ? "Yes" : "",
    r.is_signed ? "Yes" : "",
    rupees(r.amount_paise),
    r.refunded_paise ? rupees(r.refunded_paise) : "",
    rupees(r.amount_paise - (r.refunded_paise ?? 0)),
  ]);

  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `parcel-report-${stamp}.${format}`;

  const headers: Record<string, string> = {
    "Content-Type":
      format === "xlsx"
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store",
    // Read by the download button, so it can say how many rows landed without
    // anyone opening the file.
    "X-Row-Count": String(rows.length),
    "X-Truncated": truncated ? "1" : "0",
  };

  if (format === "csv") {
    return new NextResponse(toCSV(HEADERS, body), { headers });
  }

  // The summary is read again here rather than passed along, because the
  // export is its own request — it is memoised per request, so this is one
  // round trip, and it guarantees the two tabs describe the same moment.
  const summary = await reportSummary(filters);

  const workbook = toXLSXWorkbook([
    { name: "Parcels", headers: HEADERS, rows: body },
    { name: "Summary", headers: ["", ""], rows: summaryRows(filters, summary, courierNames, rows.length, truncated) },
  ]);

  return new NextResponse(new Uint8Array(workbook), { headers });
}

/**
 * The Summary tab: what the numbers were, and what question they answer.
 *
 * Two columns, label and value, rather than a grid. It is read by a person
 * looking for one figure, not charted, and a label beside its number needs no
 * legend three months later.
 */
function summaryRows(
  filters: ReturnType<typeof parseReportFilters>,
  summary: Awaited<ReturnType<typeof reportSummary>>,
  courierNames: Map<string, string>,
  rowCount: number,
  truncated: boolean
): unknown[][] {
  const h = summary.headline;
  const out: unknown[][] = [];
  const row = (label: string, value: unknown) => out.push([label, value]);
  const blank = () => out.push(["", ""]);

  row("Downloaded", formatIST(new Date().toISOString()));
  row("Rows in this file", rowCount);
  if (truncated) {
    row("WARNING", `The ${EXPORT_MAX}-row ceiling was reached — this file is partial.`);
  }

  blank();
  out.push(["WHAT THIS COVERS", ""]);
  row("Counting by", DATE_MODE_LABELS[filters.by]);
  row("From", filters.from ? formatISTDate(`${filters.from}T00:00:00Z`) : "the beginning");
  row("To", filters.to ? formatISTDate(`${filters.to}T00:00:00Z`) : "today");
  row(
    "Courier",
    filters.courier === "none"
      ? "Not routed yet"
      : filters.courier
        ? (courierNames.get(filters.courier) ?? filters.courier)
        : "Every courier"
  );
  row("Where it is", filters.stages.length ? filters.stages.join(", ") : "Any stage");
  row("Late threshold", `${filters.late} days since ${filters.lateFrom.replace("_", " ")}`);
  row("Late only", filters.onlyLate ? "Yes" : "No");
  if (filters.state) row("State", filters.state);
  if (filters.q) row("Search", filters.q);

  blank();
  out.push(["THE COUNTS", ""]);
  // Deliberately the figures from the top of the screen, which ignore the
  // stage, ageing and late-only filters — see the note in report_summary. So
  // these can be larger than the row count above, and that is not a bug: it is
  // the whole against which the filtered rows were selected.
  row("Parcels in scope", h.parcels);
  row("Books", h.books);
  row("Kept revenue (₹)", Math.round(h.revenue_paise / 100));
  row("Not shipped", h.not_shipped);
  row("In transit", h.in_transit);
  row("Delivered", h.delivered);
  row("Returned", h.returned);
  row("Cancelled", h.cancelled);
  row(`Late over ${filters.late} days`, h.late);
  row("Average days to deliver", h.avg_days ?? "—");
  row("Median days to deliver", h.median_days === null ? "—" : Math.round(h.median_days));

  blank();
  out.push(["WAITING (undelivered)", ""]);
  for (const [k, v] of Object.entries(summary.ageing)) row(`${k} days`, v);

  blank();
  out.push(["BY COURIER", ""]);
  out.push([
    "Courier", "Parcels", "Not shipped", "In transit", "Delivered",
    "Returned", "Cancelled", "Late", "Avg days",
  ]);
  for (const c of summary.couriers) {
    out.push([
      c.id === "none" ? "Not routed yet" : (courierNames.get(c.id) ?? c.id),
      c.parcels, c.not_shipped, c.in_transit, c.delivered,
      c.returned, c.cancelled, c.late, c.avg_days ?? "",
    ]);
  }

  blank();
  out.push([`SHIPPED & DELIVERED BY ${summary.bucketUnit.toUpperCase()}`, ""]);
  out.push([summary.bucketUnit === "day" ? "Day" : "Month", "Shipped", "Delivered"]);
  for (const b of summary.buckets) out.push([b.bucket, b.shipped, b.delivered]);

  return out;
}

export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  buildDeliveryQuery,
  parseDeliveryFilters,
  DELIVERY_COLUMNS,
  type DeliveryRow,
} from "@/lib/db/delivery-query";
import { markLabelsDownloaded } from "@/lib/db/delivery";
import {
  buildLabelSheet,
  labelBarcodeValue,
  postalLabelBarcode,
  postalLabelCaption,
  LABELS_PER_PAGE,
} from "@/lib/shipping-label";
import { listCouriers } from "@/lib/db/couriers";
import { istToday } from "@/lib/format-date";
import { auditMany } from "@/lib/audit";

/**
 * 300 labels, one 4x6 page each. Past that it's a stuck filter rather than a
 * real day's post, and the function would time out building it.
 */
const MAX_LABELS = 300;

/**
 * Download address labels as a printable PDF, one 4x6 label per page.
 *
 * Two ways to call it, both from the delivery list:
 *   { order_numbers: [...] }  the rows the admin ticked
 *   { filters: {...} }        everything currently matching
 *
 * Printing is only printing. It used to demand an `agent_id` and hand the
 * parcels to that agent, from when a sheet coming out of the printer was the
 * moment a batch became someone's job. Parcels are routed to couriers now, so
 * that gate only stood between the admin and a PDF.
 *
 * Generating the PDF still marks those orders as printed, which is
 * information rather than a stage: it says a sheet came out of the printer.
 */
export async function POST(request: NextRequest) {
  // Every customer's name, phone and home address, in one file.
  const auth = await requirePermission("delivery.print");
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({}));
  const orderNumbers: string[] = Array.isArray(body.order_numbers)
    ? body.order_numbers.filter((n: unknown) => typeof n === "string").slice(0, MAX_LABELS)
    : [];

  let rows: DeliveryRow[];

  if (orderNumbers.length) {
    // Re-read through the same shippable scope rather than trusting the ids:
    // an order that lost its address, or was never paid, has no label.
    //
    // portal_orders, not orders — the same rows, plus the derived columns
    // DELIVERY_COLUMNS now asks for. Reading the base table here would fail on
    // `delivery_stage` (0045), and it also makes this branch and the filtered
    // one below read from the same place, which they always should have.
    const { data, error } = await supabaseAdmin
      .from("portal_orders")
      .select(DELIVERY_COLUMNS)
      .eq("payment_status", "paid")
      .not("address_line1", "is", null)
      .in("order_number", orderNumbers)
      .order("ordered_at", { ascending: true });

    if (error) {
      console.error("[Labels] query failed:", error.message);
      return NextResponse.json({ error: "Could not load orders" }, { status: 500 });
    }
    rows = (data ?? []) as unknown as DeliveryRow[];
  } else {
    const { data, error } = await buildDeliveryQuery(
      parseDeliveryFilters(body.filters ?? {})
    ).limit(MAX_LABELS);

    if (error) {
      console.error("[Labels] filtered query failed:", error.message);
      return NextResponse.json({ error: "Could not load orders" }, { status: 500 });
    }
    rows = (data ?? []) as unknown as DeliveryRow[];
  }

  if (!rows.length) {
    return NextResponse.json({ error: "No shippable orders selected" }, { status: 400 });
  }

  // The article number, where India Post has one for this parcel.
  //
  // Read from `orders` rather than added to DELIVERY_COLUMNS because the rows
  // above come from the `portal_orders` view, which was defined before
  // migration 0049 and does not carry the column. A second small query by
  // order number is cheaper than a view migration, and it fails soft: a label
  // is still a label without the barcode swap, and refusing to print a stack
  // of them because one lookup failed would be the worse outcome.
  const withBarcodes = await (async () => {
    const numbers = rows.map((r) => r.order_number);
    const { data, error } = await supabaseAdmin
      .from("orders")
      .select("order_number,postal_barcode")
      .in("order_number", numbers)
      .not("postal_barcode", "is", null);

    if (error) {
      console.error("[Labels] postal barcode lookup failed:", error.message);
      return rows;
    }

    const byOrder = new Map(
      (data ?? []).map((r) => {
        const row = r as { order_number: string; postal_barcode: string };
        return [row.order_number, row.postal_barcode];
      })
    );
    if (!byOrder.size) return rows;

    return rows.map((r) => ({ ...r, postal_barcode: byOrder.get(r.order_number) ?? null }));
  })();

  // The barcode rule is the courier's, not the label's. An India Post parcel
  // carries their article number or no barcode at all — our order number is
  // not a key in their system, and one printed there would scan cleanly and
  // resolve to nothing at the booking counter. Every other courier keeps the
  // order number, which is what our own screens are keyed by.
  const configById = new Map((await listCouriers()).map((c) => [c.id, c.config]));

  const configOf = (o: { courier_id: string | null }) =>
    (o.courier_id ? configById.get(o.courier_id) : null) ?? null;

  const pdf = buildLabelSheet(withBarcodes, {
    barcodeFor: (o) =>
      configOf(o)?.tracking === "india-post" ? postalLabelBarcode(o) : labelBarcodeValue(o),
    // Same rule as the portal's label route: the contract heading, and only
    // for a parcel actually going out under one.
    captionFor: (o) =>
      configOf(o)?.tracking === "india-post" ? postalLabelCaption(configOf(o)) : "",
    // Packing slips kept, deliberately — unlike the portal's route. This is
    // the queue a batch is printed from to be packed, and the slip is the only
    // place a gift message is printed at all.
  });

  // After the PDF exists, so a failed build never marks anything.
  const printed = rows.map((r) => r.order_number);
  try {
    const marked = await markLabelsDownloaded(printed);
    await auditMany(auth.staff, "labels.printed", "order", marked);
  } catch {
    // The labels are already in the admin's hands; refusing to hand them over
    // because the printed-at stamp did not save would be worse than a missing
    // stamp. Logged inside the DB layer.
  }

  const pages = Math.ceil(rows.length / LABELS_PER_PAGE);
  const filename = `labels-${istToday()}-${rows.length}.pdf`;

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      "X-Label-Count": String(rows.length),
      "X-Page-Count": String(pages),
    },
  });
}

export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  buildDeliveryQuery,
  parseDeliveryFilters,
  DELIVERY_COLUMNS,
  type DeliveryRow,
} from "@/lib/db/delivery-query";
import { markLabelsDownloaded } from "@/lib/db/delivery";
import { buildLabelSheet, LABELS_PER_PAGE } from "@/lib/shipping-label";
import { istToday } from "@/lib/format-date";

/**
 * One sheet, 300 labels, 50 pages. Past that it's a stuck filter rather than a
 * real day's post, and the function would time out building it.
 */
const MAX_LABELS = 300;

/**
 * Download address labels as a printable PDF, six to an A4 sheet.
 *
 * Two ways to call it, both from the delivery list:
 *   { order_numbers: [...] }  the rows the admin ticked
 *   { filters: {...} }        everything currently matching the filters
 *
 * Generating the PDF marks those orders as printed — that's the whole point of
 * the tracking. It's the same action from the admin's point of view ("I've got
 * the label"), so splitting it into a second "now mark them" click would just
 * be a step they'd forget.
 */
export async function POST(request: NextRequest) {
  // Every customer's name, phone and home address, in one file.
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const orderNumbers: string[] = Array.isArray(body.order_numbers)
    ? body.order_numbers.filter((n: unknown) => typeof n === "string").slice(0, MAX_LABELS)
    : [];

  let rows: DeliveryRow[];

  if (orderNumbers.length) {
    // Re-read through the same shippable scope rather than trusting the ids:
    // an order that lost its address, or was never paid, has no label.
    const { data, error } = await supabaseAdmin
      .from("orders")
      .select(DELIVERY_COLUMNS)
      .eq("payment_status", "paid")
      .not("address_line1", "is", null)
      .in("order_number", orderNumbers)
      .order("created_at", { ascending: true });

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

  const pdf = buildLabelSheet(rows);

  // After the PDF exists, so a failed build never marks anything as printed.
  try {
    await markLabelsDownloaded(rows.map((r) => r.order_number));
  } catch {
    // The labels are already in the admin's hands; refusing to hand them over
    // now would be worse than an out-of-date "printed" flag they can fix from
    // the list. Logged inside the DB layer.
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

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
import { markLabelsDownloaded, assignOrders } from "@/lib/db/delivery";
import { listDeliveryAgents } from "@/lib/db/staff";
import { buildLabelSheet, LABELS_PER_PAGE } from "@/lib/shipping-label";
import { istToday } from "@/lib/format-date";
import { auditMany } from "@/lib/audit";

/**
 * One sheet, 300 labels, 50 pages. Past that it's a stuck filter rather than a
 * real day's post, and the function would time out building it.
 */
const MAX_LABELS = 300;

/**
 * Download address labels as a printable PDF, six to an A4 sheet, and hand
 * those parcels to a delivery agent.
 *
 * Two ways to call it, both from the delivery list:
 *   { agent_id, order_numbers: [...] }  the rows the admin ticked
 *   { agent_id, filters: {...} }        everything currently matching
 *
 * `agent_id` is required. Printing a sheet of labels *is* the moment a batch
 * of parcels becomes someone's job, and a printed label belonging to nobody is
 * the state this whole flow exists to remove — it looked handled on the shelf
 * and appeared in no agent's portal.
 *
 * Generating the PDF also marks those orders as printed, which is now
 * information rather than a stage: it says a sheet came out of the printer,
 * and the assignment says who took it.
 */
export async function POST(request: NextRequest) {
  // Every customer's name, phone and home address, in one file.
  const auth = await requirePermission("delivery.print");
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({}));
  const orderNumbers: string[] = Array.isArray(body.order_numbers)
    ? body.order_numbers.filter((n: unknown) => typeof n === "string").slice(0, MAX_LABELS)
    : [];

  // Same check as the assign route: an id off the wire is not proof of
  // anything, and labels printed onto a stranger's name would leave the
  // parcels invisible to everyone who could actually post them.
  const agentId = typeof body.agent_id === "string" ? body.agent_id : "";
  const agent = agentId
    ? (await listDeliveryAgents()).find((a) => a.id === agentId)
    : undefined;

  if (!agent) {
    return NextResponse.json(
      { error: "Choose the delivery agent these parcels are going to." },
      { status: 400 }
    );
  }

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

  // After the PDF exists, so a failed build never assigns or marks anything.
  const printed = rows.map((r) => r.order_number);
  try {
    const assigned = await assignOrders(printed, agent.id, auth.staff.id);
    await auditMany(auth.staff, "order.assigned", "order", assigned, {
      agent_id: agent.id,
      agent_name: agent.name,
      via: "labels",
    });

    const marked = await markLabelsDownloaded(printed);
    await auditMany(auth.staff, "labels.printed", "order", marked);
  } catch {
    // The labels are already in the admin's hands; refusing to hand them over
    // now would be worse than an assignment they can redo from the list — the
    // rows stay in New, which is visibly wrong rather than silently lost.
    // Logged inside the DB layer.
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

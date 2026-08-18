export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { parseExceptionReport } from "@/lib/delivery/exception-import";
import { setDeliveryStatus, notifyStatusChange } from "@/lib/db/delivery";
import { auditMany } from "@/lib/audit";

/**
 * KKR's daily report of parcels they could not send by Delhivery.
 *
 * They send a spreadsheet naming what went by another road — India Post, a bus
 * service, by hand — with whatever tracking that service gave them. Without
 * this those parcels look identical to ones that were handed over and never
 * arrived, which is the exact confusion that hid 167 parcels for a fortnight.
 *
 * Two passes on purpose. `preview` reads the file and says what it would do,
 * changing nothing; `apply` does it. A file we did not design, describing
 * parcels we cannot verify, should not be able to move a customer's order
 * without somebody having read the plan first.
 *
 * Statuses go through `setDeliveryStatus`, exactly as a tick in the portal
 * does, so a parcel marked delivered here settles the referral commission and
 * messages the customer the same way. A spreadsheet is not a reason to bypass
 * the rules.
 */

const MAX_ROWS = 2000;

export async function POST(request: NextRequest) {
  const auth = await requirePermission("delivery.assign");
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({}));
  const text = typeof body.text === "string" ? body.text : "";
  const apply = body.apply === true;

  const parsed = parseExceptionReport(text);
  if (parsed.error) {
    return NextResponse.json({ error: parsed.error, matched: parsed.matched }, { status: 400 });
  }
  if (parsed.rows.length > MAX_ROWS) {
    return NextResponse.json(
      { error: `That file has ${parsed.rows.length} rows — ${MAX_ROWS} at a time.` },
      { status: 400 }
    );
  }

  // Resolve each row to a real order. Order number first because it is ours
  // and unique; the reference is the fallback for a file that only carries
  // what was printed on the sheet.
  const orderNumbers = parsed.rows.map((r) => r.orderNumber).filter(Boolean) as string[];
  const references = parsed.rows.map((r) => r.reference).filter(Boolean) as string[];

  const { data: found, error } = await supabaseAdmin
    .from("orders")
    .select("order_number,courier_reference,status,tracking_number,transport_mode,buyer_name")
    .or(
      [
        orderNumbers.length ? `order_number.in.(${orderNumbers.join(",")})` : null,
        references.length ? `courier_reference.in.(${references.join(",")})` : null,
      ]
        .filter(Boolean)
        .join(",")
    );

  if (error) {
    console.error("[Import] lookup failed:", error.message);
    return NextResponse.json({ error: "Could not read the orders" }, { status: 500 });
  }

  const rows = (found ?? []) as {
    order_number: string;
    courier_reference: string | null;
    status: string;
    tracking_number: string | null;
    transport_mode: string | null;
    buyer_name: string | null;
  }[];
  const byOrder = new Map(rows.map((o) => [o.order_number, o]));
  const byRef = new Map(rows.filter((o) => o.courier_reference).map((o) => [o.courier_reference!, o]));

  const plan: {
    order_number: string;
    buyer_name: string | null;
    mode: string | null;
    tracking: string | null;
    from_status: string;
    to_status: string | null;
    note: string | null;
  }[] = [];
  const unmatched: { key: string; why: string }[] = [];

  for (const row of parsed.rows) {
    const order =
      (row.orderNumber ? byOrder.get(row.orderNumber) : undefined) ??
      (row.reference ? byRef.get(row.reference) : undefined);

    if (!order) {
      unmatched.push({
        key: row.orderNumber ?? row.reference ?? "(blank row)",
        why: "no order here matches that number",
      });
      continue;
    }

    plan.push({
      order_number: order.order_number,
      buyer_name: order.buyer_name,
      mode: row.mode,
      tracking: row.tracking,
      from_status: order.status,
      // Only forwards, and only when their word mapped to one of ours.
      to_status: row.status && row.status !== order.status ? row.status : null,
      note: row.problem,
    });
  }

  if (!apply) {
    return NextResponse.json({
      preview: true,
      matched: parsed.matched,
      ignored: parsed.ignored,
      willUpdate: plan.length,
      unmatched,
      plan: plan.slice(0, 200),
    });
  }

  // ── Apply ─────────────────────────────────────────────────────────────────
  let updated = 0;
  const moved: Record<string, string[]> = {};

  for (const p of plan) {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

    // The mode is the point of the whole exercise: it is what stops a parcel
    // that genuinely left by another road from sitting in "not manifested"
    // looking lost.
    if (p.mode) {
      patch.transport_mode = p.mode.slice(0, 80);
      patch.transport_reported_at = new Date().toISOString();
    }
    if (p.tracking) patch.tracking_number = p.tracking.slice(0, 64);

    const { error: writeError } = await supabaseAdmin
      .from("orders")
      .update(patch)
      .eq("order_number", p.order_number);

    if (writeError) {
      console.error("[Import]", p.order_number, writeError.message);
      continue;
    }
    updated++;
    if (p.to_status) (moved[p.to_status] ??= []).push(p.order_number);
  }

  // Statuses last, and through the same path the portal uses, so referral
  // settlement and the customer's WhatsApp behave identically.
  for (const [status, numbers] of Object.entries(moved)) {
    const changed = await setDeliveryStatus(numbers, status as never);
    if (changed.length) await notifyStatusChange(changed, status as never);
  }

  await auditMany(
    auth.staff,
    "order.transport_reported",
    "order",
    plan.map((p) => p.order_number),
    { via: "kkr-exception-report" }
  );

  return NextResponse.json({
    ok: true,
    updated,
    statusChanges: Object.fromEntries(Object.entries(moved).map(([k, v]) => [k, v.length])),
    unmatched,
  });
}

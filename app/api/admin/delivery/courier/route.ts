export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCourier } from "@/lib/db/couriers";
import { auditMany } from "@/lib/audit";

/**
 * Say which courier carries these parcels. Assignment only — it sends nothing.
 *
 * Kept apart from /courier-send on purpose. Choosing a partner is a decision
 * that can be made days before the parcel moves, changed freely while it is
 * still here, and undone with no consequence. Sending is the irreversible one.
 * Folding them into one call would make every assignment a dispatch.
 *
 *   { order_numbers: [...], courier_id: "uuid" }   assign
 *   { order_numbers: [...], courier_id: null }     clear
 */

const MAX_BATCH = 300;

export async function POST(request: NextRequest) {
  const auth = await requirePermission("delivery.assign");
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({}));

  const orderNumbers: string[] = Array.isArray(body.order_numbers)
    ? body.order_numbers.filter((n: unknown): n is string => typeof n === "string")
    : [];

  if (!orderNumbers.length) {
    return NextResponse.json({ error: "No orders selected" }, { status: 400 });
  }
  if (orderNumbers.length > MAX_BATCH) {
    return NextResponse.json(
      { error: `Too many orders — ${MAX_BATCH} at a time` },
      { status: 400 }
    );
  }

  const courierId = typeof body.courier_id === "string" ? body.courier_id : null;

  // Check the target against the list rather than trusting an id off the wire,
  // the same way the agent assignment does.
  let courierName: string | null = null;
  if (courierId) {
    const courier = await getCourier(courierId);
    if (!courier) {
      return NextResponse.json({ error: "Unknown courier" }, { status: 400 });
    }
    if (!courier.is_active) {
      return NextResponse.json(
        { error: `${courier.name} is switched off — turn it back on first.` },
        { status: 400 }
      );
    }
    courierName = courier.name;
  }

  // A parcel already at the courier keeps the courier that has it. Changing the
  // label on a shipment somebody else is already carrying would leave the two
  // systems describing different journeys — cancel it with them first.
  const { data, error } = await supabaseAdmin
    .from("orders")
    .update({ courier_id: courierId, updated_at: new Date().toISOString() })
    .in("order_number", orderNumbers)
    .is("courier_sent_at", null)
    .select("order_number");

  if (error) {
    console.error("[Courier] assign failed:", error.message);
    return NextResponse.json({ error: "Could not set the courier" }, { status: 500 });
  }

  const updated = (data ?? []).map((r) => (r as { order_number: string }).order_number);

  await auditMany(auth.staff, "order.courier_assigned", "order", updated, {
    courier_id: courierId,
    courier_name: courierName,
  });

  return NextResponse.json({
    updated: updated.length,
    // Already-sent parcels that were skipped, so the message can say so rather
    // than reporting a smaller number with no explanation.
    skipped: orderNumbers.length - updated.length,
    courier_name: courierName,
  });
}

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isFollowUpStatus } from "@/lib/follow-up";
import { audit } from "@/lib/audit";

/**
 * Record what happened when someone chased a lead.
 *
 * Sending `status: null` clears it — putting a row back on the "not contacted"
 * list, which is what you want after ringing the wrong number.
 *
 * Behind `orders.edit`: this is a note about a customer conversation, so
 * anyone trusted to change an order can write one. Audited, because on a team
 * "who marked this not interested?" is a question that gets asked.
 */
export async function POST(request: NextRequest) {
  const auth = await requirePermission("orders.edit");
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({}));
  const orderNumber = String(body.order_number ?? "");
  if (!orderNumber) {
    return NextResponse.json({ error: "Missing order_number" }, { status: 400 });
  }

  const raw = body.status;
  const clearing = raw === null || raw === "" || raw === "none";

  if (!clearing && !isFollowUpStatus(raw)) {
    return NextResponse.json({ error: "Unknown follow-up status" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {
    follow_up_status: clearing ? null : raw,
    // Cleared along with the status, so a reset row doesn't keep a date that
    // suggests someone called.
    follow_up_at: clearing ? null : new Date().toISOString(),
  };

  if (typeof body.note === "string") {
    patch.follow_up_note = body.note.trim() || null;
  }

  const { error } = await supabaseAdmin
    .from("orders")
    .update(patch)
    .eq("order_number", orderNumber);

  if (error) {
    console.error("[Follow-up] update failed:", error.message);
    return NextResponse.json({ error: "Could not save" }, { status: 500 });
  }

  await audit({
    actor: auth.staff,
    action: "order.follow_up",
    entity: "order",
    entityId: orderNumber,
    meta: { status: clearing ? null : raw, ...(patch.follow_up_note ? { note: patch.follow_up_note } : {}) },
  });

  return NextResponse.json({ ok: true, status: clearing ? null : raw });
}

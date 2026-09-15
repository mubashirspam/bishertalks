export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermissionAny } from "@/lib/admin-auth";
import { can } from "@/lib/permissions";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getStaffById } from "@/lib/db/staff";
import { setDeliveryStatus, notifyStatusChange } from "@/lib/db/delivery";
import { auditMany } from "@/lib/audit";
import {
  callScope,
  mayTouchCall,
  getCall,
  listAttempts,
  logCall,
  updateCall,
  type CallTask,
} from "@/lib/db/calls";
import { CALL_OUTCOMES, isCallFlag, isCallStatus } from "@/lib/calls";

async function load(id: string) {
  const auth = await requirePermissionAny(["calls.view", "calls.manage"]);
  if (!auth.ok) return { response: auth.response };

  const call = await getCall(id);
  const scope = callScope(auth.staff);
  // Somebody else's call reads as not found, same as tasks — a 403 would
  // confirm it exists.
  if (!call || !mayTouchCall(scope, call)) {
    return { response: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }
  return { auth, call, scope };
}

/** undefined = not sent, null = cleared, string = ISO time. "bad" = invalid. */
function parseWhen(v: unknown): string | null | undefined | "bad" {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  if (typeof v !== "string" || Number.isNaN(Date.parse(v))) return "bad";
  return new Date(v).toISOString();
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const r = await load(id);
  if (r.response) return r.response;
  const attempts = await listAttempts(id);
  return NextResponse.json({ call: r.call, attempts });
}

/**
 * Everything done to one call, by `action`:
 *
 *   log       { outcome, note?, callback_at? } — a call was made
 *   update    { flags?, note?, callback_at? }
 *   done / reopen
 *   reassign  { staff_id }                     — calls.manage only
 *   deliver                                    — the customer confirms delivery
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const r = await load(id);
  if (r.response) return r.response;
  const { auth, call, scope } = r;

  const body = await request.json().catch(() => ({}));
  const note =
    typeof body.note === "string" ? body.note.trim().slice(0, 1000) || null : body.note === null ? null : undefined;
  const callbackAt = parseWhen(body.callback_at);
  if (callbackAt === "bad") {
    return NextResponse.json({ error: "That call-back time isn't a valid date." }, { status: 400 });
  }

  const reply = (res: { call?: CallTask; error?: string }) =>
    res.error
      ? NextResponse.json({ error: res.error }, { status: 400 })
      : NextResponse.json({ ok: true, call: res.call });

  switch (body.action) {
    case "log": {
      if (!isCallStatus(body.outcome) || !CALL_OUTCOMES.includes(body.outcome)) {
        return NextResponse.json({ error: "Pick how the call went." }, { status: 400 });
      }
      return reply(
        await logCall(
          call,
          { outcome: body.outcome, note: note ?? null, callbackAt: callbackAt ?? null },
          auth.staff
        )
      );
    }

    case "update": {
      const flags = Array.isArray(body.flags) ? body.flags.filter(isCallFlag) : undefined;
      return reply(
        await updateCall(call, { flags, note, callbackAt }, auth.staff)
      );
    }

    case "done":
      return reply(await updateCall(call, { done: true }, auth.staff));

    case "reopen":
      return reply(await updateCall(call, { done: false }, auth.staff));

    case "reassign": {
      if (!scope.seesEveryone) {
        return NextResponse.json({ error: "Only a manager can move calls between people." }, { status: 403 });
      }
      const staffId = typeof body.staff_id === "string" ? body.staff_id : "";
      if (!staffId) return reply(await updateCall(call, { assignee: null }, auth.staff));
      const s = await getStaffById(staffId);
      if (!s || !s.is_active || (!can(s, "calls.view") && !can(s, "calls.manage"))) {
        return NextResponse.json({ error: "Pick an active customer care staff member." }, { status: 400 });
      }
      return reply(await updateCall(call, { assignee: { id: s.id, email: s.email } }, auth.staff));
    }

    case "deliver": {
      // The same trust the delivery portal's Delivered tick answers to, or its
      // own narrower grant for customer care: delivered approves a referral
      // commission and messages the customer.
      if (!can(auth.staff, "calls.deliver") && !can(auth.staff, "delivery.complete")) {
        return NextResponse.json(
          { error: "Marking parcels delivered isn't part of your access — flag it “Says delivered” instead." },
          { status: 403 }
        );
      }

      const { data: order } = await supabaseAdmin
        .from("orders")
        .select("status, delivery_mode, payment_status")
        .eq("order_number", call.order_number)
        .maybeSingle();
      if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

      // Same refusal as the portal: an unpaid COD parcel is closed by
      // collecting the cash, not by a tick.
      if (order.delivery_mode === "cod" && order.payment_status !== "paid") {
        return NextResponse.json(
          { error: "This is cash on delivery and not paid yet — close it from the delivery portal with Collect." },
          { status: 400 }
        );
      }

      let notified = 0;
      if (order.status !== "delivered") {
        try {
          const updated = await setDeliveryStatus([call.order_number], "delivered");
          if (updated.length) {
            await auditMany(auth.staff, "order.status", "order", updated, {
              status: "delivered",
              via: "customer-care",
              call_id: call.id,
            });
            notified = await notifyStatusChange(updated, "delivered");
          }
        } catch (e) {
          console.error("[Calls] deliver failed:", call.order_number, e);
          return NextResponse.json({ error: "Could not mark the order delivered." }, { status: 500 });
        }
      }

      const flags = call.flags.includes("says_delivered")
        ? call.flags
        : [...call.flags, "says_delivered" as const];
      const res = await updateCall(call, { done: true, flags }, auth.staff);
      if (res.error) return reply(res);
      return NextResponse.json({ ok: true, call: res.call, notified });
    }

    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
}

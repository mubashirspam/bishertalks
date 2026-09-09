export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { setDeliveryStatus, notifyStatusChange } from "@/lib/db/delivery";
import { auditMany } from "@/lib/audit";
import {
  isPortalStatus,
  setCourierEntered,
  setTrackingNumber,
  setCourierChannel,
  setReturnReason,
  COURIER_CHANNELS,
  courierOf,
  PORTAL_STATUS_STEPS,
} from "@/lib/db/delivery-portal";
import { can } from "@/lib/permissions";
import { portalScope, mayHandle } from "@/lib/delivery/scope";
import { ensureReferences } from "@/lib/db/courier-reference";
import { allocateBarcodes } from "@/lib/db/postal-barcodes";

/**
 * One tick in the delivery portal.
 *
 * Separate from /api/admin/delivery/bulk because it answers to a different
 * permission: an agent can be given the portal without the master queue, and
 * the reverse. It deliberately shares `setDeliveryStatus`, so the timestamps,
 * the referral consequences and the customer notification behave identically
 * however the status was changed.
 */
export async function POST(request: NextRequest) {
  const auth = await requirePermission("delivery.portal");
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({}));

  const orderNumber = typeof body.order_number === "string" ? body.order_number : "";
  const status = body.status;
  // Optional on a shipped tick, and sendable on its own to correct one later.
  const tracking =
    typeof body.tracking_number === "string" ? body.tracking_number : undefined;
  // Only meaningful alongside status: "returned" — an agent typing why a
  // parcel came back. Overwrites whatever a courier scan already recorded,
  // deliberately: a person correcting the record wins over an automatic guess.
  const returnReason =
    typeof body.return_reason === "string" ? body.return_reason : undefined;

  if (!orderNumber) {
    return NextResponse.json({ error: "Missing order_number" }, { status: 400 });
  }

  // A partner may only touch parcels routed to their own courier. Owners and
  // managers are exempt, because they're the ones who fix a partner's mistake
  // after the partner has gone home.
  //
  // Scoped on the courier rather than on `assigned_agent_id` (0047). The old
  // check was the reason this route refused 314 of the 512 parcels its own
  // portal was showing: those went straight to a courier and were never given
  // to a named person, so an agent check could only ever say no.
  const scope = portalScope(auth.staff);
  if (!scope.seesEveryone) {
    try {
      const parcelCourier = await courierOf(orderNumber);
      if (parcelCourier === undefined) {
        return NextResponse.json({ error: "Order not found" }, { status: 404 });
      }
      if (!mayHandle(scope, parcelCourier)) {
        console.warn(`[Portal] ${auth.staff.email} touched out-of-scope ${orderNumber}`);
        return NextResponse.json(
          { error: "That parcel isn't with your delivery partner." },
          { status: 403 }
        );
      }
    } catch {
      return NextResponse.json({ error: "Update failed" }, { status: 500 });
    }
  }

  // Which of KKR Logistics' own routes actually carried this one — Delhivery
  // (the default), DTDC, Trackon, or reassigned outright to the India Post
  // channel. See setCourierChannel for why this refuses on anything that
  // isn't already a KKR parcel.
  if (typeof body.channel === "string") {
    if (!(COURIER_CHANNELS as readonly string[]).includes(body.channel)) {
      return NextResponse.json({ error: "Unknown channel" }, { status: 400 });
    }
    try {
      const result = await setCourierChannel(orderNumber, body.channel as typeof COURIER_CHANNELS[number]);
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

      // Same two housekeeping steps the routing screen does at assignment —
      // best-effort, because a parcel that changed channel is still routed
      // even if a reference or an article number could not be minted.
      try {
        await ensureReferences([orderNumber], result.courier);
      } catch (e) {
        console.warn("[Portal] reference not re-minted for channel change:", e);
      }
      if (body.channel === "india_post") {
        try {
          await allocateBarcodes(result.courier.id, [orderNumber]);
        } catch (e) {
          console.warn("[Portal] article number not allotted for channel change:", e);
        }
      }

      await auditMany(auth.staff, "order.courier_channel", "order", [orderNumber], {
        channel: body.channel,
      });
      return NextResponse.json({ ok: true, channel: body.channel });
    } catch {
      return NextResponse.json({ error: "Update failed" }, { status: 500 });
    }
  }

  // The "Confirmed" tick: the agent has keyed this address into the courier's
  // system. Its own column, not a fulfilment status — see migration 0016.
  if (typeof body.entered === "boolean") {
    try {
      const ok = await setCourierEntered(orderNumber, body.entered);
      if (!ok) return NextResponse.json({ error: "Order not found" }, { status: 404 });

      await auditMany(auth.staff, "order.courier_entered", "order", [orderNumber], {
        entered: body.entered,
      });
      return NextResponse.json({ ok: true, entered: body.entered });
    } catch {
      return NextResponse.json({ error: "Update failed" }, { status: 500 });
    }
  }

  // A tracking ID on its own: the agent shipped the parcel first and got the
  // number afterwards, or is fixing a typo. No status change, and no second
  // WhatsApp — the customer already had the shipped message, and the number is
  // on their tracking page from here on.
  if (tracking !== undefined && !status) {
    try {
      const ok = await setTrackingNumber(orderNumber, tracking);
      if (!ok) return NextResponse.json({ error: "Order not found" }, { status: 404 });

      await auditMany(auth.staff, "order.tracking", "order", [orderNumber], {
        tracking_number: tracking.trim() || null,
        via: "portal",
      });
      return NextResponse.json({ ok: true, tracking_number: tracking.trim() || null });
    } catch {
      return NextResponse.json({ error: "Update failed" }, { status: 500 });
    }
  }

  if (!isPortalStatus(status)) {
    return NextResponse.json({ error: "Unknown status" }, { status: 400 });
  }

  // Finishing a parcel is a separate capability from working one.
  //
  // `delivered` approves the referrer's commission and sends the customer a
  // WhatsApp; `returned` voids it. Those are our money and our voice, and a
  // courier partner's login holds delivery.portal without holding this. The
  // parcel still reaches `delivered` on its own — a courier scan does it
  // through /api/webhook/delhivery, which answers to no staff permission.
  if ((status === "delivered" || status === "returned") &&
      !can(auth.staff, "delivery.complete")) {
    console.warn(`[Portal] ${auth.staff.email} denied ${status} on ${orderNumber}`);
    return NextResponse.json(
      {
        error:
          "Marking a parcel delivered or returned isn't part of your access — " +
          "tick Shipped and it'll be closed off from here.",
      },
      { status: 403 }
    );
  }

  // An unpaid COD parcel cannot be ticked Delivered on its own — the courier
  // collecting cash and the parcel changing hands are the same moment, so
  // recording them separately is how an order ends up marked delivered and
  // never gets paid for. collectCodPayment() (the portal's Collect action)
  // does both writes together; this plain tick refuses instead of doing half
  // of that.
  if (status === "delivered") {
    const { data: codCheck } = await supabaseAdmin
      .from("orders")
      .select("delivery_mode, payment_status")
      .eq("order_number", orderNumber)
      .maybeSingle();
    if (codCheck?.delivery_mode === "cod" && codCheck.payment_status !== "paid") {
      return NextResponse.json(
        { error: "This is cash on delivery — use Collect, not Delivered, to close it off." },
        { status: 400 }
      );
    }
  }

  try {
    // Before the status change, not after: notifyStatusChange re-reads the
    // order to build the message, so this is what puts the tracking ID in the
    // "your parcel has shipped" WhatsApp instead of a message that omits it.
    if (tracking !== undefined) {
      await setTrackingNumber(orderNumber, tracking);
    }

    const updated = await setDeliveryStatus([orderNumber], status);

    if (!updated.length) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    // Packing or shipping a parcel means it was entered with the courier
    // first, so record that if nobody ticked it — without overwriting the time
    // it really happened when they did.
    if ((PORTAL_STATUS_STEPS as readonly string[]).includes(status)) {
      await setCourierEntered(orderNumber, true, { onlyIfUnset: true }).catch(() => {});
    }

    // Why, for a parcel just marked returned by hand. Unconditional — see
    // setReturnReason — because a person typing this in is a deliberate
    // correction, not a guess to be protected from being overwritten.
    if (status === "returned" && returnReason?.trim()) {
      await setReturnReason(orderNumber, returnReason).catch((e) =>
        console.warn("[Portal] return reason not saved:", orderNumber, e)
      );
    }

    await auditMany(auth.staff, "order.status", "order", updated, {
      status,
      via: "portal",
      ...(tracking !== undefined ? { tracking_number: tracking.trim() || null } : {}),
      ...(status === "returned" && returnReason?.trim()
        ? { return_reason: returnReason.trim() }
        : {}),
    });

    // Shipped and delivered are the two the customer hears about; the rest are
    // internal bookkeeping. Never throws, so a WhatsApp outage can't make a
    // saved tick look like it failed.
    const notified = await notifyStatusChange(updated, status);

    return NextResponse.json({ ok: true, status, notified });
  } catch (e) {
    console.error("[Portal] status update failed:", orderNumber, status, e);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}

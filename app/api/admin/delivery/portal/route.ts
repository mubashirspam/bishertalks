export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-auth";
import { setDeliveryStatus, notifyStatusChange } from "@/lib/db/delivery";
import { auditMany } from "@/lib/audit";
import {
  isPortalStatus,
  setCourierEntered,
  setTrackingNumber,
  assignedAgentOf,
  PORTAL_STATUS_STEPS,
} from "@/lib/db/delivery-portal";
import { can } from "@/lib/permissions";

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

  if (!orderNumber) {
    return NextResponse.json({ error: "Missing order_number" }, { status: 400 });
  }

  // An agent may only touch parcels handed to them. Owners and managers — the
  // people who can see the whole queue — are exempt, because they're the ones
  // who fix an agent's mistake after the agent has gone home.
  if (!can(auth.staff, "delivery.view")) {
    try {
      const agent = await assignedAgentOf(orderNumber);
      if (agent === undefined) {
        return NextResponse.json({ error: "Order not found" }, { status: 404 });
      }
      if (!agent || agent !== auth.staff.id) {
        console.warn(`[Portal] ${auth.staff.email} touched unassigned ${orderNumber}`);
        return NextResponse.json(
          { error: "That parcel isn't assigned to you." },
          { status: 403 }
        );
      }
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

    await auditMany(auth.staff, "order.status", "order", updated, {
      status,
      via: "portal",
      ...(tracking !== undefined ? { tracking_number: tracking.trim() || null } : {}),
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

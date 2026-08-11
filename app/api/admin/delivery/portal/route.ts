export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-auth";
import { setDeliveryStatus, notifyStatusChange } from "@/lib/db/delivery";
import { auditMany } from "@/lib/audit";
import {
  isPortalStatus,
  setCourierEntered,
  PORTAL_STATUS_STEPS,
} from "@/lib/db/delivery-portal";

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

  if (!orderNumber) {
    return NextResponse.json({ error: "Missing order_number" }, { status: 400 });
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

  if (!isPortalStatus(status)) {
    return NextResponse.json({ error: "Unknown status" }, { status: 400 });
  }

  try {
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

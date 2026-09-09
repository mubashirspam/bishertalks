export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-auth";
import { reshipOrder } from "@/lib/db/delivery";

/**
 * Send a returned parcel out again.
 *
 * Gated on `delivery.complete`, the same trust as marking a parcel Delivered
 * or Returned in the first place (see the portal route) — a courier partner
 * works a parcel up to Shipped, and deciding a returned one gets a fresh
 * attempt is ours, not theirs.
 */
export async function POST(request: NextRequest) {
  const auth = await requirePermission("delivery.complete");
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({}));
  const orderNumber = typeof body.order_number === "string" ? body.order_number : "";
  if (!orderNumber) {
    return NextResponse.json({ error: "Missing order_number" }, { status: 400 });
  }

  const courierId = typeof body.courier_id === "string" && body.courier_id ? body.courier_id : null;
  const trackingNumber =
    typeof body.tracking_number === "string" && body.tracking_number.trim()
      ? body.tracking_number.trim()
      : null;

  const result = await reshipOrder(orderNumber, { courierId, trackingNumber }, auth.staff);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true, order_number: result.orderNumber });
}

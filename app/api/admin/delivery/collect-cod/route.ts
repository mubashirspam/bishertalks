export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-auth";
import { collectCodPayment } from "@/lib/db/delivery";

/**
 * The delivery portal's Collect action — confirm the courier collected cash
 * on a COD parcel, and mark it delivered in the same write.
 *
 * Gated on `delivery.complete`, the same trust as marking anything Delivered
 * or Returned — see the guard in app/api/admin/delivery/portal/route.ts that
 * refuses the plain Delivered tick for exactly this reason.
 */
export async function POST(request: NextRequest) {
  const auth = await requirePermission("delivery.complete");
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({}));
  const orderNumber = typeof body.order_number === "string" ? body.order_number : "";
  if (!orderNumber) {
    return NextResponse.json({ error: "Missing order_number" }, { status: 400 });
  }

  const result = await collectCodPayment(orderNumber, auth.staff);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true, order_number: result.orderNumber });
}

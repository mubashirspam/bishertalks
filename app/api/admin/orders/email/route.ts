export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-auth";
import { sendPurchaseEmail } from "@/lib/db/order-email";
import { audit } from "@/lib/audit";

/**
 * Send (or re-send) the receipt email for one order.
 *
 * Exists because the automatic send can legitimately miss: the customer left
 * the email field blank and gave it later, the address had a typo, or Resend
 * was misconfigured when the order came through.
 *
 * `orders.edit` rather than a permission of its own — anyone trusted to change
 * an order is trusted to email its owner about it.
 */
export async function POST(request: NextRequest) {
  const auth = await requirePermission("orders.edit");
  if (!auth.ok) return auth.response;

  const { order_number } = await request.json().catch(() => ({}));
  if (!order_number) {
    return NextResponse.json({ error: "Missing order_number" }, { status: 400 });
  }

  // force: this is a deliberate click, so the "already sent" guard doesn't
  // apply. The unpaid guard still does.
  const result = await sendPurchaseEmail(String(order_number), { force: true });

  if (!result.sent) {
    return NextResponse.json(
      { error: result.reason ?? "Could not send" },
      { status: 400 }
    );
  }

  await audit({
    actor: auth.staff,
    action: "order.email_sent",
    entity: "order",
    entityId: String(order_number),
  });

  return NextResponse.json({ sent: true });
}

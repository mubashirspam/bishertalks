export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/admin-auth";
import { getAuditTrail } from "@/lib/audit";
import { listNotifications } from "@/lib/db/notifications";

/**
 * Full order record for the admin detail page — the only caller.
 *
 * Admin-only: this returns the buyer's phone, email and home address, and an
 * order number is guessable enough that "you knew the number" is not
 * authentication. Customers get the deliberately thinner view on
 * /neuro-code/track instead.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePermission("orders.view");
  if (!auth.ok) return auth.response;

  const { id } = await params;

  const { data: order, error } = await supabaseAdmin
    .from("orders")
    .select(
      `order_number, buyer_name, buyer_phone, buyer_email, city, district, state,
       address_line1, address_line2, pincode, status, payment_status,
       amount_paise, quantity, discount_paise, promo_code, notes,
       is_gift, gift_message, gift_charge_paise,
       tracking_number, courier_name, expected_delivery,
       label_downloaded_at, label_download_count, shipped_at, delivered_at,
       courier_entered_at, assigned_agent_id, assigned_at,
       invoice_email_sent_at, payment_link_id, payment_link_url,
       created_at, address_submitted_at, razorpay_payment_id`
    )
    .eq("order_number", id)
    .single();

  if (error || !order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // Who changed what, and what the customer was actually sent — both alongside
  // so the detail page still needs one request.
  const [history, notifications] = await Promise.all([
    getAuditTrail("order", id),
    listNotifications(id),
  ]);

  return NextResponse.json({ ...order, history, notifications });
}

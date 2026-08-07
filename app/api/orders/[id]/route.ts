export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/admin-auth";

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
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const { data: order, error } = await supabaseAdmin
    .from("orders")
    .select(
      `order_number, buyer_name, buyer_phone, buyer_email, city, district, state,
       address_line1, address_line2, pincode, status, payment_status,
       amount_paise, discount_paise, promo_code, notes,
       tracking_number, courier_name, expected_delivery,
       label_downloaded_at, label_download_count, shipped_at, delivered_at,
       created_at, razorpay_payment_id`
    )
    .eq("order_number", id)
    .single();

  if (error || !order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  return NextResponse.json(order);
}

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getProductPricing } from "@/lib/db/courses";
import { normalizePhone, isValidPhone } from "@/lib/db/users";

function generateOrderNumber(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const code = Array.from(
    { length: 6 },
    () => chars[Math.floor(Math.random() * chars.length)]
  ).join("");
  return `ORD-${code}`;
}

/**
 * Capture a visitor the moment they enter a valid mobile number, before they
 * click Pay — so people who drop off at checkout are still visible instead of
 * vanishing.
 *
 * Creates (or reuses) an order row in the `lead` stage: it has a phone but no
 * razorpay_order_id yet. /api/orders/create later attaches payment to this same
 * row, so one customer is one row all the way through.
 *
 * Public and unauthenticated by necessity. Kept deliberately cheap: it writes
 * one row and returns, and re-entering the same number updates rather than
 * inserting, so it can't be used to bloat the table by retyping.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const phone = normalizePhone(String(body?.phone ?? ""));

    if (!isValidPhone(phone)) {
      return NextResponse.json({ error: "Invalid phone" }, { status: 400 });
    }

    // Reuse an unpaid row for this number rather than creating a new one each
    // time they edit the field or reload the page.
    const { data: existing } = await supabaseAdmin
      .from("orders")
      .select("order_number, payment_status")
      .eq("buyer_phone", phone)
      .eq("payment_status", "pending")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ order_number: existing.order_number });
    }

    const { payablePaise } = await getProductPricing();
    const orderNumber = generateOrderNumber();

    const { error } = await supabaseAdmin.from("orders").insert({
      order_number: orderNumber,
      buyer_phone: phone,
      amount_paise: payablePaise,
      payment_status: "pending",
      status: "confirmed",
      checkout_type: "standard",
    });

    if (error) {
      console.error("[Leads] insert failed:", error.message);
      return NextResponse.json({ error: "Could not save" }, { status: 500 });
    }

    return NextResponse.json({ order_number: orderNumber });
  } catch (err) {
    console.error("[Leads] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

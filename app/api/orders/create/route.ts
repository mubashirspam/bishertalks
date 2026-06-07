export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getRazorpay } from "@/lib/razorpay";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { upsertUserByPhone, normalizePhone } from "@/lib/db/users";
import { getProductPricing } from "@/lib/db/courses";
import { validatePromo, redeemPromo } from "@/lib/db/promo";

function generateOrderNumber(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const code = Array.from(
    { length: 6 },
    () => chars[Math.floor(Math.random() * chars.length)]
  ).join("");
  return `ORD-${code}`;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, phone, email, address1, address2, city, state, pincode, promoCode } =
      body;

    if (!name || !phone || !address1 || !city || !state || !pincode) {
      return NextResponse.json(
        { error: "Required fields missing" },
        { status: 400 }
      );
    }
    if (!/^[6-9]\d{9}$/.test(phone)) {
      return NextResponse.json(
        { error: "Invalid phone number" },
        { status: 400 }
      );
    }
    if (!/^\d{6}$/.test(pincode)) {
      return NextResponse.json({ error: "Invalid pincode" }, { status: 400 });
    }

    // Price comes from the DB (admin-managed). Promo discount is re-validated
    // and atomically redeemed server-side — never trust the client's amount.
    const { payablePaise } = await getProductPricing();
    let amountPaise = payablePaise;
    let discountPaise = 0;
    let appliedPromo: string | null = null;

    if (promoCode) {
      const promo = await validatePromo(promoCode, payablePaise);
      if (promo.valid && promo.discountPaise > 0 && (await redeemPromo(promo.code!))) {
        amountPaise = promo.finalPaise;
        discountPaise = promo.discountPaise;
        appliedPromo = promo.code!;
      }
    }

    const orderNumber = generateOrderNumber();
    const normalizedPhone = normalizePhone(phone);

    const razorpayOrder = await getRazorpay().orders.create({
      amount: amountPaise,
      currency: "INR",
      receipt: orderNumber,
      notes: { buyer_name: name, buyer_phone: normalizedPhone },
    });

    // Create or update the user record keyed by mobile number. Access is granted
    // later, only once payment is confirmed (verify / webhook).
    let userId: string | null = null;
    try {
      const user = await upsertUserByPhone({
        phone: normalizedPhone,
        name,
        email,
        city,
        state,
      });
      userId = user.id;
    } catch (e) {
      console.error("User upsert failed (continuing):", e);
    }

    const { error: dbError } = await supabaseAdmin.from("orders").insert({
      order_number: orderNumber,
      user_id: userId,
      buyer_name: name,
      buyer_phone: normalizedPhone,
      buyer_email: email || null,
      address_line1: address1,
      address_line2: address2 || null,
      city,
      state,
      pincode,
      razorpay_order_id: razorpayOrder.id,
      amount_paise: amountPaise,
      promo_code: appliedPromo,
      discount_paise: discountPaise,
      payment_status: "pending",
      status: "confirmed",
    });

    if (dbError) {
      console.error("DB insert error:", dbError);
      return NextResponse.json(
        { error: "Failed to create order" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      razorpay_order_id: razorpayOrder.id,
      order_number: orderNumber,
      amount: amountPaise,
      key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
    });
  } catch (err) {
    console.error("Order creation error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

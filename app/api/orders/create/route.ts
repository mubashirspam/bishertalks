import { NextRequest, NextResponse } from "next/server";
import { razorpay } from "@/lib/razorpay";
import { supabaseAdmin } from "@/lib/supabase/admin";

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
    const { name, phone, email, address1, address2, city, state, pincode } =
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

    const amountPaise = parseInt(process.env.BOOK_PRICE_PAISE || "49900");
    const orderNumber = generateOrderNumber();

    const razorpayOrder = await razorpay.orders.create({
      amount: amountPaise,
      currency: "INR",
      receipt: orderNumber,
      notes: { buyer_name: name, buyer_phone: phone },
    });

    const { error: dbError } = await supabaseAdmin.from("orders").insert({
      order_number: orderNumber,
      buyer_name: name,
      buyer_phone: phone,
      buyer_email: email || null,
      address_line1: address1,
      address_line2: address2 || null,
      city,
      state,
      pincode,
      razorpay_order_id: razorpayOrder.id,
      amount_paise: amountPaise,
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

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { grantBookBonusForOrderNumber } from "@/lib/db/access";

export async function POST(request: NextRequest) {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      order_number,
    } = await request.json();

    console.log("[Verify] Payment verification request:", {
      order_number,
      razorpay_order_id,
      razorpay_payment_id,
      has_signature: !!razorpay_signature,
    });

    if (
      !razorpay_order_id ||
      !razorpay_payment_id ||
      !razorpay_signature ||
      !order_number
    ) {
      console.error("[Verify] Missing required fields");
      return NextResponse.json(
        { success: false, error: "Missing fields" },
        { status: 400 }
      );
    }

    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET!)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      console.error("[Verify] Signature mismatch:", {
        expected: expectedSignature,
        received: razorpay_signature,
        order_number,
      });
      
      await supabaseAdmin
        .from("orders")
        .update({ payment_status: "failed" })
        .eq("order_number", order_number);

      return NextResponse.json(
        { success: false, error: "Payment verification failed" },
        { status: 400 }
      );
    }

    console.log("[Verify] Signature verified successfully for order:", order_number);

    await supabaseAdmin
      .from("orders")
      .update({
        payment_status: "paid",
        status: "confirmed",
        razorpay_payment_id,
        razorpay_signature,
      })
      .eq("order_number", order_number);

    // Auto-grant the bonus NLP course to the buyer's phone.
    try {
      await grantBookBonusForOrderNumber(order_number);
    } catch (e) {
      console.error("[Verify] Failed to grant course access:", e);
    }

    // Fire-and-forget WhatsApp notification
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    fetch(`${appUrl}/api/whatsapp/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": process.env.INTERNAL_API_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY!,
      },
      body: JSON.stringify({ order_number, event_type: "confirmed" }),
    }).catch(console.error);

    return NextResponse.json({ success: true, order_number });
  } catch (err) {
    console.error("Verify error:", err);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

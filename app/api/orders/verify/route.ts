export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { grantBookBonusForOrderNumber } from "@/lib/db/access";
import { backfillOrderFromRazorpay } from "@/lib/db/orders";
import { redeemPromo } from "@/lib/db/promo";
import { signOrderToken } from "@/lib/order-token";

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

    // Claim the pending -> paid transition atomically. The Razorpay webhook can
    // race this route for the same payment; whoever flips the row wins and runs
    // the one-time side effects (promo redemption, WhatsApp). The loser gets
    // zero rows back and skips them, so a promo can't be redeemed twice or the
    // customer messaged twice.
    const { data: claimed } = await supabaseAdmin
      .from("orders")
      .update({
        payment_status: "paid",
        status: "confirmed",
        razorpay_payment_id,
        razorpay_signature,
      })
      .eq("order_number", order_number)
      // The signature proves this Razorpay payment is genuine — it does NOT
      // prove it belongs to this order_number, which arrives in the request
      // body and is attacker-controlled. Without this line one real payment
      // could be replayed against any number of other orders, marking them
      // paid and unlocking a course for each.
      .eq("razorpay_order_id", razorpay_order_id)
      .neq("payment_status", "paid")
      .select("order_number, promo_code");

    const isFirstConfirmation = !!claimed?.length;

    if (isFirstConfirmation && claimed[0].promo_code) {
      try {
        await redeemPromo(claimed[0].promo_code);
      } catch (e) {
        console.error("[Verify] Promo redemption failed:", e);
      }
    }

    // Magic Checkout holds the buyer's contact details and shipping address —
    // pull them onto the order. Must run before the grant below, which resolves
    // the buyer from the order's phone number. Safe to re-run: it only fills
    // fields that are still empty.
    await backfillOrderFromRazorpay(order_number, razorpay_order_id);

    // Auto-grant the bonus NLP course to the buyer's phone. Idempotent upsert,
    // so it's safe even when the webhook already did it.
    try {
      await grantBookBonusForOrderNumber(order_number);
    } catch (e) {
      console.error("[Verify] Failed to grant course access:", e);
    }

    // Pick the message. In this flow the address is collected AFTER payment, so
    // normally we ask for it; if we already have one (Magic Checkout backfill,
    // or a returning customer) we confirm the order instead.
    const { data: addr } = await supabaseAdmin
      .from("orders")
      .select("address_line1")
      .eq("order_number", order_number)
      .maybeSingle();
    const whatsappEvent = addr?.address_line1 ? "confirmed" : "payment_received";

    // Fire-and-forget WhatsApp notification — only on the first confirmation.
    if (isFirstConfirmation) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
      fetch(`${appUrl}/api/whatsapp/send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": process.env.INTERNAL_API_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY!,
        },
        body: JSON.stringify({ order_number, event_type: whatsappEvent }),
      }).catch(console.error);
    }

    // Send the browser straight to the address form when we still need one.
    return NextResponse.json({
      success: true,
      order_number,
      address_url: addr?.address_line1
        ? null
        : `/neuro-code/address?id=${order_number}&t=${signOrderToken(order_number)}`,
    });
  } catch (err) {
    console.error("Verify error:", err);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

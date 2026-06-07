export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { grantBookBonusForOrderNumber } from "@/lib/db/access";

// Add RAZORPAY_WEBHOOK_SECRET to your .env.local
// Get it from: Razorpay Dashboard → Settings → Webhooks → your webhook → secret

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-razorpay-signature");

  if (!signature || !process.env.RAZORPAY_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const expectedSig = crypto
    .createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");

  if (expectedSig !== signature) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const event = JSON.parse(rawBody);
  const payment = event?.payload?.payment?.entity;
  if (!payment) return NextResponse.json({ ok: true });

  const razorpayOrderId = payment.order_id;

  if (event.event === "payment.captured") {
    const { data: order } = await supabaseAdmin
      .from("orders")
      .select("order_number, payment_status")
      .eq("razorpay_order_id", razorpayOrderId)
      .single();

    if (order && order.payment_status !== "paid") {
      await supabaseAdmin
        .from("orders")
        .update({
          payment_status: "paid",
          status: "confirmed",
          razorpay_payment_id: payment.id,
        })
        .eq("razorpay_order_id", razorpayOrderId);

      // Auto-grant the bonus NLP course to the buyer's phone.
      try {
        await grantBookBonusForOrderNumber(order.order_number);
      } catch (e) {
        console.error("[Webhook] Failed to grant course access:", e);
      }

      const appUrl = process.env.NEXT_PUBLIC_APP_URL || "";
      fetch(`${appUrl}/api/whatsapp/send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": process.env.INTERNAL_API_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY!,
        },
        body: JSON.stringify({
          order_number: order.order_number,
          event_type: "confirmed",
        }),
      }).catch(console.error);
    }
  } else if (event.event === "payment.failed") {
    await supabaseAdmin
      .from("orders")
      .update({ payment_status: "failed" })
      .eq("razorpay_order_id", razorpayOrderId);
  }

  return NextResponse.json({ ok: true });
}

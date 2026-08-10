export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { claimPaidTransition } from "@/lib/payment-claim";

// Add RAZORPAY_WEBHOOK_SECRET to your .env.local
// Get it from: Razorpay Dashboard → Settings → Webhooks → your webhook → secret
//
// Events this endpoint needs enabled: payment.captured, payment.failed,
// payment_link.paid. The last one is what flips orders paid through
// admin-generated recovery links.

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

  if (event.event === "payment_link.paid") {
    // Recovery links carry no razorpay_order_id of ours — the link id is how
    // the payment finds its order.
    const link = event?.payload?.payment_link?.entity;
    const payment = event?.payload?.payment?.entity;
    if (link?.id && payment?.id) {
      await claimPaidTransition({ paymentLinkId: link.id }, payment.id);
    }
    return NextResponse.json({ ok: true });
  }

  const payment = event?.payload?.payment?.entity;
  if (!payment) return NextResponse.json({ ok: true });

  const razorpayOrderId = payment.order_id;

  if (event.event === "payment.captured") {
    await claimPaidTransition({ razorpayOrderId }, payment.id);
  } else if (event.event === "payment.failed") {
    await supabaseAdmin
      .from("orders")
      .update({ payment_status: "failed" })
      .eq("razorpay_order_id", razorpayOrderId);
  }

  return NextResponse.json({ ok: true });
}

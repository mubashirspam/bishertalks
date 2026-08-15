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
    const claimed = await claimPaidTransition({ razorpayOrderId }, payment.id);

    // razorpay_order_id is not a stable handle on the row — a customer who
    // re-enters checkout gets a fresh Razorpay order written over it, and this
    // event, arriving late, then matches nothing and the capture is lost in
    // silence. Our own order_number is in the payment's notes and never moves,
    // so fall back to it and drag the row back onto the order that actually
    // paid. Re-running against an already-paid row is a no-op.
    if (!claimed && payment.notes?.order_number) {
      console.error(
        "[Webhook] payment.captured did not match on razorpay_order_id — falling back to notes:",
        { razorpayOrderId, paymentId: payment.id, orderNumber: payment.notes.order_number }
      );
      await claimPaidTransition(
        { orderNumber: payment.notes.order_number, razorpayOrderId },
        payment.id
      );
    }
  } else if (event.event === "payment.failed") {
    // Razorpay allows several attempts against one order_id, and this event can
    // arrive after the retry that succeeded — webhooks lag and get redelivered,
    // and payment.failed is not ordered against payment.captured. Without the
    // paid guard a failed first attempt demotes an order the customer already
    // saw succeed, and the money sits captured against a "failed" row.
    const { data: demoted } = await supabaseAdmin
      .from("orders")
      .update({ payment_status: "failed" })
      .eq("razorpay_order_id", razorpayOrderId)
      .neq("payment_status", "paid")
      .select("order_number");

    if (!demoted?.length) {
      console.error(
        "[Webhook] payment.failed ignored — order already paid or unknown:",
        { razorpayOrderId, paymentId: payment.id }
      );
    }
  }

  return NextResponse.json({ ok: true });
}

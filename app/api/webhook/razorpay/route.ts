export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { claimPaidTransition } from "@/lib/payment-claim";
import { recordRefund, type RefundLookup } from "@/lib/db/refunds";

// Add RAZORPAY_WEBHOOK_SECRET to your .env.local
// Get it from: Razorpay Dashboard → Settings → Webhooks → your webhook → secret
//
// Events this endpoint needs enabled: payment.captured, payment.failed,
// payment_link.paid, refund.created, refund.processed, refund.failed.
//
// payment_link.paid is what flips orders paid through admin-generated recovery
// links. The three refund events are what stop refunded money being counted as
// revenue — WITHOUT THEM A REFUND IS INVISIBLE HERE, because a refund issued on
// the Razorpay dashboard tells this system nothing on its own, and cancelling
// the order in the admin is a separate decision that must not be read as one.
// If refunds are not showing up, check these are ticked on the webhook first.

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

  // Money going back out. Razorpay sends three events per refund — created when
  // it is initiated, processed when the bank has it, failed if it never lands —
  // and all three carry the payment entity with its running `amount_refunded`.
  // So all three are handled by the same write, which simply assigns that total.
  //
  // Acting on `created` rather than waiting for `processed` is deliberate: a
  // refund the owner has initiated is money they have already decided to give
  // back, and the reports should stop counting it that moment. On the rare
  // failure Razorpay takes the amount out of its own total and `refund.failed`
  // puts the revenue back — which an incremental write could never do.
  if (typeof event.event === "string" && event.event.startsWith("refund.")) {
    const refund = event?.payload?.refund?.entity;

    // The gateway's total, falling back to this refund's own amount for the
    // shape of payload where the payment entity is absent. The fallback is
    // wrong for a second partial refund (it would under-count), which is
    // exactly why the clean path is preferred and this one is logged.
    const amountRefunded =
      typeof payment?.amount_refunded === "number"
        ? payment.amount_refunded
        : Number(refund?.amount ?? 0);

    if (!payment?.amount_refunded && refund) {
      console.error(
        "[Webhook] refund event carried no payment.amount_refunded — using the refund amount alone:",
        { event: event.event, refundId: refund.id, paymentId: refund.payment_id }
      );
    }

    // payment_id off the refund, because a refund event's payment entity is the
    // payment being refunded and its own id is the surest handle we hold — it
    // is written once at capture and never moves, unlike razorpay_order_id.
    const paymentId = refund?.payment_id ?? payment?.id;
    const lookups: RefundLookup[] = [];
    if (paymentId) lookups.push({ razorpayPaymentId: paymentId });
    if (payment?.order_id) lookups.push({ razorpayOrderId: payment.order_id });
    if (payment?.notes?.order_number)
      lookups.push({ orderNumber: payment.notes.order_number });

    for (const lookup of lookups) {
      const result = await recordRefund(lookup, {
        amountRefundedPaise: amountRefunded,
        refundId: refund?.id ?? null,
        // Razorpay timestamps are seconds. The refund's own time, so a refund
        // this endpoint hears about late still lands on the day it happened.
        at: refund?.created_at
          ? new Date(refund.created_at * 1000).toISOString()
          : null,
      });
      if (result) {
        if (result.changed) {
          console.log("[Webhook] refund recorded:", {
            event: event.event,
            order: result.orderNumber,
            refundedPaise: result.refundedPaise,
            full: result.full,
          });
        }
        return NextResponse.json({ ok: true });
      }
    }

    // Not ours to record. Answer 200 anyway: a 500 makes Razorpay retry an
    // event that can never match, for days.
    console.error("[Webhook] refund matched no order:", {
      event: event.event,
      refundId: refund?.id,
      paymentId,
    });
    return NextResponse.json({ ok: true });
  }

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

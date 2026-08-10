export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { grantBookBonusForOrderNumber } from "@/lib/db/access";
import { backfillOrderFromRazorpay } from "@/lib/db/orders";
import { sendPurchaseEmail } from "@/lib/db/order-email";
import { redeemPromo } from "@/lib/db/promo";

// Add RAZORPAY_WEBHOOK_SECRET to your .env.local
// Get it from: Razorpay Dashboard → Settings → Webhooks → your webhook → secret

/**
 * The pending -> paid transition and everything that follows it.
 *
 * Shared by payment.captured (checkout) and payment_link.paid (recovery links
 * generated from the admin) so the two paths can never drift — both redeem the
 * promo once, backfill the address, email the receipt, grant the course, and
 * WhatsApp the customer exactly once. The .neq("paid") claim is what makes it
 * safe: /api/orders/verify races this handler too, and only the winner runs
 * the side effects.
 */
async function claimPaidTransition(
  lookup: { razorpayOrderId: string } | { paymentLinkId: string },
  razorpayPaymentId: string
): Promise<void> {
  const query = supabaseAdmin
    .from("orders")
    .update({
      payment_status: "paid",
      status: "confirmed",
      razorpay_payment_id: razorpayPaymentId,
    })
    .neq("payment_status", "paid")
    .select("order_number, promo_code, status");

  const { data: claimed } =
    "razorpayOrderId" in lookup
      ? await query.eq("razorpay_order_id", lookup.razorpayOrderId)
      : await query.eq("payment_link_id", lookup.paymentLinkId);

  const order = claimed?.[0];
  if (!order) return;

  // A payment landing on a cancelled order is money we weren't expecting —
  // re-confirm it but make noise in the log so someone looks.
  if (order.status === "cancelled") {
    console.error("[Webhook] Payment received on cancelled order:", order.order_number);
  }

  if (order.promo_code) {
    try {
      await redeemPromo(order.promo_code);
    } catch (e) {
      console.error("[Webhook] Promo redemption failed:", e);
    }
  }

  // Payment-link orders never went through Magic Checkout, so there may be no
  // Razorpay order to backfill from — the lookup is keyed on whichever id the
  // event carries. Skipped silently when there's nothing to fetch.
  if ("razorpayOrderId" in lookup) {
    await backfillOrderFromRazorpay(order.order_number, lookup.razorpayOrderId);
  }

  // The customer who closed the tab still gets their receipt and course
  // link. Deduplicated against the verify route by invoice_email_sent_at.
  await sendPurchaseEmail(order.order_number);

  // Auto-grant the bonus NLP course to the buyer's phone.
  try {
    await grantBookBonusForOrderNumber(order.order_number);
  } catch (e) {
    console.error("[Webhook] Failed to grant course access:", e);
  }

  const { data: addr } = await supabaseAdmin
    .from("orders")
    .select("address_line1")
    .eq("order_number", order.order_number)
    .maybeSingle();
  const whatsappEvent = addr?.address_line1 ? "confirmed" : "payment_received";

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "";
  fetch(`${appUrl}/api/whatsapp/send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-secret": process.env.INTERNAL_API_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY!,
    },
    body: JSON.stringify({
      order_number: order.order_number,
      event_type: whatsappEvent,
    }),
  }).catch(console.error);
}

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
    // Recovery links carry no razorpay_order_id of ours — the link id and our
    // reference_id (order number) are how the payment finds its order.
    const link = event?.payload?.payment_link?.entity;
    const payment = event?.payload?.payment?.entity;
    const linkId = link?.id;
    if (linkId && payment?.id) {
      await claimPaidTransition({ paymentLinkId: linkId }, payment.id);
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

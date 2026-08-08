export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { grantBookBonusForOrderNumber } from "@/lib/db/access";
import { backfillOrderFromRazorpay } from "@/lib/db/orders";
import { ensureReferrerForOrder } from "@/lib/db/referrals";
import { redeemPromo } from "@/lib/db/promo";

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
    // Atomically claim the pending -> paid transition. /api/orders/verify races
    // this handler for the same payment; only the winner runs the one-time side
    // effects, so the promo can't be redeemed twice nor the customer messaged
    // twice. See the matching claim in the verify route.
    const { data: claimed } = await supabaseAdmin
      .from("orders")
      .update({
        payment_status: "paid",
        status: "confirmed",
        razorpay_payment_id: payment.id,
      })
      .eq("razorpay_order_id", razorpayOrderId)
      .neq("payment_status", "paid")
      .select("order_number, promo_code");

    const order = claimed?.[0];

    if (order) {
      if (order.promo_code) {
        try {
          await redeemPromo(order.promo_code);
        } catch (e) {
          console.error("[Webhook] Promo redemption failed:", e);
        }
      }

      // This is the only path that runs when the customer closes the tab after
      // paying, so it — not just the browser handler — has to fetch the
      // shipping address. Runs before the grant, which needs the buyer's phone.
      await backfillOrderFromRazorpay(order.order_number, razorpayOrderId);

      // The customer who closed the tab still gets their referral code.
      await ensureReferrerForOrder(order.order_number);

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
  } else if (event.event === "payment.failed") {
    await supabaseAdmin
      .from("orders")
      .update({ payment_status: "failed" })
      .eq("razorpay_order_id", razorpayOrderId);
  }

  return NextResponse.json({ ok: true });
}

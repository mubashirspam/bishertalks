export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/admin-auth";
import { getRazorpay } from "@/lib/razorpay";
import { audit } from "@/lib/audit";
import { claimPaidTransition } from "@/lib/payment-claim";

/**
 * Ask Razorpay whether the link was paid, and if so run the paid transition.
 * The webhook normally does this — this is the fallback for when the
 * payment_link.paid event wasn't enabled or the delivery failed, which
 * otherwise leaves a paid customer staring at "payment started".
 */
async function syncLinkStatus(orderNumber: string) {
  const { data: order } = await supabaseAdmin
    .from("orders")
    .select("order_number, payment_status, payment_link_id")
    .eq("order_number", orderNumber)
    .single();

  if (!order?.payment_link_id) {
    return NextResponse.json({ error: "No payment link on this order" }, { status: 400 });
  }
  if (order.payment_status === "paid") {
    return NextResponse.json({ status: "paid", changed: false });
  }

  let link;
  try {
    link = await getRazorpay().paymentLink.fetch(order.payment_link_id);
  } catch (e) {
    console.error("[PaymentLink] sync fetch failed:", order.payment_link_id, e);
    return NextResponse.json({ error: "Could not reach Razorpay" }, { status: 502 });
  }

  if (link.status !== "paid") {
    return NextResponse.json({ status: link.status, changed: false });
  }

  // payments is null until someone pays; on a paid link it lists the payment.
  const paymentId =
    (link.payments as unknown as { payment_id?: string }[] | null)?.[0]?.payment_id ??
    `plink_${order.payment_link_id}`;

  const won = await claimPaidTransition(
    { paymentLinkId: order.payment_link_id },
    paymentId
  );

  return NextResponse.json({ status: "paid", changed: !!won });
}

/**
 * Generate (or reuse) a Razorpay payment link for an unpaid order.
 *
 * Recovery path for failed and abandoned checkouts: the customer gets a hosted
 * Razorpay page — UPI with QR, cards, netbanking, wallets — for exactly this
 * order's amount, with their name/phone/email prefilled. Paying it fires the
 * payment_link.paid webhook, which runs the same paid-transition as checkout.
 *
 * Idempotent: while an unpaid link exists we return it rather than minting a
 * second one, so a customer can never pay twice through two different links.
 * `regenerate: true` cancels the old link first, then creates a fresh one.
 */
export async function POST(request: NextRequest) {
  const auth = await requirePermission("orders.edit");
  if (!auth.ok) return auth.response;

  const { order_number, regenerate, sync } = await request.json();
  if (!order_number) {
    return NextResponse.json({ error: "order_number is required" }, { status: 400 });
  }

  if (sync) return syncLinkStatus(order_number);

  const { data: order, error } = await supabaseAdmin
    .from("orders")
    .select(
      "order_number, buyer_name, buyer_phone, buyer_email, amount_paise, payment_status, payment_link_id, payment_link_url"
    )
    .eq("order_number", order_number)
    .single();

  if (error || !order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  if (order.payment_status === "paid") {
    return NextResponse.json({ error: "Order is already paid" }, { status: 400 });
  }

  const rzp = getRazorpay();

  // Reuse a live link. "created"/"partially_paid" are payable states; anything
  // else (paid, cancelled, expired) needs a new one.
  if (order.payment_link_id && order.payment_link_url && !regenerate) {
    try {
      const existing = await rzp.paymentLink.fetch(order.payment_link_id);
      if (existing.status === "created" || existing.status === "partially_paid") {
        return NextResponse.json({
          url: existing.short_url,
          link_id: existing.id,
          reused: true,
        });
      }
    } catch {
      // Link unknown to Razorpay (deleted/test mode) — fall through and mint.
    }
  }

  // Cancel a superseded link so it can't still be paid.
  if (order.payment_link_id) {
    try {
      const old = await rzp.paymentLink.fetch(order.payment_link_id);
      if (old.status === "created" || old.status === "partially_paid") {
        await rzp.paymentLink.cancel(order.payment_link_id);
      }
    } catch (e) {
      console.error("[PaymentLink] cancel old link failed:", order.payment_link_id, e);
    }
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://bishertalks.com";

  try {
    const link = await rzp.paymentLink.create({
      amount: order.amount_paise,
      currency: "INR",
      reference_id: order.order_number,
      description: `Neuro Code — order ${order.order_number}`,
      customer: {
        name: order.buyer_name ?? undefined,
        contact: order.buyer_phone ? `+91${order.buyer_phone}` : undefined,
        email: order.buyer_email ?? undefined,
      },
      notify: { sms: false, email: false },
      reminder_enable: false,
      callback_url: `${appUrl}/neuro-code/thank-you?id=${order.order_number}`,
      callback_method: "get",
    });

    const { error: saveError } = await supabaseAdmin
      .from("orders")
      .update({ payment_link_id: link.id, payment_link_url: link.short_url })
      .eq("order_number", order.order_number);

    if (saveError) {
      console.error("[PaymentLink] link created but not saved:", saveError.message);
    }

    await audit({
      actor: auth.staff,
      action: "order.payment_link",
      entity: "order",
      entityId: order.order_number,
      meta: { link_id: link.id, amount_paise: order.amount_paise },
    });

    return NextResponse.json({ url: link.short_url, link_id: link.id });
  } catch (e) {
    console.error("[PaymentLink] create failed:", e);
    return NextResponse.json(
      { error: "Could not create payment link" },
      { status: 500 }
    );
  }
}

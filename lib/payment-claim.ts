import { supabaseAdmin } from "@/lib/supabase/admin";
import { grantBookBonusForOrderNumber } from "@/lib/db/access";
import { backfillOrderFromRazorpay } from "@/lib/db/orders";
import { sendPurchaseEmail } from "@/lib/db/order-email";
import { redeemPromo } from "@/lib/db/promo";
import { notifyAfterResponse } from "@/lib/notify";

/**
 * The pending -> paid transition and everything that follows it.
 *
 * Shared by every path that can learn a payment landed — the Razorpay webhook
 * (payment.captured, payment_link.paid) and the admin's manual "sync payment
 * status" — so promo redemption, address backfill, receipt email, course grant
 * and the WhatsApp confirmation can never drift between them.
 *
 * The .neq("paid") claim is what makes it safe: /api/orders/verify races these
 * too, and only the winner runs the side effects.
 *
 * Returns the order number when this call won the claim, null when the order
 * was already paid (or doesn't exist).
 */
export async function claimPaidTransition(
  lookup: { razorpayOrderId: string } | { paymentLinkId: string },
  razorpayPaymentId: string
): Promise<string | null> {
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
  if (!order) return null;

  // A payment landing on a cancelled order is money we weren't expecting —
  // re-confirm it but make noise in the log so someone looks.
  if (order.status === "cancelled") {
    console.error("[Paid] Payment received on cancelled order:", order.order_number);
  }

  if (order.promo_code) {
    try {
      await redeemPromo(order.promo_code);
    } catch (e) {
      console.error("[Paid] Promo redemption failed:", e);
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
    console.error("[Paid] Failed to grant course access:", e);
  }

  const { data: addr } = await supabaseAdmin
    .from("orders")
    .select("address_line1")
    .eq("order_number", order.order_number)
    .maybeSingle();
  const whatsappEvent = addr?.address_line1 ? "confirmed" : "payment_received";

  notifyAfterResponse(order.order_number, whatsappEvent);

  return order.order_number;
}

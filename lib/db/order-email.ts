import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendEmail, isEmailAddress } from "@/lib/email";
import { purchaseEmail, type PurchaseEmailOrder } from "@/lib/email-templates";

// Only what the email actually shows. No bill breakdown, no attachment.
const COLUMNS =
  "order_number,buyer_name,buyer_email,buyer_phone,city,state,amount_paise," +
  "payment_status,invoice_email_sent_at";

export interface SendPurchaseEmailResult {
  sent: boolean;
  /** Why it didn't send — shown in the admin, not to the customer. */
  reason?: string;
}

/**
 * Send the order confirmation + course access email for a paid order.
 *
 * Refuses on three grounds, each returning a reason rather than throwing:
 * the order isn't paid, there's no email address (most orders — it's an
 * optional field at checkout), or one has already gone out.
 *
 * `force` is for the admin resend button, and skips only the already-sent
 * check. It can't be used to email an unpaid order.
 *
 * Never throws. This runs immediately after a payment is confirmed, and a mail
 * provider having a bad day must not turn a successful order into a 500.
 */
export async function sendPurchaseEmail(
  orderNumber: string,
  { force = false } = {}
): Promise<SendPurchaseEmailResult> {
  try {
    const { data } = await supabaseAdmin
      .from("orders")
      .select(COLUMNS)
      .eq("order_number", orderNumber)
      .maybeSingle();

    const order = data as unknown as
      | (PurchaseEmailOrder & {
          buyer_email: string | null;
          payment_status: string;
          invoice_email_sent_at: string | null;
        })
      | null;

    if (!order) return { sent: false, reason: "order not found" };

    // The email says the payment went through. It only goes out when true.
    if (order.payment_status !== "paid") {
      return { sent: false, reason: "order is not paid" };
    }

    if (!isEmailAddress(order.buyer_email)) {
      return { sent: false, reason: "no email address on this order" };
    }

    if (order.invoice_email_sent_at && !force) {
      return { sent: false, reason: "already sent" };
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://bishertalks.com";
    const { subject, html, text } = purchaseEmail(order, appUrl);

    const result = await sendEmail({
      to: order.buyer_email,
      subject,
      html,
      text,
      // Replies land somewhere a person reads, not in a no-reply void.
      replyTo: process.env.SUPPORT_EMAIL || undefined,
    });

    if (!result.sent) return { sent: false, reason: result.error };

    // Stamped only after the provider accepted it, so a failure leaves the
    // order eligible for a retry rather than silently marked as done.
    await supabaseAdmin
      .from("orders")
      .update({ invoice_email_sent_at: new Date().toISOString() })
      .eq("order_number", orderNumber);

    return { sent: true };
  } catch (e) {
    console.error("[Email] purchase email failed:", orderNumber, e);
    return { sent: false, reason: e instanceof Error ? e.message : "unknown error" };
  }
}

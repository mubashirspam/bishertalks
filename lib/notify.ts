import { sendWhatsApp } from "@/lib/whatsapp";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { addressUrl } from "@/lib/order-token";

export type OrderEvent =
  | "payment_received"
  | "confirmed"
  | "shipped"
  | "delivered"
  | "course_access";

export interface NotifyResult {
  ok: boolean;
  /** HTTP status for the route that wraps this. */
  status: number;
  error?: string;
}

/**
 * Send the WhatsApp message for an order event.
 *
 * Lives here rather than in /api/whatsapp/send so server-side callers can send
 * directly instead of making an HTTP call back into themselves. Bulk actions
 * are the reason: one internal round trip per order, each depending on
 * NEXT_PUBLIC_APP_URL pointing somewhere live, is a slow and fragile way to
 * message fifty customers. The route still exists and now delegates here, so
 * the webhook and checkout callers are unchanged.
 *
 * Never throws.
 */
export async function sendOrderNotification(
  orderNumber: string,
  event: OrderEvent
): Promise<NotifyResult> {
  try {
    const { data: order } = await supabaseAdmin
      .from("orders")
      .select("*")
      .eq("order_number", orderNumber)
      .single();

    if (!order) return { ok: false, status: 404, error: "Order not found" };

    // With Magic Checkout the phone arrives from Razorpay after payment, so an
    // order can legitimately have none yet (or the backfill failed). Bail out
    // rather than throwing on null.
    if (!order.buyer_phone) {
      console.error("[WhatsApp] no buyer_phone on order:", orderNumber);
      return { ok: false, status: 409, error: "Order has no phone number yet" };
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "";
    const trackingUrl = `${appUrl}/neuro-code/track?id=${orderNumber}`;
    const phone = `91${order.buyer_phone.replace(/^\+?91/, "")}`;

    switch (event) {
      // Payment landed but we don't have a delivery address yet — this is the
      // message that recovers a customer whose browser died after paying.
      case "payment_received":
        await sendWhatsApp({
          phone,
          templateName: "payment_received",
          parameters: [
            order.buyer_name || "there",
            orderNumber,
            String(Math.round(order.amount_paise / 100)),
            addressUrl(orderNumber),
          ],
        });
        await supabaseAdmin
          .from("orders")
          .update({ address_reminders_sent: (order.address_reminders_sent ?? 0) + 1 })
          .eq("order_number", orderNumber);
        break;

      case "confirmed":
        await sendWhatsApp({
          phone,
          templateName: "order_confirmed",
          parameters: [
            order.buyer_name,
            orderNumber,
            String(Math.round(order.amount_paise / 100)),
            `${order.city}, ${order.state}`,
            "5–7 business days",
            trackingUrl,
          ],
        });
        break;

      case "shipped":
        await sendWhatsApp({
          phone,
          templateName: "order_shipped",
          parameters: [
            order.buyer_name,
            orderNumber,
            order.courier_name || "Our courier",
            order.tracking_number || "Will update soon",
            order.expected_delivery
              ? new Date(order.expected_delivery).toLocaleDateString("en-IN", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })
              : "3–5 business days",
            trackingUrl,
          ],
        });
        break;

      case "delivered":
        await sendWhatsApp({
          phone,
          templateName: "order_delivered",
          parameters: [order.buyer_name, orderNumber, `${appUrl}/neuro-code`],
        });
        break;

      // Course-access messages are normally sent by notifyCourseAccess below,
      // because access is also granted without an order (admin, CSV import).
      // Kept here so an admin can re-send one for a purchase.
      case "course_access":
        await sendWhatsApp({
          phone,
          templateName: "course_access",
          parameters: [
            order.buyer_name || "there",
            "Neuro Linguistic Programming",
            `${appUrl}/courses/nlp`,
            order.buyer_phone.replace(/^\+?91/, ""),
          ],
        });
        break;

      default:
        return { ok: false, status: 400, error: `Unknown event_type: ${event}` };
    }

    return { ok: true, status: 200 };
  } catch (err) {
    console.error("[Notify] order event failed:", orderNumber, event, err);
    return { ok: false, status: 500, error: "Internal server error" };
  }
}


/**
 * Course-access notifications.
 *
 * Unlike order notifications these aren't tied to an order — access is also
 * granted by an admin, or by CSV import, where no order exists. So this takes a
 * phone number directly and calls the WhatsApp API server-side rather than
 * hopping through /api/whatsapp/send.
 *
 * That hop depends on NEXT_PUBLIC_APP_URL being correct; when it was pointing
 * at a dead domain every notification silently failed. A direct call can't
 * break that way.
 *
 * Never throws — a notification failure must never undo a granted course or a
 * confirmed payment.
 */
export async function notifyCourseAccess(params: {
  phone: string | null | undefined;
  name?: string | null;
  courseTitle: string;
  courseSlug: string;
}): Promise<void> {
  const { phone, name, courseTitle, courseSlug } = params;

  if (!phone) {
    console.error("[Notify] course access: no phone, skipping");
    return;
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://bishertalks.com";
  const digits = phone.replace(/\D/g, "").replace(/^91/, "");

  try {
    await sendWhatsApp({
      phone: `91${digits}`,
      templateName: "course_access",
      parameters: [
        name?.trim() || "there",
        courseTitle,
        `${appUrl}/courses/${courseSlug}`,
        digits,
      ],
    });
  } catch (e) {
    console.error("[Notify] course access send failed:", e);
  }
}

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { sendWhatsApp } from "@/lib/whatsapp";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { addressUrl } from "@/lib/order-token";

const INTERNAL_SECRET =
  process.env.INTERNAL_API_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function POST(request: NextRequest) {
  const secret = request.headers.get("x-internal-secret");
  if (secret !== INTERNAL_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { order_number, event_type } = await request.json();

    if (!order_number || !event_type) {
      return NextResponse.json(
        { error: "Missing order_number or event_type" },
        { status: 400 }
      );
    }

    const { data: order } = await supabaseAdmin
      .from("orders")
      .select("*")
      .eq("order_number", order_number)
      .single();

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    // With Magic Checkout the phone arrives from Razorpay after payment, so an
    // order can legitimately have none yet (or the backfill failed). Bail out
    // rather than throwing on null.
    if (!order.buyer_phone) {
      console.error("[WhatsApp] no buyer_phone on order:", order_number);
      return NextResponse.json(
        { error: "Order has no phone number yet" },
        { status: 409 }
      );
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "";
    const trackingUrl = `${appUrl}/neuro-code/track?id=${order_number}`;
    const phone = `91${order.buyer_phone.replace(/^\+?91/, "")}`;

    switch (event_type) {
      // Payment landed but we don't have a delivery address yet — this is the
      // message that recovers a customer whose browser died after paying.
      case "payment_received":
        await sendWhatsApp({
          phone,
          templateName: "payment_received",
          parameters: [
            order.buyer_name || "there",
            order_number,
            String(Math.round(order.amount_paise / 100)),
            addressUrl(order_number),
          ],
        });
        await supabaseAdmin
          .from("orders")
          .update({ address_reminders_sent: (order.address_reminders_sent ?? 0) + 1 })
          .eq("order_number", order_number);
        break;

      case "confirmed":
        await sendWhatsApp({
          phone,
          templateName: "order_confirmed",
          parameters: [
            order.buyer_name,
            order_number,
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
            order_number,
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
          parameters: [
            order.buyer_name,
            order_number,
            `${appUrl}/neuro-code`,
          ],
        });
        break;

      // Course-access messages are sent directly via lib/notify.ts, because
      // access is also granted without an order (admin, CSV import). Kept here
      // so an admin can manually re-send one for a purchase.
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
        return NextResponse.json(
          { error: `Unknown event_type: ${event_type}` },
          { status: 400 }
        );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[/api/whatsapp/send] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

import { orderStage } from "@/lib/order-stage";
import { deliveryStage } from "@/lib/delivery-stage";
import { addressUrl } from "@/lib/order-token";

/**
 * Pre-filled WhatsApp text for admins reaching out to a customer, matched to
 * where the order actually is — funnel stage for the Orders list, delivery
 * stage for the Delivery worklist — instead of a blank chat every time.
 */

interface FunnelInput {
  order_number: string;
  buyer_name: string | null;
  razorpay_order_id: string | null;
  payment_status: string;
  address_line1: string | null;
}

export function funnelWaMessage(o: FunnelInput): string {
  const name = o.buyer_name?.trim() || "there";
  switch (orderStage(o)) {
    case "lead":
      return `Hi ${name}, this is Bisher Talks 👋 We noticed you were checking out Neuro Code but didn't finish your order. Need any help, or have a question about the book?`;
    case "payment_started":
      return `Hi ${name}, this is Bisher Talks. Your payment for order ${o.order_number} looks like it didn't go through. Would you like help completing it?`;
    case "failed":
      return `Hi ${name}, this is Bisher Talks. We saw your payment for order ${o.order_number} failed — no worries, would you like a fresh payment link to try again?`;
    case "paid_no_address":
      return `Hi ${name}, thank you for ordering Neuro Code! 🎉 Order ${o.order_number} is confirmed — we just need your delivery address to ship your book. Please share it here: ${addressUrl(o.order_number)}`;
    case "complete":
      return `Hi ${name}, this is Bisher Talks regarding your order ${o.order_number} for Neuro Code. How can we help you?`;
  }
}

interface DeliveryInput {
  order_number: string;
  buyer_name: string | null;
  status: string;
  label_downloaded_at: string | null;
  courier_name: string | null;
  tracking_number: string | null;
}

export function deliveryWaMessage(o: DeliveryInput): string {
  const name = o.buyer_name?.trim() || "there";
  const trackingUrl = `${process.env.NEXT_PUBLIC_APP_URL || "https://bishertalks.com"}/neuro-code/track?id=${o.order_number}`;

  switch (deliveryStage(o)) {
    case "to_print":
      return `Hi ${name}, this is Bisher Talks 📚 Your order ${o.order_number} for Neuro Code is confirmed and being prepared for dispatch. We'll notify you the moment it ships!`;
    case "packed":
      return `Hi ${name}, good news! 📦 Your order ${o.order_number} is packed and ready — it'll be handed to the courier shortly. Track anytime here: ${trackingUrl}`;
    case "shipped":
      return `Hi ${name}, your order ${o.order_number} is on its way! 🚚${o.courier_name ? ` Courier: ${o.courier_name}.` : ""}${o.tracking_number ? ` Tracking ID: ${o.tracking_number}.` : ""} Track it here: ${trackingUrl}`;
    case "out_for_delivery":
      return `Hi ${name}, your order ${o.order_number} is out for delivery today! 🛵 Please keep your phone handy for the courier.`;
    case "delivered":
      return `Hi ${name}, hope Neuro Code (order ${o.order_number}) reached you safely! 🎉 Don't forget — your free NLP Mastery course is unlocked. Happy reading!`;
    case "cancelled":
      return `Hi ${name}, your order ${o.order_number} has been cancelled. Let us know if you'd like to place a new order or need any help.`;
  }
}

/** wa.me link with the message pre-filled, ready to send on click. */
export function waLink(phone: string, message: string): string {
  return `https://wa.me/91${phone}?text=${encodeURIComponent(message)}`;
}

export function telLink(phone: string): string {
  return `tel:+91${phone}`;
}

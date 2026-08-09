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
  const name = o.buyer_name?.trim() || "";
  const greeting = name ? `Hi ${name},` : "Hi,";
  switch (orderStage(o)) {
    case "lead":
      return `Hi ${name}......\n*Neuro Code വാങ്ങാൻ ശ്രമിച്ചതായി കണ്ടു.*\n*കൂടുതൽ എന്തെങ്കിലും അറിയാനുണ്ടോ?*\nഎന്തെങ്കിലും സഹായം ആവശ്യമുണ്ടോ?\nഎങ്കിൽ അറിയിക്കണേ.... ഇല്ലെങ്കിൽ ലിങ്കിൽ കയറി payment ചെയ്ത് കോഴ്‌സ് access നേടാം.. ഒപ്പം നിങ്ങളുടെ അഡ്രസ്സിൽ book അയച്ച് തരുകയും ചെയ്യാം...\nThank you`;
    case "payment_started":
      return `${greeting} ഇത് Bisher Talks ആണ്. നിങ്ങളുടെ ഓർഡർ ${o.order_number}-ന്റെ payment complete ആയിട്ടില്ല എന്ന് കാണുന്നു. Payment പൂർത്തിയാക്കാൻ സഹായം വേണോ?`;
    case "failed":
      return `${greeting} ഇത് Bisher Talks ആണ്. നിങ്ങളുടെ ഓർഡർ ${o.order_number}-ന്റെ payment fail ആയതായി കണ്ടു — വിഷമിക്കേണ്ട, വീണ്ടും ശ്രമിക്കാൻ പുതിയ payment link വേണോ?`;
    case "paid_no_address":
      return `${greeting} Neuro Code ഓർഡർ ചെയ്തതിന് നന്ദി! 🎉 ഓർഡർ ${o.order_number} confirm ആയി — book അയക്കാൻ നിങ്ങളുടെ delivery address മാത്രം വേണം. ദയവായി ഇവിടെ അയക്കൂ: ${addressUrl(o.order_number)}`;
    case "complete":
      return `${greeting} ഇത് Bisher Talks ആണ്, നിങ്ങളുടെ Neuro Code ഓർഡർ ${o.order_number} സംബന്ധിച്ച്. എങ്ങനെ സഹായിക്കാം?`;
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

import { orderStage } from "@/lib/order-stage";
import { deliveryStage } from "@/lib/delivery-stage";
import { addressUrl } from "@/lib/order-token";
import { BOOK_BONUS_COURSE_SLUG } from "@/lib/types/db";
import { NEXT_EDITION_PRICE, editionDispatchDayLabelMl } from "@/lib/preorder";

/**
 * Pre-filled WhatsApp text for admins reaching out to a customer, matched to
 * where the order actually is — funnel stage for the Orders list, delivery
 * stage for the Delivery worklist — instead of a blank chat every time.
 */

/**
 * Canonical site, with a guard.
 *
 * These links are pasted into a real customer's chat by hand, so a localhost
 * URL from a dev environment would be sent to someone who can't open it.
 */
export function siteUrl(): string {
  const url = process.env.NEXT_PUBLIC_APP_URL || "";
  return !url || /localhost|127\.0\.0\.1/.test(url) ? "https://bishertalks.com" : url;
}

function courseUrl(): string {
  return `${siteUrl()}/courses/${BOOK_BONUS_COURSE_SLUG}`;
}

/**
 * The 10 digits the customer types to get into the course.
 *
 * Exported for `lib/crm/quick-replies.ts`, which sends the same course link
 * by hand from the CRM thread and has to quote the same number. Two copies of
 * this would drift the first time somebody's phone arrived with a country code
 * one of them did not strip.
 */
export function loginPhone(phone: string | null | undefined): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/**
 * The message for a customer who has paid.
 *
 * This is the one that matters most right now: course access is keyed to the
 * phone number, and buyers who never gave an email address get no receipt mail
 * at all — so this hand-sent message is their only route to the course link.
 * No order number in it deliberately; the customer has no use for one, and it
 * makes the message read like a thank-you rather than a ticket.
 *
 * It also carries the 4th-edition pre-booking news, because this is the first
 * thing a buyer hears after paying and "it ships in 5–7 days" is no longer
 * true: the book is being printed. Saying so here, next to the price they are
 * NOT being charged, is what stops the "where is my book" message on day six.
 */
function paidThankYouMessage(o: {
  buyer_name: string | null;
  buyer_phone: string | null;
}): string {
  const name = o.buyer_name?.trim();
  const greeting = name ? `Hi ${name} 🙏` : "Hi 🙏";

  return `${greeting}
*നിങ്ങളുടെ ഓർഡർ സ്വീകരിച്ചിരിക്കുന്നു!* ✅
Neuro Code ബുക്ക് ഓർഡർ ചെയ്തതിന് ഒരുപാട് നന്ദി ❤️

📦 കഴിഞ്ഞ ദിവസങ്ങളിൽ കൂടുതൽ ഓർഡർ വന്നതിനാൽ Neuro Code മൂന്നാം പതിപ്പ് കഴിഞ്ഞു. നാലാം പതിപ്പ് *${editionDispatchDayLabelMl()}* മുതലാണ് വിതരണം ചെയ്യുക.
നാലാം പതിപ്പിന് *${NEXT_EDITION_PRICE} രൂപ* ആയിരിക്കും വില. But നിങ്ങൾ already ഓർഡർ ചെയ്തതിനാൽ same വിലയിൽ തന്നെ നൽകും.

🎁 ഒപ്പം ലഭിക്കുന്ന *സൗജന്യ NLP കോഴ്‌സ്* ഇപ്പോൾ തന്നെ തുടങ്ങാം:
${courseUrl()}

കോഴ്‌സിൽ കയറാൻ നിങ്ങളുടെ മൊബൈൽ നമ്പർ മാത്രം മതി 👇
*${loginPhone(o.buyer_phone)}*
(password ഒന്നും വേണ്ട)

⏳ കോഴ്‌സ് access ഇപ്പോൾ മുതൽ *ഒരു വർഷം* വരെ ഉപയോഗിക്കാവുന്നതാണ്.

സഹകരണത്തിന് നന്ദി 🙏
എന്തെങ്കിലും സംശയമുണ്ടെങ്കിൽ ഈ നമ്പറിൽ മെസ്സേജ് ചെയ്യൂ.
_Team Neuro Code — Bisher Talks_`;
}

interface FunnelInput {
  order_number: string;
  buyer_name: string | null;
  buyer_phone: string | null;
  razorpay_order_id: string | null;
  payment_status: string;
  address_line1: string | null;
  /** Read by orderStage(), and quoted in the refund message below. */
  refunded_paise: number;
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
    // Paid, but we still can't ship. The address ask stays first and alone at
    // the top — burying it under the course link is how it gets missed — with
    // the course as a separate, clearly secondary block.
    case "paid_no_address":
      return `${greeting}
*നിങ്ങളുടെ ഓർഡർ വിജയകരമായി ലഭിച്ചു!* ✅
Neuro Code ഓർഡർ ചെയ്തതിന് ഒരുപാട് നന്ദി ❤️

📮 ബുക്ക് അയക്കാൻ നിങ്ങളുടെ *delivery address* മാത്രം വേണം. ദയവായി ഇവിടെ നൽകൂ:
${addressUrl(o.order_number)}
അഡ്രസ്സ് ലഭിച്ചാൽ *7–12 ദിവസത്തിനുള്ളിൽ* ബുക്ക് എത്തിക്കും.

🎁 ഒപ്പം ലഭിക്കുന്ന *സൗജന്യ NLP കോഴ്‌സ്* ഇപ്പോൾ തന്നെ തുടങ്ങാം:
${courseUrl()}
കയറാൻ നിങ്ങളുടെ മൊബൈൽ നമ്പർ മാത്രം മതി: *${loginPhone(o.buyer_phone)}*

_Bisher Talks_`;
    case "complete":
      return paidThankYouMessage(o);
    // The one message here that is not a chase. Nothing is being asked for —
    // it exists so the WhatsApp button on a refunded row does something useful
    // instead of offering to thank someone for money we have given back. The
    // bank delay is the part worth saying: the refund leaves Razorpay at once
    // and shows up in the customer's account days later, which is exactly the
    // gap that produces "where is my money" messages.
    case "refunded":
      return `Hi ${name}, your order ${o.order_number} has been refunded. ₹${Math.round(o.refunded_paise / 100).toLocaleString("en-IN")} has been sent back to the account you paid from — banks usually take 5–7 working days to show it. Do let us know if you don't see it by then.`;
  }
}

interface DeliveryInput {
  order_number: string;
  buyer_name: string | null;
  buyer_phone: string | null;
  status: string;
  assigned_agent_id: string | null;
  /**
   * Read by deliveryStage(). Without it, a parcel routed to a courier but
   * given to no staff member reads as "New" and the customer is offered the
   * thank-you-for-paying message instead of "it is packed and on its way".
   */
  courier_id?: string | null;
  courier_name: string | null;
  tracking_number: string | null;
}

export function deliveryWaMessage(o: DeliveryInput): string {
  const name = o.buyer_name?.trim() || "there";
  const trackingUrl = `${siteUrl()}/neuro-code/track?id=${o.order_number}`;

  switch (deliveryStage(o)) {
    // Nobody has picked this parcel up yet, so from the customer's side this is
    // still "I just paid" — the same moment the Orders list is messaging about.
    // Same message, so it can't matter which screen the admin clicks from.
    case "new":
      return paidThankYouMessage(o);
    case "assigned":
      return `Hi ${name}, good news! 📦 Your order ${o.order_number} is packed and ready — it'll be handed to the courier shortly. Track anytime here: ${trackingUrl}`;
    case "shipped":
      return `Hi ${name}, your order ${o.order_number} is on its way! 🚚${o.courier_name ? ` Courier: ${o.courier_name}.` : ""}${o.tracking_number ? ` Tracking ID: ${o.tracking_number}.` : ""} Track it here: ${trackingUrl}`;
    case "out_for_delivery":
      return `Hi ${name}, your order ${o.order_number} is out for delivery today! 🛵 Please keep your phone handy for the courier.`;
    case "delivered":
      return `Hi ${name}, hope Neuro Code (order ${o.order_number}) reached you safely! 🎉 Don't forget — your free NLP Mastery course is unlocked. Happy reading!`;
    case "returned":
      return `Hi ${name}, your order ${o.order_number} came back to us undelivered. Would you like us to send it again? Just reply with the best address and time to reach you.`;
    case "cancelled":
      return `Hi ${name}, your order ${o.order_number} has been cancelled. Let us know if you'd like to place a new order or need any help.`;
  }
}

/**
 * wa.me link with the message pre-filled, ready to send on click.
 *
 * The number is reduced to 10 digits first: `buyer_phone` is whatever the
 * customer typed or Razorpay sent back, so one already carrying +91 would
 * otherwise produce wa.me/91+919876543210 and open a dead chat.
 */
export function waLink(phone: string, message: string): string {
  return `https://wa.me/91${loginPhone(phone)}?text=${encodeURIComponent(message)}`;
}

export function telLink(phone: string): string {
  return `tel:+91${loginPhone(phone)}`;
}

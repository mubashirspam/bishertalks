/**
 * Meta Pixel events.
 *
 * The pixel itself is initialised inline in app/layout.tsx; this is how the
 * rest of the app reports what a visitor did. Every call is a no-op when the
 * pixel isn't loaded — blocked by an ad blocker, disabled in development, or
 * simply not finished loading — so nothing here can break a page.
 *
 * PageView is handled centrally (layout + route tracker). These are the events
 * that tell Meta which ads actually produce sales, which is what its
 * optimisation runs on. Without at least Purchase, ad delivery is guesswork.
 */

/** The single product this store sells. */
export const PIXEL_CONTENT_ID = "neuro-code-book";

interface PixelParams {
  value?: number;
  currency?: string;
  content_ids?: string[];
  content_name?: string;
  content_type?: string;
  num_items?: number;
}

function track(event: string, params?: PixelParams, eventId?: string) {
  if (typeof window === "undefined" || !window.fbq) return;
  try {
    // The third argument carries an event ID. Meta uses it to collapse
    // duplicates, which matters on pages a customer can reload.
    if (eventId) window.fbq("track", event, params ?? {}, { eventID: eventId });
    else window.fbq("track", event, params ?? {});
  } catch {
    // An analytics failure is never worth surfacing to a customer.
  }
}

/** Someone looked at the book. Fired on the landing page. */
export function trackViewContent(priceRupees: number) {
  track("ViewContent", {
    content_ids: [PIXEL_CONTENT_ID],
    content_name: "Neuro Code",
    content_type: "product",
    value: priceRupees,
    currency: "INR",
  });
}

/** Someone clicked through to buy. The strongest pre-purchase signal. */
export function trackInitiateCheckout(priceRupees: number) {
  track("InitiateCheckout", {
    content_ids: [PIXEL_CONTENT_ID],
    content_name: "Neuro Code",
    content_type: "product",
    num_items: 1,
    value: priceRupees,
    currency: "INR",
  });
}

/** They typed a usable mobile number — the point they become contactable. */
export function trackLead() {
  track("Lead", { content_name: "Neuro Code checkout" });
}

/**
 * Money changed hands.
 *
 * `orderNumber` is passed as the event ID so refreshing the thank-you page
 * doesn't report the same sale twice and inflate the ad platform's idea of how
 * well a campaign is doing.
 */
export function trackPurchase(orderNumber: string, amountRupees: number) {
  track(
    "Purchase",
    {
      content_ids: [PIXEL_CONTENT_ID],
      content_name: "Neuro Code",
      content_type: "product",
      num_items: 1,
      value: amountRupees,
      currency: "INR",
    },
    orderNumber
  );
}

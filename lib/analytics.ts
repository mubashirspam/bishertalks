/**
 * Google Analytics 4 events.
 *
 * The tag itself is initialised inline in app/layout.tsx; this is how the rest
 * of the app reports what a visitor did. Every call is a no-op when gtag isn't
 * loaded — blocked by an ad blocker, no measurement ID configured, or simply
 * not finished loading — so nothing here can break a page.
 *
 * These mirror lib/pixel.ts one for one, in GA's own vocabulary, so the two
 * platforms can be reconciled against each other:
 *
 *   Meta                GA4
 *   ViewContent         view_item
 *   InitiateCheckout    begin_checkout
 *   Lead                generate_lead
 *   Purchase            purchase
 *
 * The names are GA's recommended e-commerce events, not invented ones — that
 * is what lights up the Monetisation reports and makes the events usable as
 * Google Ads conversions without extra configuration.
 */

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
  }
}

/** The single product this store sells. Matches PIXEL_CONTENT_ID on purpose. */
export const GA_ITEM_ID = "neuro-code-book";

interface GaItem {
  item_id: string;
  item_name: string;
  price: number;
  quantity: number;
}

interface GaParams {
  currency?: string;
  value?: number;
  transaction_id?: string;
  items?: GaItem[];
}

function track(event: string, params?: GaParams) {
  if (typeof window === "undefined" || !window.gtag) return;
  try {
    window.gtag("event", event, params ?? {});
  } catch {
    // An analytics failure is never worth surfacing to a customer.
  }
}

/** The one line item, priced at whatever the visitor is actually being charged. */
function bookItem(priceRupees: number): GaItem[] {
  return [
    {
      item_id: GA_ITEM_ID,
      item_name: "Neuro Code",
      price: priceRupees,
      quantity: 1,
    },
  ];
}

/** Someone looked at the book. Fired on the landing page. */
export function gaViewItem(priceRupees: number) {
  track("view_item", {
    currency: "INR",
    value: priceRupees,
    items: bookItem(priceRupees),
  });
}

/** Someone clicked through to buy. The strongest pre-purchase signal. */
export function gaBeginCheckout(priceRupees: number) {
  track("begin_checkout", {
    currency: "INR",
    value: priceRupees,
    items: bookItem(priceRupees),
  });
}

/** They typed a usable mobile number — the point they become contactable. */
export function gaGenerateLead() {
  track("generate_lead", { currency: "INR", value: 0 });
}

/**
 * Money changed hands.
 *
 * `transaction_id` is the order number, which is what GA deduplicates on: the
 * thank-you page is reloaded by customers re-reading their order number, and
 * without it every reload would count as another sale.
 */
export function gaPurchase(orderNumber: string, amountRupees: number) {
  track("purchase", {
    transaction_id: orderNumber,
    currency: "INR",
    value: amountRupees,
    items: bookItem(amountRupees),
  });
}

import type { Courier } from "./types";

/**
 * The courier's own tracking page — the one we send the *customer* to.
 *
 * Deliberately not canTrack(). That asks whether we can pull scans over an
 * API; this asks whether there is a page a buyer can open. The two come apart
 * in both directions: a courier could publish a page we have no integration
 * for, and our pull API is no use to someone refreshing on their phone waiting
 * for the doorbell.
 *
 * Worth linking even though we draw a stepper of our own, because we keep one
 * scan — the latest — and their page keeps every hop, with the branch it is
 * sitting in and the delivery attempt that failed yesterday. That is what a
 * customer is actually asking when they open this page for the fourth time.
 */

interface PublicPage {
  /** Whose page this is, in the buyer's words. */
  name: string;
  url(waybill: string): string;
}

/** Where each tracking integration publishes its consumer-facing page. */
const PUBLIC_PAGES: Record<string, PublicPage> = {
  delhivery: {
    name: "Delhivery",
    // Their long-standing path, which today 301s to /track-v2/package/. We
    // link the stable one on purpose: the redirect is Delhivery's to maintain,
    // and pinning v2 breaks the day it becomes v3.
    url: (waybill) => `https://www.delhivery.com/track/package/${waybill}`,
  },
};

export interface PublicTracking {
  url: string;
  /**
   * The brand on the page, which is not always the partner's name in our list:
   * a parcel routed to "KKR Logistics (Delhivery)" lands on delhivery.com, and
   * the button has to say the name the buyer will see when it opens.
   */
  name: string;
}

/**
 * Where this parcel can be looked up on the courier's site, or null.
 *
 * Null covers every honest reason there is no link — no courier assigned, no
 * waybill typed in yet, or a partner with no public page — and the caller shows
 * nothing rather than a link that 404s on the buyer.
 */
export function publicTracking(
  courier: Pick<Courier, "config"> | null,
  waybill: string | null | undefined
): PublicTracking | null {
  const awb = waybill?.trim();
  const tracking = courier?.config.tracking;
  const page = tracking ? PUBLIC_PAGES[tracking] : undefined;
  if (!awb || !page) return null;

  return { url: page.url(encodeURIComponent(awb)), name: page.name };
}

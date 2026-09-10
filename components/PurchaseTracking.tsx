"use client";

import { useEffect, useRef } from "react";
import { trackPurchase, type PixelAccount } from "@/lib/pixel";
import { gaPurchase } from "@/lib/analytics";

/**
 * Reports a completed sale to Meta and to Google Analytics.
 *
 * A client component because the thank-you page is rendered on the server and
 * both tags only exist in the browser.
 *
 * Guarded twice against double-counting: a ref so React's development
 * double-render doesn't fire it twice, and the order number as the event ID
 * (Meta) and transaction ID (GA) so reloading the page — which customers do,
 * to re-read their order number — is collapsed into the one sale it actually
 * was.
 */
export default function PurchaseTracking({
  orderNumber,
  amountRupees,
  pixelAccount,
}: {
  orderNumber: string;
  amountRupees: number;
  /**
   * Which ad account actually drove this sale, resolved server-side from the
   * order's own stored landing page (see the thank-you page) rather than
   * guessed from the browser's cookie — the one answer that can't drift from
   * a cleared cookie or a purchase finished days after the click. Omitted
   * falls back to the browser's own guess, for any order placed before this
   * had a stored answer.
   */
  pixelAccount?: PixelAccount;
}) {
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    trackPurchase(orderNumber, amountRupees, pixelAccount);
    gaPurchase(orderNumber, amountRupees);
  }, [orderNumber, amountRupees, pixelAccount]);

  return null;
}

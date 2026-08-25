"use client";

import { useEffect, useRef } from "react";
import { trackPurchase } from "@/lib/pixel";
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
}: {
  orderNumber: string;
  amountRupees: number;
}) {
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    trackPurchase(orderNumber, amountRupees);
    gaPurchase(orderNumber, amountRupees);
  }, [orderNumber, amountRupees]);

  return null;
}

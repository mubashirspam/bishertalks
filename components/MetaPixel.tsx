"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { pixelIdFor, resolveVisitorPixelAccount } from "@/lib/pixel";

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

/**
 * Fires a PageView on client-side navigation.
 *
 * The snippet Meta gives you assumes every navigation is a full page load. This
 * is a single-page app — going from the landing page to checkout never reloads
 * the document — so on its own that snippet counts one PageView per session and
 * misses everything after it.
 *
 * The initial PageView comes from the inline script in the layout's <head>;
 * this only covers the ones after it.
 *
 * Reported with `trackSingle`, to whichever account resolveVisitorPixelAccount
 * says this visitor belongs to — not a blanket `track` into both. A visitor
 * navigating from /neuro-code-b to the shared checkout still belongs to
 * Account B even though the URL no longer says so; that function is what
 * remembers.
 */
export default function MetaPixelRouteTracker() {
  const pathname = usePathname();
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      // Already counted by the init script.
      isFirstRender.current = false;
      return;
    }
    window.fbq?.("trackSingle", pixelIdFor(resolveVisitorPixelAccount()), "PageView");
  }, [pathname]);

  return null;
}

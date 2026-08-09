"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

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
    window.fbq?.("track", "PageView");
  }, [pathname]);

  return null;
}

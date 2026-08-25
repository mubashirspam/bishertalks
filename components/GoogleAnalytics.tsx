"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";

/**
 * Fires a page_view on client-side navigation.
 *
 * Same problem the Meta pixel has (see MetaPixel.tsx): gtag.js counts one
 * page_view when the document loads, and this is a single-page app — going
 * from the landing page to checkout to thank-you never reloads the document,
 * so without this GA reports every session as a single page and the funnel
 * looks like nobody ever moves.
 *
 * The first page_view comes from the `gtag('config', ...)` call in the
 * layout's <head>; this only covers the ones after it.
 */
function RouteTracker() {
  const pathname = usePathname();
  // Query strings matter here: the thank-you page is /neuro-code/thank-you?order=…
  // and a navigation that only changes the query would otherwise go uncounted.
  const searchParams = useSearchParams();
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      // Already counted by the config call.
      isFirstRender.current = false;
      return;
    }
    const query = searchParams.toString();
    const path = query ? `${pathname}?${query}` : pathname;
    // page_location must be absolute — GA treats a bare path as a relative URL
    // and the report fills up with unresolvable page paths.
    window.gtag?.("event", "page_view", {
      page_path: path,
      page_location: `${window.location.origin}${path}`,
      page_title: document.title,
    });
  }, [pathname, searchParams]);

  return null;
}

/**
 * useSearchParams() suspends, and an unwrapped one in the root layout would
 * opt every page in the site out of static rendering. The boundary is part of
 * the component rather than the layout's problem, so it can't be forgotten.
 */
export default function GoogleAnalyticsRouteTracker() {
  return (
    <Suspense fallback={null}>
      <RouteTracker />
    </Suspense>
  );
}

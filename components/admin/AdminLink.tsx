"use client";

import Link from "next/link";
import type { ComponentProps } from "react";

/**
 * A `next/link` that does not prefetch.
 *
 * Prefetching is a good default for a static marketing page and a very
 * expensive one here. Every admin route is `force-dynamic`, so prefetching one
 * does not warm a cache — it runs the whole chain on the server, for a page
 * nobody has opened:
 *
 *   1. a Vercel edge request (the middleware matcher includes /admin)
 *   2. /auth/v1/user      — proxy.ts, adminGate
 *   3. /auth/v1/user      — the layout, via getCurrentStaff()
 *   4. /rest/v1/staff     — getStaffByAuthId(), inside the same call
 *   5. the sidebar work-count, which is a join-and-scan
 *
 * Next prefetches a link when it scrolls into the viewport, and the admin is
 * built out of long tables — 100 rows on the portal, 50 on the delivery queue —
 * each carrying a link. The sidebar is worse: its ~8 nav links render on every
 * admin page, so opening anything prefetched /admin/delivery, and /admin/delivery
 * answers with eight count queries and a full-table stats scan.
 *
 * What that measured as: 85% of all Supabase requests were /auth/v1/user, 46 of
 * them inside 11 seconds from one person scrolling one page, an instance pinned
 * at 84% compute, and over a million Vercel edge requests.
 *
 * The cost of turning it off is that a click fetches instead of arriving warm.
 * On an internal panel that is the right trade, and it was never a real warm
 * arrival anyway — a dynamic route is re-rendered on navigation regardless.
 *
 * Use this for every link inside /admin. Ordinary `next/link` is still correct
 * on the public site, where routes are cacheable and prefetching is free.
 */
export default function AdminLink(props: ComponentProps<typeof Link>) {
  return <Link {...props} prefetch={false} />;
}

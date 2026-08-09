export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { recordClick } from "@/lib/db/referrals";
import { normalizeCode, isValidCodeFormat } from "@/lib/referral";

/**
 * The share link: bishertalks.com/refer/PRIYA7K2
 *
 * Counts the click, then redirects to the book page with `?ref=` attached so
 * the existing attribution middleware does the actual cookie work. One capture
 * path for every kind of traffic — a referral is just a source with a code on
 * it, and there is no second mechanism to keep in sync.
 *
 * A path is used rather than a bare query string because this gets pasted into
 * WhatsApp, where a clean link is more likely to be tapped.
 */
/** Campaign tags worth carrying through the redirect. Nothing else is copied. */
const FORWARDED = ["utm_source", "utm_medium", "utm_campaign", "utm_content"];

/**
 * Where a referral link may point, as an exact-match allow-list.
 *
 * A referral link can target any of these via ?to=, so a referrer can send
 * people straight to checkout or to the free course rather than always the
 * book page. It is an allow-list and not a pass-through because `to` comes
 * from a URL anyone can edit — accepting arbitrary values would turn this
 * into an open redirect, and an open redirect on a domain customers trust is
 * a phishing tool.
 */
const DESTINATIONS = ["/neuro-code", "/neuro-code/checkout", "/", "/courses"];
const DEFAULT_DESTINATION = "/neuro-code";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code: raw } = await params;
  const code = normalizeCode(raw);

  const requested = request.nextUrl.searchParams.get("to");
  const destination =
    requested && DESTINATIONS.includes(requested) ? requested : DEFAULT_DESTINATION;

  const target = new URL(
    destination,
    process.env.NEXT_PUBLIC_APP_URL || "https://bishertalks.com"
  );

  // Carry campaign tags across the hop. Without this, a referrer's story link
  // and their bio link are indistinguishable — the tag would be dropped here
  // and never reach the attribution middleware.
  //
  // An explicit allow-list, not a blind copy of the query string: this
  // redirect must not become a way to smuggle arbitrary parameters onto the
  // landing page.
  for (const key of FORWARDED) {
    const value = request.nextUrl.searchParams.get(key);
    if (value) target.searchParams.set(key, value.slice(0, 120));
  }

  // An invalid code still lands on the book page rather than a 404 — someone
  // mistyping a friend's code should see the product, not an error.
  if (isValidCodeFormat(code)) {
    target.searchParams.set("ref", code);
    // Not awaited: the click counter must never delay or fail the redirect.
    recordClick(code).catch(() => {});
  }

  return NextResponse.redirect(target, 302);
}

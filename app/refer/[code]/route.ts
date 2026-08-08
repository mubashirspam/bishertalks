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
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code: raw } = await params;
  const code = normalizeCode(raw);

  const target = new URL(
    "/neuro-code",
    process.env.NEXT_PUBLIC_APP_URL || "https://bishertalks.com"
  );

  // An invalid code still lands on the book page rather than a 404 — someone
  // mistyping a friend's code should see the product, not an error.
  if (isValidCodeFormat(code)) {
    target.searchParams.set("ref", code);
    // Not awaited: the click counter must never delay or fail the redirect.
    recordClick(code).catch(() => {});
  }

  return NextResponse.redirect(target, 302);
}

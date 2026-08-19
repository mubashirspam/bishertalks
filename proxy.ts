import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  parseAttribution,
  directAttribution,
  encodeAttribution,
  ATTR_FIRST_COOKIE,
  ATTR_LAST_COOKIE,
  ATTR_SESSION_COOKIE,
  ATTR_MAX_AGE,
} from "@/lib/attribution";

/**
 * Two jobs, deliberately kept apart.
 *
 * `/admin` and `/auth` need a Supabase session check, which is a network call.
 * Every other page needs traffic attribution, which is pure string work on
 * data already in the request. Running the session check on the public site
 * would put a Supabase round trip in front of every visitor for no reason —
 * so the branch happens first, and only the matching half runs.
 */
export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (pathname.startsWith("/admin") || pathname.startsWith("/auth")) {
    return adminGate(request);
  }

  return captureAttribution(request);
}

/** Session check for the admin panel. */
async function adminGate(request: NextRequest) {
  // A prefetch is not a navigation, and gets no session check.
  //
  // `getUser()` below is a network round trip to Supabase Auth — the single
  // most-made request in this application, once measured at 85% of all Supabase
  // traffic. Prefetches were most of that: Next fetches a route when its link
  // scrolls into view, and every one of those paid for a full auth call before
  // rendering a page nobody had opened.
  //
  // Links inside /admin no longer prefetch (see components/admin/AdminLink),
  // so this should now be unreachable in normal use. It stays as the backstop:
  // one ordinary `next/link` added to an admin table in six months' time costs
  // a wasted render, not a hundred auth calls.
  //
  // Safe because a prefetch never needs the redirect. Nothing is shown to
  // anyone from this response — the real gate is `getCurrentStaff()` in the
  // admin layout, which runs when the page is actually visited, and
  // `requirePermission` in every API route regardless.
  if (request.headers.get("Next-Router-Prefetch") === "1") {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh session (required for @supabase/ssr)
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  // Coarse gate only: is there a session at all.
  //
  // Whether this person is active staff, and what they're allowed to see, is
  // decided in the admin layout — that needs a database read, and the edge
  // runtime is the wrong place to put one in front of every request. The real
  // enforcement is `requirePermission` in each API route regardless.
  if (pathname.startsWith("/admin") && !pathname.startsWith("/admin/login")) {
    if (!user) {
      return NextResponse.redirect(new URL("/admin/login", request.url));
    }
  }

  return supabaseResponse;
}

/**
 * Record where this visitor came from.
 *
 * Done in middleware rather than a client component so it works before
 * hydration, needs no JavaScript, and cannot be forgotten by a page that
 * didn't include the tracker.
 *
 * Two cookies with different rules:
 *   attr_first  written once, never touched again — who introduced them
 *   attr_last   overwritten whenever a new signal arrives — what closed it
 */
function captureAttribution(request: NextRequest) {
  const response = NextResponse.next({ request });

  const url = request.nextUrl;
  const attribution = parseAttribution(
    url,
    request.headers.get("referer"),
    url.host
  );

  const hasFirst = !!request.cookies.get(ATTR_FIRST_COOKIE);
  const inSession = !!request.cookies.get(ATTR_SESSION_COOKIE);

  // Nothing new to record: no signal, and we're mid-visit. Writing here would
  // overwrite a real source with "direct" on every click around the site.
  if (!attribution && inSession && hasFirst) return response;

  const base = {
    path: "/",
    sameSite: "lax" as const, // must survive the cross-site click that brought them here
    httpOnly: false, // no secrets in it, and useful to read client-side later
    secure: process.env.NODE_ENV === "production",
  };

  const set = (name: string, value: string) =>
    response.cookies.set(name, value, { ...base, maxAge: ATTR_MAX_AGE });

  // First touch is recorded even with no signal, so "direct" is a real,
  // countable answer rather than an absence. Never overwritten afterwards —
  // whoever introduced this customer keeps the credit, which is what referral
  // commission is paid on.
  if (!hasFirst) {
    set(
      ATTR_FIRST_COOKIE,
      encodeAttribution(attribution ?? directAttribution(url.pathname))
    );
  }

  if (attribution) {
    set(ATTR_LAST_COOKIE, encodeAttribution(attribution));
  } else if (!inSession) {
    // A fresh visit that arrived with no campaign tag and no referrer — they
    // typed the address, used a bookmark, or came from an app that hides it.
    // That is genuinely "direct", and saying so matters: without this, someone
    // who clicked an Instagram ad once would keep being reported as Instagram
    // for the next 90 days, including on a purchase they made by typing the
    // checkout URL. Only last-touch is reset; first touch above is not.
    set(ATTR_LAST_COOKIE, encodeAttribution(directAttribution(url.pathname)));
  }

  // No maxAge — a session cookie, gone when the browser closes. It's what
  // separates "still the same visit" from "came back later".
  response.cookies.set(ATTR_SESSION_COOKIE, "1", base);

  return response;
}

export const config = {
  // Everything except API routes, Next internals and static files. API routes
  // are excluded on purpose: they read the cookies the middleware already set,
  // and running this in front of them would only add latency.
  //
  // `/refer` is excluded too, and that one is subtle: it redirects to
  // /neuro-code?ref=CODE, and if this ran first it would stamp attr_first as
  // "direct" — from a URL with no signal — a moment before the redirect that
  // carries the referral. The referrer who introduced the customer would lose
  // the credit. Letting the redirect target be the first page middleware sees
  // keeps first-touch honest.
  matcher: [
    "/((?!api|refer|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|llms.txt|manifest.json|images/|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|txt|xml)$).*)",
  ],
};

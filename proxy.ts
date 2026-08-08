import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  parseAttribution,
  directAttribution,
  encodeAttribution,
  ATTR_FIRST_COOKIE,
  ATTR_LAST_COOKIE,
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

  // No signal and we've seen them before: ordinary navigation around the site.
  // Touching cookies here would overwrite a real source with "direct".
  if (!attribution && hasFirst) return response;

  const set = (name: string, value: string) =>
    response.cookies.set(name, value, {
      maxAge: ATTR_MAX_AGE,
      path: "/",
      sameSite: "lax", // must survive the cross-site click that brought them here
      httpOnly: false, // no secrets in it, and useful to read client-side later
      secure: process.env.NODE_ENV === "production",
    });

  // First touch is recorded even with no signal, so "direct" is a real,
  // countable answer rather than an absence.
  if (!hasFirst) {
    set(
      ATTR_FIRST_COOKIE,
      encodeAttribution(attribution ?? directAttribution(url.pathname))
    );
  }

  if (attribution) set(ATTR_LAST_COOKIE, encodeAttribution(attribution));

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

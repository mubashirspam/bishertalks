import { decodeAttribution, ATTR_FIRST_COOKIE } from "@/lib/attribution";

/**
 * Meta Pixel events.
 *
 * The pixel itself is initialised inline in app/layout.tsx; this is how the
 * rest of the app reports what a visitor did. Every call is a no-op when the
 * pixel isn't loaded — blocked by an ad blocker, disabled in development, or
 * simply not finished loading — so nothing here can break a page.
 *
 * PageView is handled centrally (layout + route tracker). These are the events
 * that tell Meta which ads actually produce sales, which is what its
 * optimisation runs on. Without at least Purchase, ad delivery is guesswork.
 *
 * ── Two ad accounts, two pixels ─────────────────────────────────────────────
 *
 * Two Meta ad accounts have run against this funnel, each with its own pixel.
 * Both used to be initialised together and reported to with a blanket
 * `fbq('track', ...)`, which fires an event into every initialised pixel at
 * once. The result: each pixel only ever saw half the true traffic (neither
 * left the learning phase cleanly), both pixels claimed the same purchases
 * (event_id dedup only works inside one pixel, never across two), and the
 * campaigns had no way to be told apart.
 *
 * The fix is `/neuro-code-b` (rewritten to the same page — see
 * next.config.js) as Account B's own landing URL, and every event below going
 * out via `fbq('trackSingle', <one pixel>, ...)` instead of the blanket
 * `track`. Both pixels stay initialised everywhere (so `trackSingle` always
 * has a valid target); the fix is entirely about which *one* pixel each event
 * is reported to.
 */

/** The single product this store sells. */
export const PIXEL_CONTENT_ID = "neuro-code-book";

/** One ad account's pixel. "a" is the original/default account — it also
 * owns anything with no ad tag at all: organic, direct, WhatsApp shares. */
export type PixelAccount = "a" | "b";

/** The one path that belongs to Account B. Everything else — including
 * shared funnel steps like /neuro-code/checkout — belongs to whichever
 * account a visitor actually landed through, not to whatever they're
 * currently looking at. See pixelAccountForPath(). Exported so the root
 * layout's inline script (app/layout.tsx) can embed the same string in its
 * own vanilla-JS path check, done there rather than here because it runs
 * before hydration and cannot import this module. */
export const ACCOUNT_B_PATH = "/neuro-code-b";

/**
 * Meta pixel IDs, one per account.
 *
 * Prefers the named per-account vars. Falls back to splitting the old
 * comma-separated NEXT_PUBLIC_FACEBOOK_PIXEL_ID positionally — first id to A,
 * second to B — so this works against existing Vercel config with no env
 * changes required; NEXT_PUBLIC_META_PIXEL_ID_A/_B are there for when you
 * want to set them explicitly instead. Hardcoded default on A in production
 * only, same as before this split existed.
 */
function resolvePixelIds(): Record<PixelAccount, string> {
  const legacy = (process.env.NEXT_PUBLIC_FACEBOOK_PIXEL_ID || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  const a =
    process.env.NEXT_PUBLIC_META_PIXEL_ID_A ||
    legacy[0] ||
    (process.env.NODE_ENV === "production" ? "1059545799769579" : "");

  // Unconfigured until a second pixel exists — falls back to A's id in
  // pixelIdFor() below, so /neuro-code-b behaves like /neuro-code until one
  // is actually set, rather than silently tracking nothing.
  const b = process.env.NEXT_PUBLIC_META_PIXEL_ID_B || legacy[1] || "";

  return { a, b };
}

const PIXEL_IDS = resolvePixelIds();

/** Every pixel ID actually configured, deduped — what the base snippet in
 * app/layout.tsx calls fbq('init', ...) for. Deduped so setting only the A
 * id (B unset, or equal to A) never double-initialises one pixel. */
export const ALL_PIXEL_IDS = [...new Set(Object.values(PIXEL_IDS).filter(Boolean))];

/** This account's numeric pixel ID — A's, if this account isn't configured
 * yet, so an unset B behaves like a single-pixel site rather than a broken
 * one. */
export function pixelIdFor(account: PixelAccount): string {
  return PIXEL_IDS[account] || PIXEL_IDS.a;
}

/**
 * Which account a PATH belongs to.
 *
 * True only for /neuro-code-b itself — the one URL that is exclusively
 * Account B's. It is deliberately NOT true for /neuro-code/checkout or the
 * thank-you page: those are shared by both accounts' visitors, and which one
 * a given visitor belongs to depends on where they actually landed, not on
 * which shared step they're currently looking at. Use
 * resolveVisitorPixelAccount() (client) or the order's own landing_path
 * (server, at Purchase) for those.
 */
export function pixelAccountForPath(path: string | null | undefined): PixelAccount {
  return path?.startsWith(ACCOUNT_B_PATH) ? "b" : "a";
}

/**
 * Which account THIS VISITOR belongs to, wherever they currently are.
 *
 * Landing on /neuro-code-b itself is self-evident from the URL. Anywhere
 * else in the funnel — checkout, thank-you, a page reached by client-side
 * navigation with no fresh document load — the URL no longer says which
 * account sent them, so this reads where they *first* landed instead, off
 * the same first-touch cookie lib/attribution.ts already keeps for 90 days.
 *
 * Client-only (reads document.cookie); falls back to "a" — the agreed home
 * for untagged traffic — both during SSR and if the cookie is missing or
 * unparseable.
 */
export function resolveVisitorPixelAccount(): PixelAccount {
  if (typeof document === "undefined") return "a";

  if (pixelAccountForPath(window.location.pathname) === "b") return "b";

  const raw = document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${ATTR_FIRST_COOKIE}=`))
    ?.slice(ATTR_FIRST_COOKIE.length + 1);

  const attribution = decodeAttribution(raw);
  return pixelAccountForPath(attribution?.landing_path);
}

interface PixelParams {
  value?: number;
  currency?: string;
  content_ids?: string[];
  content_name?: string;
  content_type?: string;
  num_items?: number;
}

/**
 * Report to exactly one pixel — `trackSingle`, never the blanket `track`.
 * `track` fires an event into every pixel `fbq('init', ...)` has ever seen on
 * this page, which is precisely the double-counting this file exists to stop.
 *
 * `account` is normally left to resolve itself from where this visitor
 * actually landed (see resolveVisitorPixelAccount); pass it explicitly only
 * where the caller has a more durable answer than the browser does — the
 * thank-you page reads it off the order row, which survives a cleared cookie
 * or a purchase finished days after the click.
 */
function track(
  event: string,
  params?: PixelParams,
  eventId?: string,
  account?: PixelAccount
) {
  if (typeof window === "undefined" || !window.fbq) return;
  try {
    const id = pixelIdFor(account ?? resolveVisitorPixelAccount());
    // The fourth argument carries an event ID. Meta uses it to collapse
    // duplicates, which matters on pages a customer can reload.
    if (eventId) window.fbq("trackSingle", id, event, params ?? {}, { eventID: eventId });
    else window.fbq("trackSingle", id, event, params ?? {});
  } catch {
    // An analytics failure is never worth surfacing to a customer.
  }
}

/** Someone looked at the book. Fired on the landing page. */
export function trackViewContent(priceRupees: number) {
  track("ViewContent", {
    content_ids: [PIXEL_CONTENT_ID],
    content_name: "Neuro Code",
    content_type: "product",
    value: priceRupees,
    currency: "INR",
  });
}

/** Someone clicked through to buy. The strongest pre-purchase signal. */
export function trackInitiateCheckout(priceRupees: number) {
  track("InitiateCheckout", {
    content_ids: [PIXEL_CONTENT_ID],
    content_name: "Neuro Code",
    content_type: "product",
    num_items: 1,
    value: priceRupees,
    currency: "INR",
  });
}

/** They typed a usable mobile number — the point they become contactable. */
export function trackLead() {
  track("Lead", { content_name: "Neuro Code checkout" });
}

/**
 * Money changed hands.
 *
 * `orderNumber` is passed as the event ID so refreshing the thank-you page
 * doesn't report the same sale twice and inflate the ad platform's idea of how
 * well a campaign is doing.
 *
 * `account`, when given, comes from the order's own stored landing page
 * (see the thank-you page) rather than the browser's guess — the durable
 * answer to "which account actually drove this sale", the exact question a
 * shared pixel could never answer.
 */
export function trackPurchase(
  orderNumber: string,
  amountRupees: number,
  account?: PixelAccount
) {
  track(
    "Purchase",
    {
      content_ids: [PIXEL_CONTENT_ID],
      content_name: "Neuro Code",
      content_type: "product",
      num_items: 1,
      value: amountRupees,
      currency: "INR",
    },
    orderNumber,
    account
  );
}

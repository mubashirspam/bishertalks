/**
 * Where a visitor came from.
 *
 * One vocabulary, shared by the middleware that captures it, the API routes
 * that store it, and the admin that reports on it — so "instagram" can never
 * mean three slightly different things in three places.
 *
 * Runs in the edge middleware, so: no Node APIs, no DB, no imports beyond this
 * file. Everything here is pure string work.
 */

export type TrafficSource =
  | "instagram"
  | "facebook"
  | "whatsapp"
  | "youtube"
  | "google"
  | "referral"
  // A printed QR code — inside a book, on the back cover, a flyer, a poster, a
  // stall banner. It is its own channel and not "other" because it is the one
  // source we pay for in ink: knowing a book insert outsells a poster is what
  // decides the next print run.
  | "qr"
  | "direct"
  | "other";

export const TRAFFIC_SOURCES: TrafficSource[] = [
  "instagram",
  "facebook",
  "whatsapp",
  "youtube",
  "google",
  "referral",
  "qr",
  "direct",
  "other",
];

export const SOURCE_LABELS: Record<TrafficSource, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  whatsapp: "WhatsApp",
  youtube: "YouTube",
  google: "Google",
  referral: "Referral",
  qr: "QR code (print)",
  direct: "Direct / unknown",
  other: "Other",
};

export const SOURCE_BADGE: Record<TrafficSource, string> = {
  instagram: "bg-pink-50 text-pink-700 border-pink-200",
  facebook: "bg-blue-50 text-blue-700 border-blue-200",
  whatsapp: "bg-green-50 text-green-700 border-green-200",
  youtube: "bg-red-50 text-red-700 border-red-200",
  google: "bg-amber-50 text-amber-700 border-amber-200",
  referral: "bg-purple-50 text-purple-700 border-purple-200",
  qr: "bg-indigo-50 text-indigo-700 border-indigo-200",
  direct: "bg-neutral-100 text-neutral-600 border-neutral-200",
  other: "bg-neutral-100 text-neutral-600 border-neutral-200",
};

export function isTrafficSource(v: string | null | undefined): v is TrafficSource {
  return !!v && (TRAFFIC_SOURCES as string[]).includes(v);
}

// ── Normalisation ───────────────────────────────────────────────────────────

/**
 * What people actually type in a utm_source. Marketing links are written by
 * hand on a phone at 11pm; "IG", "insta" and "Instagram " are all the same
 * channel and the report is worthless if they're counted separately.
 */
const UTM_ALIASES: Record<string, TrafficSource> = {
  ig: "instagram", insta: "instagram", instagram: "instagram", igstory: "instagram",
  fb: "facebook", facebook: "facebook", meta: "facebook",
  wa: "whatsapp", whatsapp: "whatsapp", wapp: "whatsapp", status: "whatsapp",
  yt: "youtube", youtube: "youtube", shorts: "youtube",
  google: "google", googleads: "google", gads: "google", adwords: "google", search: "google",
  ref: "referral", referral: "referral", affiliate: "referral",
  // Anything printed and scanned. The builder always writes "qr", but a QR made
  // by hand from a phone is as likely to say "book" or "flyer", and all of it
  // is the same channel: paper.
  qr: "qr", qrcode: "qr", scan: "qr", print: "qr", book: "qr", bookqr: "qr",
  flyer: "qr", poster: "qr", sticker: "qr", banner: "qr", card: "qr",
};

/** Referrer hostnames, matched as suffixes so subdomains fall through. */
const HOST_MAP: [string, TrafficSource][] = [
  ["instagram.com", "instagram"],
  ["ig.me", "instagram"],
  ["facebook.com", "facebook"],
  ["fb.me", "facebook"],
  ["fb.com", "facebook"],
  ["whatsapp.com", "whatsapp"],
  ["wa.me", "whatsapp"],
  ["youtube.com", "youtube"],
  ["youtu.be", "youtube"],
  ["google.com", "google"],
  ["google.co.in", "google"],
  ["googleadservices.com", "google"],
];

function hostToSource(host: string): TrafficSource {
  const h = host.toLowerCase().replace(/^www\./, "");
  for (const [suffix, source] of HOST_MAP) {
    if (h === suffix || h.endsWith(`.${suffix}`)) return source;
  }
  // A real external site linking to us — a blog, a directory, a search engine
  // we don't track by name. Distinct from "direct", which means no signal.
  return "other";
}

/**
 * Decide the channel.
 *
 * Precedence is deliberate: an explicit referral code beats a campaign tag
 * beats a sniffed referrer. The more intentional the signal, the more it's
 * trusted — a tagged link is something you chose, a referrer is a guess.
 */
export function normalizeSource(input: {
  utmSource?: string | null;
  referrerHost?: string | null;
  hasRefCode?: boolean;
}): TrafficSource {
  if (input.hasRefCode) return "referral";

  const utm = input.utmSource?.trim().toLowerCase().replace(/[\s_-]/g, "");
  if (utm) return UTM_ALIASES[utm] ?? "other";

  if (input.referrerHost) return hostToSource(input.referrerHost);

  // No tag, no referrer. Someone typed it, used a bookmark, or came from an
  // app that strips the referrer. Not knowable — say so rather than guessing.
  return "direct";
}

// ── The record we carry in a cookie ─────────────────────────────────────────

export interface Attribution {
  source: TrafficSource;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  referrer_url: string | null;
  landing_path: string | null;
  /** Referral code from ?ref= — used by the referral program. */
  ref_code: string | null;
}

export const ATTR_FIRST_COOKIE = "attr_first";
export const ATTR_LAST_COOKIE = "attr_last";
/**
 * Session marker. No expiry, so it dies with the browser — that's the whole
 * point: it tells the middleware whether an untagged page view is "still the
 * same visit" (leave last-touch alone) or "came back later with no campaign"
 * (last touch is genuinely direct).
 */
export const ATTR_SESSION_COOKIE = "attr_session";
/** 90 days: long enough to cover "saw the reel, bought next payday". */
export const ATTR_MAX_AGE = 60 * 60 * 24 * 90;

/** Cap stored strings — a campaign name is not a place for a URL dump. */
const trim = (v: string | null, max = 120): string | null =>
  v ? v.slice(0, max) : null;

/**
 * Read attribution off an incoming request.
 *
 * Returns null when the visit carries no signal at all AND is same-origin
 * navigation, so ordinary clicking around the site doesn't rewrite the
 * last-touch cookie on every page.
 */
export function parseAttribution(
  url: URL,
  referer: string | null,
  selfHost: string
): Attribution | null {
  const p = url.searchParams;

  const utm_source = trim(p.get("utm_source"));
  const utm_medium = trim(p.get("utm_medium"));
  const utm_campaign = trim(p.get("utm_campaign"));
  const utm_content = trim(p.get("utm_content"));
  const ref_code = trim(p.get("ref"), 32);

  let referrerHost: string | null = null;
  let referrer_url: string | null = null;

  if (referer) {
    try {
      const r = new URL(referer);
      // Internal navigation is not a traffic source.
      if (r.host !== selfHost) {
        referrerHost = r.host;
        referrer_url = trim(referer, 300);
      }
    } catch {
      // Malformed Referer header — ignore it rather than throwing in middleware.
    }
  }

  const hasSignal = !!(utm_source || ref_code || referrerHost);
  if (!hasSignal) return null;

  return {
    source: normalizeSource({ utmSource: utm_source, referrerHost, hasRefCode: !!ref_code }),
    utm_source,
    utm_medium,
    utm_campaign,
    utm_content,
    referrer_url,
    landing_path: trim(url.pathname, 200),
    ref_code,
  };
}

/** A visitor with no signal at all — recorded so first-touch is still honest. */
export function directAttribution(path: string): Attribution {
  return {
    source: "direct",
    utm_source: null,
    utm_medium: null,
    utm_campaign: null,
    utm_content: null,
    referrer_url: null,
    landing_path: trim(path, 200),
    ref_code: null,
  };
}

// ── Cookie encoding ─────────────────────────────────────────────────────────

export function encodeAttribution(a: Attribution): string {
  return encodeURIComponent(JSON.stringify(a));
}

export function decodeAttribution(raw: string | undefined | null): Attribution | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(raw));
    if (!parsed || typeof parsed !== "object") return null;
    // Cookies are client-writable, so never trust the channel value.
    return isTrafficSource(parsed.source) ? (parsed as Attribution) : null;
  } catch {
    return null;
  }
}

/** The columns an order row stores. Keeps the two writers from drifting. */
export function attributionColumns(
  last: Attribution | null,
  first: Attribution | null
): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (col: string, v: string | null | undefined) => {
    if (v) out[col] = v;
  };

  put("source", last?.source);
  put("first_source", first?.source ?? last?.source);
  put("utm_source", last?.utm_source);
  put("utm_medium", last?.utm_medium);
  put("utm_campaign", last?.utm_campaign);
  put("utm_content", last?.utm_content);
  put("referrer_url", last?.referrer_url);
  put("landing_path", (first ?? last)?.landing_path);

  return out;
}

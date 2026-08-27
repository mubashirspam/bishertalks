import { indiaPostBaseUrl, type IndiaPostSettings } from "./config";
import { accessToken, forgetToken } from "./session";

/**
 * The HTTP layer for India Post.
 *
 * The one idea worth understanding is the same one Delhivery's client is built
 * on, and it matters more here: the difference between an answer of "no" and
 * no answer at all.
 *
 *   "rejected"  They answered, and the answer was no. Nothing was created.
 *               Safe to release a claim and let someone retry.
 *
 *   "unknown"   We never found out — a timeout, a dropped connection, a 502.
 *               The booking may or may not exist on their side. NOT safe to
 *               retry.
 *
 * It matters more here because of the article number. A blind retry after a
 * timeout does not merely risk a second parcel: it either reuses an article
 * number India Post may already hold, or spends a second one from a finite
 * stock. Both are worse than waiting to find out.
 *
 * The one India Post specific wrinkle is `blocked`. Their gateway refuses
 * calls from an address that is not on the customer's whitelist, and that
 * refusal looks like an ordinary authorisation failure while meaning something
 * completely different — nothing is wrong with the credentials, the call came
 * from the wrong place. Told apart here so the message can say so.
 */

export type IndiaPostFailure = "rejected" | "unauthorised" | "blocked" | "unknown";

export class IndiaPostError extends Error {
  constructor(
    message: string,
    readonly kind: IndiaPostFailure,
    readonly status?: number,
    readonly body?: string
  ) {
    super(message);
    this.name = "IndiaPostError";
  }
}

/** Long enough for a booking upload; short enough not to hang a request. */
const TIMEOUT_MS = 45_000;

interface RequestOptions {
  settings: IndiaPostSettings;
  path: string;
  method?: "GET" | "POST";
  query?: Record<string, string | number | undefined>;
  json?: unknown;
  /** A multipart upload — the booking endpoint's only accepted shape. */
  form?: FormData;
  /** True for a PDF or anything else that is not JSON. */
  binary?: boolean;
  /**
   * Whether a network-level failure may be retried once.
   *
   * False for anything that creates something on their side. A tariff quote or
   * a tracking read can be repeated freely; a booking cannot.
   */
  retryOnNetworkError?: boolean;
  /** Internal: set when this call is already a retry after a token refresh. */
  isRetryAfterAuth?: boolean;
}

/**
 * Does this network failure look like the whitelist turning us away?
 *
 * Their two environments refuse a non-whitelisted caller in different ways,
 * and only one of them is an HTTP response:
 *
 *   production  (api.cept.gov.in)   completes TLS and answers 403
 *   sandbox     (test.cept.gov.in)  accepts the TCP connection, then resets
 *                                   the TLS handshake without sending a byte
 *
 * The sandbox case never reaches the status-code branch below — `fetch` simply
 * throws, and the bare message is "fetch failed", which tells an operator
 * nothing at all. So the cause chain is walked for the socket-level codes that
 * shape produces, purely to put the right sentence in front of a person.
 */
function looksLikeWhitelistBlock(e: unknown): boolean {
  const codes = new Set(["ECONNRESET", "EPIPE", "ECONNREFUSED", "EHOSTUNREACH"]);
  for (let cur: unknown = e, depth = 0; cur && depth < 5; depth++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string" && codes.has(code)) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * One authenticated call.
 *
 * The token is fetched and cached by ./session; a 401 here means the cached one
 * expired early, so it is dropped and the call is made once more with a fresh
 * one. Once — a second failure is a real authorisation problem, and looping on
 * it would lock the account out.
 */
export async function indiaPostRequest<T>(options: RequestOptions): Promise<T> {
  const { settings, path, method = "GET", query, json, form, binary } = options;

  const url = new URL((settings.baseUrl || indiaPostBaseUrl()) + path);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }

  const token = await accessToken(settings);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: binary ? "application/pdf" : "application/json",
  };
  // Never set Content-Type for FormData: fetch has to add the multipart
  // boundary itself, and a hand-written header omits it and makes the whole
  // upload unparseable at their end.
  if (json !== undefined) headers["Content-Type"] = "application/json";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: form ?? (json !== undefined ? JSON.stringify(json) : undefined),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    const message = e instanceof Error ? e.message : String(e);

    if (options.retryOnNetworkError) {
      return indiaPostRequest<T>({ ...options, retryOnNetworkError: false });
    }
    // We never found out. This is the case the caller must not treat as a
    // refusal — see the note at the top.
    //
    // Deliberately still "unknown", even when this is obviously the whitelist.
    // A reset during the TLS handshake and a reset after the request went out
    // are the same ECONNRESET at this layer; Node cannot tell us which side of
    // the request it happened on. Calling a whitelist block "blocked" would be
    // right most of the time and wrong in the one case that costs a parcel:
    // "blocked" reads as *nothing was created, release the claim*, and a
    // booking cut off mid-flight may well have landed. So the hint goes in the
    // message, where it helps a person, and never in the kind, which is what a
    // retry decision reads.
    throw new IndiaPostError(
      looksLikeWhitelistBlock(e)
        ? `India Post did not answer (${message}). The connection was reset before they sent ` +
          `a single byte — that is how their sandbox refuses an address that is not on the ` +
          `UAT whitelist, and it is not a credentials problem. Check this machine's public IP ` +
          `under "Whitelist my IP Address" in the Customer Selfservice Portal.`
        : `India Post did not answer (${message})`,
      "unknown"
    );
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401 || response.status === 403) {
    const body = await response.text().catch(() => "");

    // A whitelist refusal, not a credentials problem. Their gateway phrases it
    // several ways; any mention of the address is enough to tell them apart,
    // and saying "your IP is not whitelisted" to someone whose password is
    // fine saves an afternoon.
    if (/\bip\b|whitelist|not allowed|forbidden/i.test(body) || response.status === 403) {
      throw new IndiaPostError(
        "India Post refused the call from this address — is it on the UAT/production whitelist in the Customer Selfservice Portal?",
        "blocked",
        response.status,
        body.slice(0, 500)
      );
    }

    // A genuinely expired token: drop it and try once with a new one.
    if (!options.isRetryAfterAuth) {
      forgetToken(settings);
      return indiaPostRequest<T>({ ...options, isRetryAfterAuth: true });
    }

    throw new IndiaPostError(
      "India Post rejected our credentials",
      "unauthorised",
      response.status,
      body.slice(0, 500)
    );
  }

  // Their gateway's own failures. A 5xx is not an answer about our request —
  // it is the absence of one, and a booking behind it may still have landed.
  if (response.status >= 500) {
    const body = await response.text().catch(() => "");
    throw new IndiaPostError(
      `India Post returned ${response.status}`,
      "unknown",
      response.status,
      body.slice(0, 500)
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new IndiaPostError(
      `India Post refused the request (${response.status})`,
      "rejected",
      response.status,
      body.slice(0, 500)
    );
  }

  if (binary) return (await response.arrayBuffer()) as unknown as T;

  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new IndiaPostError(
      "India Post returned something that is not JSON",
      "rejected",
      response.status,
      text.slice(0, 500)
    );
  }
}

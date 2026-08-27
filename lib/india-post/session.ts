import { ENDPOINTS, type IndiaPostSettings } from "./config";

/**
 * The access token, and keeping one alive.
 *
 * Delhivery's token is a static string in the environment. India Post issues a
 * session: a short-lived access token, a longer-lived refresh token, and an
 * expiry in seconds. So something has to hold one and renew it, and that is
 * this module and nowhere else — a second place minting tokens would double
 * the login rate against an account with no published rate limit.
 *
 * Deliberately a module-level cache rather than a table. A token is worth
 * nothing to keep: the process may be recycled between requests, and a login
 * is one cheap call. What matters is that a *single* process handling fifty
 * parcels logs in once rather than fifty times.
 *
 * The refresh token is stored but not yet used. AUTH01 hands one back, and
 * renewing with it through AUTH02 would save a round trip — but their refresh
 * endpoint has not been exercised yet, and a token path that has never run is
 * not a path to put in front of a booking. Logging in again is correct, just
 * less clever.
 *
 * Their tokens are short: `expires_in` 900 seconds, `refresh_expires_in` 1800.
 * Fifteen minutes is comfortably longer than any batch we send, so the renewal
 * margin below is the only thing that needs to respect it.
 */

interface CachedToken {
  accessToken: string;
  refreshToken: string | null;
  /** Epoch milliseconds. Already includes the safety margin below. */
  expiresAt: number;
}

/**
 * Renew this long before the token actually expires.
 *
 * A booking upload can take tens of seconds, and a token that dies halfway
 * through is a call whose outcome we cannot determine — exactly the case worth
 * spending a spare login to avoid.
 */
const EARLY_RENEWAL_MS = 60_000;

/** Keyed by account, so sandbox and production cannot share a token. */
const cache = new Map<string, CachedToken>();

/** In-flight logins, so fifty parcels in one request produce one login. */
const inFlight = new Map<string, Promise<CachedToken>>();

const keyFor = (s: IndiaPostSettings) => `${s.env}:${s.baseUrl}:${s.username}`;

interface LoginResponse {
  success?: boolean;
  message?: string;
  data?: {
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
    expires_in?: number;
    refresh_expires_in?: number;
  };
}

/**
 * A usable access token, logging in only if the cached one is spent.
 *
 * Throws rather than returning null: every caller needs a token, and there is
 * nothing sensible any of them could do with its absence except fail.
 */
export async function accessToken(settings: IndiaPostSettings): Promise<string> {
  const key = keyFor(settings);

  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.accessToken;

  const pending = inFlight.get(key);
  if (pending) return (await pending).accessToken;

  const promise = login(settings)
    .then((token) => {
      cache.set(key, token);
      return token;
    })
    .finally(() => inFlight.delete(key));

  inFlight.set(key, promise);
  return (await promise).accessToken;
}

/**
 * Drop the cached token for this account.
 *
 * Called when a request comes back 401 despite a token we believed was good —
 * their clock and ours disagreeing, or a token revoked at their end.
 */
export function forgetToken(settings: IndiaPostSettings): void {
  cache.delete(keyFor(settings));
}

/**
 * AUTH01 — username and password in, a full set of tokens out.
 *
 * **This used to call AUTH02, and that was wrong.** The reasoning was that
 * both endpoints took the same credentials and AUTH02 returned strictly more,
 * so it was the better default. Their API reference says otherwise, plainly:
 * AUTH02 (`TokenWithRtoken`) takes **no body at all** and requires
 * `Authorization: Bearer <refresh_token>` — it exchanges a refresh token for a
 * new access token and has no idea what a password is. Posting credentials to
 * it would have come back 401 on the very first call, and the whitelist outage
 * meant nothing ever got far enough to find out.
 *
 * AUTH01 returns the refresh token too, so nothing is lost by using it: its
 * documented 200 carries `access_token`, `refresh_token` and `id_token`
 * together.
 *
 * This is the one call that must not go through ./client — that module asks
 * this one for a token, and the two calling each other would not terminate.
 */
async function login(settings: IndiaPostSettings): Promise<CachedToken> {
  const url = settings.baseUrl + ENDPOINTS.login;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        username: settings.username,
        password: settings.password,
      }),
      signal: controller.signal,
    });
  } catch (e) {
    throw new Error(
      `Could not reach India Post to log in: ${e instanceof Error ? e.message : String(e)}`
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();

  if (response.status === 403) {
    throw new Error(
      "India Post refused the login from this address — add this machine's IP to the UAT whitelist in the Customer Selfservice Portal."
    );
  }
  if (!response.ok) {
    throw new Error(`India Post login failed (${response.status}): ${text.slice(0, 300)}`);
  }

  let body: LoginResponse;
  try {
    body = JSON.parse(text) as LoginResponse;
  } catch {
    throw new Error(`India Post login returned something that is not JSON: ${text.slice(0, 300)}`);
  }

  const token = body.data?.access_token;
  if (!token) {
    throw new Error(
      `India Post login returned no access token${body.message ? `: ${body.message}` : ""}`
    );
  }

  // Their `expires_in` is seconds. A missing or nonsensical value falls back to
  // five minutes — short enough that a wrong guess costs an extra login rather
  // than a run of 401s halfway through a batch.
  const seconds = Number(body.data?.expires_in);
  const lifetime = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 300_000;

  return {
    accessToken: token,
    refreshToken: body.data?.refresh_token ?? null,
    expiresAt: Date.now() + Math.max(0, lifetime - EARLY_RENEWAL_MS),
  };
}

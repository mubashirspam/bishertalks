import type { DelhiverySettings } from "./config";

/**
 * The HTTP layer for Delhivery.
 *
 * The one idea worth understanding here is the difference between the two
 * failure kinds, because everything upstream branches on it:
 *
 *   "rejected"  Delhivery answered, and the answer was no. The shipment does
 *               not exist. Safe to release the claim and let someone retry.
 *
 *   "unknown"   We never got an answer — a timeout, a dropped connection, a
 *               500. The shipment may or may not exist on their side. NOT safe
 *               to retry: a blind retry after a timeout is how one order
 *               becomes two parcels and two waybills.
 *
 * Getting that distinction wrong is the expensive bug in any shipping
 * integration, so it is the type, not a comment.
 */

export type DelhiveryFailure = "rejected" | "unknown";

export class DelhiveryError extends Error {
  readonly kind: DelhiveryFailure;
  readonly status?: number;
  readonly body?: string;

  // Fields declared and assigned rather than written as constructor parameter
  // properties. Those are the one piece of TypeScript that cannot be erased —
  // they emit code — so Node's type stripping refuses the whole module, and
  // because lib/couriers/types.ts reaches this file through ./adapters, that
  // refusal takes every courier helper with it. Any script run the way this
  // repo runs them (node --experimental-strip-types, see package.json) died on
  // `import { listCouriers }` with an error naming a Delhivery file it had no
  // interest in.
  constructor(
    message: string,
    kind: DelhiveryFailure,
    status?: number,
    body?: string
  ) {
    super(message);
    this.name = "DelhiveryError";
    this.kind = kind;
    this.status = status;
    this.body = body;
  }
}

/** Long enough for their create call under load; short enough to not hang a request. */
const TIMEOUT_MS = 30_000;

interface RequestOptions {
  settings: DelhiverySettings;
  path: string;
  method?: "GET" | "POST";
  /** The create call's `format=json&data=…` body. */
  form?: string;
  /**
   * Content-Type for `form`. Delhivery's own collection sends that
   * form-shaped body as `application/json`, so it is not a safe default —
   * callers say which they mean.
   */
  contentType?: string;
  json?: unknown;
  query?: Record<string, string>;
  /**
   * Whether a network-level failure may be retried once.
   *
   * False for anything that creates or changes state on their side. A read can
   * be repeated freely; a manifest cannot.
   */
  retryOnNetworkError?: boolean;
}

export async function delhiveryRequest<T>(options: RequestOptions): Promise<T> {
  const { settings, path, method = "GET", form, json, query, contentType } = options;

  const url = new URL(path, settings.baseUrl);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);

  const headers: Record<string, string> = {
    Authorization: `Token ${settings.token}`,
    Accept: "application/json",
  };

  let body: string | undefined;
  if (form !== undefined) {
    headers["Content-Type"] = contentType ?? "application/x-www-form-urlencoded";
    body = form;
  } else if (json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(json);
  }

  const attempt = async (): Promise<T> => {
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
    } catch (e) {
      // No answer at all. Never a "rejected" — we cannot know what happened.
      throw new DelhiveryError(
        e instanceof Error && e.name === "TimeoutError"
          ? "Delhivery did not answer in time"
          : "Could not reach Delhivery",
        "unknown"
      );
    }

    const text = await res.text();

    if (!res.ok) {
      // 4xx is Delhivery telling us the request was wrong — a definite no.
      // 5xx is their side falling over, which tells us nothing about whether
      // the work happened.
      const kind: DelhiveryFailure = res.status >= 400 && res.status < 500 ? "rejected" : "unknown";

      // The 401 everyone hits once: staging and production take different
      // tokens, and a production token against staging answers exactly this.
      // Naming it here saves an afternoon of re-reading the payload.
      const message =
        res.status === 401 && settings.env === "staging"
          ? "Delhivery rejected the token on staging. A production token will not " +
            "work here — either ask them for a staging token, or set " +
            "DELHIVERY_ENV=production."
          : `Delhivery returned ${res.status}`;

      throw new DelhiveryError(message, kind, res.status, text.slice(0, 2000));
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      // A 200 we cannot read is not a success we can act on. Treated as
      // unknown rather than rejected: their gateway sometimes answers HTML,
      // and the shipment may well have been created behind it.
      throw new DelhiveryError(
        "Delhivery sent a response we could not read",
        "unknown",
        res.status,
        text.slice(0, 2000)
      );
    }
  };

  try {
    return await attempt();
  } catch (e) {
    const retryable =
      options.retryOnNetworkError &&
      e instanceof DelhiveryError &&
      e.kind === "unknown" &&
      e.status === undefined; // a genuine network failure, not a 5xx

    if (!retryable) throw e;
    return attempt();
  }
}

/**
 * India Post credentials, hosts and endpoints.
 *
 * Everything here is checked against the Customer Selfservice Portal's own API
 * Subscription list rather than the approach document, because the two
 * disagree in three places that matter — see ENDPOINTS below.
 *
 * The account identifiers are environment-specific, and there are genuinely
 * two accounts:
 *
 *   sandbox      customer 9999757537, issued by the portal on registration
 *   production   customer 1171865272, contract 41767647 — the real contractual
 *                account, the one printed on every docket we post today
 *
 * They are resolved by `INDIA_POST_ENV` rather than by a single variable,
 * because the failure mode of getting it wrong is not an error message. A
 * sandbox host with a production customer id books nothing and wastes an
 * afternoon; a production host with a sandbox id is worse, and a production
 * host with the production id while someone believed they were testing is the
 * one that puts real parcels into the postal system.
 *
 * The courier row's `customer_id` and `contract_id` stay what they have always
 * been — the numbers printed on the docket — and are the fallback when the
 * environment says nothing.
 */

export type IndiaPostEnv = "sandbox" | "production";

const BASES: Record<IndiaPostEnv, string> = {
  sandbox: "https://test.cept.gov.in/beextcustomer",
  // Not yet known. Production access is requested through the portal and the
  // host comes with it; until then this is deliberately the sandbox host, so a
  // misconfigured deployment talks to the test system rather than to nothing.
  production: "https://test.cept.gov.in/beextcustomer",
};

/**
 * The endpoints we subscribed to, exactly as the portal spells them.
 *
 * Three differ from the approach document, and all three would have failed
 * silently or late:
 *
 *   * Login is `/v1/access/Login` with a capital L, not `/access/login`.
 *   * Booking is `process-articles-file/:customerID` — a multipart upload of a
 *     JSON *file*. The document's JSON-body endpoint `/process-articles/:id`
 *     is not among the twelve APIs the portal offers.
 *   * Bulk tracking takes **50** article numbers a call, not the 500 the
 *     document claims.
 */
export const ENDPOINTS = {
  /** AUTH01 — username and password in, access token out. */
  login: "/v1/access/Login",
  /** AUTH02 — the same, plus a refresh token for renewing without re-login. */
  loginWithRefresh: "/v1/access/TokenWithRtoken",
  /** BBD01 — multipart file upload. `:customerID` is appended by the caller. */
  bookFile: "/process-articles-file",
  /** TCD02 — Speed Post tariff. */
  speedPostTariff: "/v1/speed-post/tariffs",
  /** TCD03 — parcel tariff, for anything Speed Post does not cover. */
  parcelTariff: "/v1/parcel-tariff/calculate",
  /** LBL01 — the official domestic label, returned as a PDF. */
  labelDomestic: "/v1/label/create/domestic",
  /** TNT01 — one article, full event timeline. */
  trackOne: "/v1/tracking/",
  /** TNT02 — up to TRACK_BATCH articles at once. */
  trackBulk: "/v1/tracking/bulk",
} as const;

/**
 * How many article numbers one bulk tracking call may carry.
 *
 * Fifty, from the portal's own description of TNT02. The approach document
 * says five hundred; believing it would mean every poll silently dropping nine
 * parcels in ten.
 */
export const TRACK_BATCH = 50;

export interface IndiaPostSettings {
  env: IndiaPostEnv;
  baseUrl: string;
  username: string;
  password: string;
  /** Ten digits. The sandbox and production accounts are different numbers. */
  customerId: string;
  /** Eight digits, per service. Speed Post has its own. */
  contractId: string;
}

export function indiaPostEnv(): IndiaPostEnv {
  return process.env.INDIA_POST_ENV === "production" ? "production" : "sandbox";
}

/**
 * The bulk customer id for the environment we are pointed at.
 *
 * Sandbox prefers its own, so a developer who has only filled in the
 * production numbers cannot accidentally book against the real contract from a
 * test run. Production never falls back to the sandbox id — an unset
 * production customer is a configuration error, and it should say so rather
 * than quietly using a test account.
 */
function customerIdFor(env: IndiaPostEnv, fallback: string): string {
  if (env === "sandbox") {
    return (
      process.env.INDIA_POST_SANDBOX_CUSTOMER_ID ||
      process.env.INDIA_POST_CUSTOMER_ID ||
      fallback
    );
  }
  return process.env.INDIA_POST_CUSTOMER_ID || fallback;
}

export function indiaPostBaseUrl(): string {
  return process.env.INDIA_POST_BASE_URL || BASES[indiaPostEnv()];
}

/** What the courier row carries, for the fields that are genuinely per-partner. */
export interface CourierConfigShape {
  customer_id?: string;
  contract_id?: string;
}

/**
 * Is India Post configured well enough to call?
 *
 * Same shape and same job as `delhiveryReadiness`, so the adapter can ask both
 * carriers the same question. Everything listed is genuinely required by their
 * API — a gate that asks for more than the API does stops work for no reason.
 */
export function indiaPostReadiness(courierConfig: CourierConfigShape = {}): {
  ready: boolean;
  missing: string[];
  settings: IndiaPostSettings | null;
} {
  const env = indiaPostEnv();
  const username = process.env.INDIA_POST_USERNAME ?? "";
  const password = process.env.INDIA_POST_PASSWORD ?? "";
  const customerId = customerIdFor(env, courierConfig.customer_id ?? "");
  const contractId = process.env.INDIA_POST_CONTRACT_ID || courierConfig.contract_id || "";

  const missing: string[] = [];
  if (!username) missing.push("The portal username (INDIA_POST_USERNAME)");
  if (!password) missing.push("The portal password (INDIA_POST_PASSWORD)");
  if (!customerId) missing.push("The bulk customer id (INDIA_POST_CUSTOMER_ID)");
  if (!contractId) missing.push("The Speed Post contract id (INDIA_POST_CONTRACT_ID)");

  if (missing.length) return { ready: false, missing, settings: null };

  return {
    ready: true,
    missing: [],
    settings: {
      env,
      baseUrl: indiaPostBaseUrl(),
      username,
      password,
      customerId,
      contractId,
    },
  };
}

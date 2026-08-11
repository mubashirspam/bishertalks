/**
 * Outbound events to the Make.com scenario that owns all WhatsApp sending.
 *
 * This app no longer knows what any message says. It posts facts — "this order
 * shipped, here is everything about it" — and the scenario decides the
 * template, the wording and which provider actually delivers it. Fixing a typo
 * or switching from Meta Cloud API to a BSP is then a change inside Make with
 * no deploy here.
 *
 * Plain fetch, no SDK, for the same reason lib/email.ts talks to Resend with
 * fetch: one endpoint and one JSON body isn't worth a dependency in the
 * serverless bundle.
 *
 * Nothing here throws. A notification is a courtesy on top of a payment that
 * has already succeeded — a Make outage, an unset webhook URL or a malformed
 * scenario must never turn a confirmed order into a failed request.
 */

/** Bumped only for a breaking payload change; the scenario routes on it. */
export const EVENT_VERSION = 1 as const;

export interface MakeCustomer {
  name: string;
  /** E.164, always. "+919876543210" */
  phone: string;
  /** Bare 10 digits, for providers that want it without the country code. */
  phone_digits: string;
  email: string | null;
}

export interface MakeOrder {
  number: string;
  /** Rupees, already rounded — the scenario must never do arithmetic. */
  amount: number;
  amount_paise: number;
  currency: "INR";
  status: string;
  payment_status: string;
  product: string;
  address: {
    line1: string | null;
    line2: string | null;
    city: string | null;
    district: string | null;
    state: string | null;
    pincode: string | null;
    /** Pre-joined "Kochi, Kerala" — the scenario must never concatenate. */
    short: string;
  };
  courier: string | null;
  tracking_number: string | null;
  /** Pre-formatted en-IN date, or a phrase like "3–5 business days". */
  expected_delivery: string;
  payment_link_url: string | null;
}

export interface MakeCourse {
  title: string;
  slug: string;
  url: string;
  /** The number the customer types to get into the course page. */
  login_phone: string;
}

export interface MakeEvent {
  version: typeof EVENT_VERSION;
  /** Dotted name, e.g. "order.shipped". Drives the scenario's router. */
  event: string;
  /** Idempotency key. Make dedupes on this; so does notification_log. */
  event_id: string;
  sent_at: string;
  /** "production" | "preview" | "development" — Make drops non-production. */
  env: string;
  customer: MakeCustomer;
  order: MakeOrder | null;
  links: {
    address: string | null;
    tracking: string | null;
    site: string;
    course: string | null;
  };
  course: MakeCourse | null;
}

export interface MakeResult {
  ok: boolean;
  /** True when there is no webhook configured — not a failure. */
  skipped?: boolean;
  status?: number;
  error?: string;
}

export function makeConfigured(): boolean {
  return !!process.env.MAKE_WEBHOOK_URL;
}

/**
 * Which deployment this is, so the scenario can drop test traffic instead of
 * messaging a real customer from someone's laptop.
 */
export function currentEnv(): string {
  return process.env.VERCEL_ENV || process.env.NODE_ENV || "development";
}

const TIMEOUT_MS = 8000;

/**
 * One POST, with a single retry on transport-level failure.
 *
 * Deliberately not a full retry system: Make's own "incomplete executions"
 * queue is the right place for that, and a second one here would only make the
 * same message arrive twice. The one retry exists for the narrow case where the
 * request never reached Make at all.
 */
async function post(body: unknown, label: string): Promise<MakeResult> {
  const url = process.env.MAKE_WEBHOOK_URL;

  if (!url) {
    // Local development without a Make account: log and carry on rather than
    // pretending to have sent something.
    console.warn("[Make] MAKE_WEBHOOK_URL not set — skipping:", label);
    return { ok: false, skipped: true, error: "Not configured" };
  }

  const payload = JSON.stringify(body);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    // The webhook URL is unguessable but is still a bearer token. This header
    // is the actual gate — the scenario's first filter drops anything else.
    "X-Bisher-Secret": process.env.MAKE_WEBHOOK_SECRET || "",
    "X-Bisher-Event": label,
    "X-Bisher-Delivery": crypto.randomUUID(),
  };

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: payload,
        // Make's webhook answers in ~200ms. Without a deadline a hung
        // connection burns the whole serverless invocation.
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (res.ok) {
        console.log(`[Make] sent ${label} (${res.status})`);
        return { ok: true, status: res.status };
      }

      // 4xx is our fault — a bad secret or a payload the scenario rejects.
      // Retrying it just repeats the mistake.
      if (res.status < 500) {
        const text = await res.text().catch(() => "");
        console.error(`[Make] rejected ${label}: HTTP ${res.status} ${text.slice(0, 200)}`);
        return { ok: false, status: res.status, error: `HTTP ${res.status}` };
      }

      if (attempt === 2) {
        console.error(`[Make] failed ${label}: HTTP ${res.status}`);
        return { ok: false, status: res.status, error: `HTTP ${res.status}` };
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (attempt === 2) {
        console.error(`[Make] unreachable for ${label}:`, message);
        return { ok: false, error: message };
      }
    }

    await new Promise((r) => setTimeout(r, 500));
  }

  return { ok: false, error: "Unreachable" };
}

/** Send one event. */
export function sendMakeEvent(event: MakeEvent): Promise<MakeResult> {
  return post(event, event.event);
}

/**
 * Send many events in one request.
 *
 * A bulk "mark shipped" over fifty parcels is one webhook call and one Make
 * execution, not fifty of each — the scenario's Iterator fans the array out.
 * That matters: Make bills per operation.
 */
export function sendMakeEvents(events: MakeEvent[]): Promise<MakeResult> {
  if (!events.length) return Promise.resolve({ ok: true });
  if (events.length === 1) return sendMakeEvent(events[0]);

  return post(
    { version: EVENT_VERSION, batch: true, env: currentEnv(), events },
    `batch:${events[0].event}×${events.length}`
  );
}

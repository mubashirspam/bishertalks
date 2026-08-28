/**
 * WhatsApp, sent by us.
 *
 * Direct Meta Cloud API — no Make.com, no BSP in between. One POST per message
 * to the Graph API, with the token and phone number id from the environment.
 *
 * Plain fetch, no SDK, for the same reason lib/email.ts talks to Resend with
 * fetch: one endpoint and one JSON body is not worth a dependency in a
 * serverless bundle.
 *
 * Nothing here throws. A notification is a courtesy on top of a payment that
 * has already succeeded — an expired token, a template still in review or a
 * number Meta has throttled must never turn a confirmed order into a failed
 * request. Every failure comes back as a value, and the caller logs it.
 *
 * Two platform rules shape everything below, and breaking either is a rejected
 * send rather than a warning:
 *
 *   1. A business cannot message a customer out of the blue with free text.
 *      Anything we start has to be a template Meta has approved in advance —
 *      which is why the copy lives in lib/whatsapp-templates.ts and not here.
 *   2. A parameter may not be empty, and may not contain a newline, a tab or a
 *      run of four spaces. `sanitiseParam` below enforces that, because the
 *      alternative is discovering it on a customer's order.
 */

/**
 * Graph API version.
 *
 * Pinned, not "latest": Meta ships breaking changes between versions and a
 * silent bump is how a working integration stops one morning. Overridable so
 * the version can be moved on without a deploy — each one is supported for
 * about two years, and Meta's changelog says what is current.
 */
const API_VERSION = process.env.WHATSAPP_API_VERSION || "v21.0";

const GRAPH = "https://graph.facebook.com";

/** Long enough for a slow Graph response, short enough not to hold a request. */
const TIMEOUT_MS = 10_000;

export interface WhatsAppConfig {
  token: string;
  phoneNumberId: string;
}

/**
 * The credentials, or null when they aren't set.
 *
 * Returned as a value rather than read at module scope so that a missing token
 * is a caller's decision to handle, and so tests and scripts can see the same
 * answer the sender sees.
 */
export function whatsappConfig(): WhatsAppConfig | null {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) return null;
  return { token, phoneNumberId };
}

export const whatsappConfigured = (): boolean => whatsappConfig() !== null;

export interface SendResult {
  ok: boolean;
  /** Meta's message id (wamid.…) — the key every status callback carries. */
  messageId?: string;
  error?: string;
  /** Meta's numeric error code, kept for the log and for classification. */
  code?: number;
  /**
   * Worth trying again later (rate limit, Meta outage), as opposed to a
   * message that will fail identically forever (no WhatsApp account on that
   * number, template not approved).
   */
  retryable?: boolean;
}

/**
 * Meta error codes worth naming.
 *
 * The full list is long and mostly reads the same; these are the ones whose
 * fix is different from "read the message and think about it".
 */
const ERROR_HINTS: Record<number, string> = {
  100: "Invalid request — usually a parameter count that doesn't match the approved template",
  190: "Access token expired or revoked — generate a new permanent system-user token",
  131026: "That number cannot receive WhatsApp messages",
  131047: "Outside the 24-hour window and not a template — this must be sent as a template",
  131056: "Too many messages to this number in a short time",
  132000: "Parameter count doesn't match the template",
  132001: "Template not found — check the name and that the language is 'ml'",
  132005: "Template parameter is too long",
  132007: "Template parameter has a format Meta rejects (empty, newline, or 4+ spaces)",
  132012: "Template parameter format mismatch",
  132015: "Template is paused for quality reasons",
  132016: "Template has been disabled by Meta",
  133010: "Phone number not registered on the Cloud API",
  130429: "Rate limit hit — Meta is throttling this number",
  131048: "Spam rate limit — Meta has restricted this number's sending",
  131049: "Meta chose not to deliver this to protect user engagement",
  368: "Number temporarily blocked for policy violations",
};

/** These are worth another attempt; everything else is a real refusal. */
const RETRYABLE = new Set([130429, 131056, 131016, 500, 131000, 368]);

/**
 * Make a value safe to send as a template parameter.
 *
 * Meta rejects an empty parameter, and any parameter containing a newline, a
 * tab or four consecutive spaces — an address pasted straight from the order
 * row does all three. Trimmed to a sane length too: a parameter over 1024
 * characters fails the whole message.
 */
export function sanitiseParam(value: unknown, fallback = "—"): string {
  const text = String(value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return (text || fallback).slice(0, 900);
}

/**
 * Normalise an Indian mobile to what the Cloud API expects.
 *
 * Numbers reach us in every shape — typed by the customer, backfilled from
 * Razorpay, pasted by an admin. Meta wants a country code and no punctuation;
 * it accepts a leading "+" but is happiest without one.
 */
export function toWhatsAppNumber(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "").replace(/^0+/, "");
  const local = digits.length > 10 ? digits.slice(-10) : digits;
  if (!/^[6-9]\d{9}$/.test(local)) return null;
  return `91${local}`;
}

export interface TemplateSend {
  /** Bare digits with country code, from `toWhatsAppNumber`. */
  to: string;
  /** The approved template's name, exactly as Meta has it. */
  template: string;
  /** Language code of the approved template — 'ml' for Malayalam. */
  language: string;
  /** Body parameters, in the order {{1}}, {{2}}, … appear in the template. */
  params: string[];
  /**
   * One value per URL button whose link carries a variable, in button order.
   *
   * Required whenever the approved template has such a button: Meta counts the
   * button's `{{1}}` separately from the body's, and a template with a
   * variable URL and no button component fails the send outright. Templates
   * with static buttons, or none, leave this empty.
   */
  buttonParams?: string[];
}

/**
 * The components Meta expects at send time.
 *
 * Two kinds, and they are counted separately. The body's parameters fill
 * `{{1}}…{{n}}` in the text. A URL button whose link ends in `{{1}}` needs its
 * own component — one per button, carrying that button's index — and the
 * numbering restarts at 1 inside each button.
 *
 * Omitting a button component for a template that has a variable URL does not
 * degrade gracefully: Meta rejects the whole message. So this is not an
 * enhancement for templates that use buttons, it is the thing that makes them
 * sendable at all.
 */
function templateComponents(send: TemplateSend): Record<string, unknown>[] {
  const components: Record<string, unknown>[] = [];

  if (send.params.length) {
    components.push({
      type: "body",
      parameters: send.params.map((text) => ({
        type: "text",
        text: sanitiseParam(text),
      })),
    });
  }

  (send.buttonParams ?? []).forEach((value, index) => {
    components.push({
      type: "button",
      sub_type: "url",
      index: String(index),
      parameters: [{ type: "text", text: sanitiseParam(value) }],
    });
  });

  return components;
}

/**
 * Send one approved template message.
 *
 * Returns rather than throws, always. A caller that wants a message logged as
 * failed gets everything it needs from the result.
 */
export async function sendTemplate(send: TemplateSend): Promise<SendResult> {
  const config = whatsappConfig();
  if (!config) {
    return { ok: false, error: "WhatsApp not configured", retryable: false };
  }

  const body = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: send.to,
    type: "template",
    template: {
      name: send.template,
      language: { code: send.language },
      components: templateComponents(send),
    },
  };

  try {
    const res = await fetch(
      `${GRAPH}/${API_VERSION}/${config.phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }
    );

    const json = (await res.json().catch(() => ({}))) as {
      messages?: { id: string }[];
      error?: { message?: string; code?: number; error_data?: { details?: string } };
    };

    if (!res.ok || json.error) {
      const code = json.error?.code;
      const detail = json.error?.error_data?.details;
      const hint = code !== undefined ? ERROR_HINTS[code] : undefined;

      const error = [
        json.error?.message ?? `HTTP ${res.status}`,
        detail,
        hint ? `(${hint})` : null,
      ]
        .filter(Boolean)
        .join(" — ");

      console.error("[WhatsApp] send failed:", send.template, send.to, error);
      return {
        ok: false,
        error: error.slice(0, 1000),
        code,
        retryable: code !== undefined ? RETRYABLE.has(code) : res.status >= 500,
      };
    }

    return { ok: true, messageId: json.messages?.[0]?.id };
  } catch (e) {
    // A timeout is genuinely ambiguous: Meta may have accepted the message and
    // been slow to say so. Retryable, and the log row stays 'queued' until a
    // status callback either arrives or doesn't.
    const error = e instanceof Error ? e.message : "Request failed";
    console.error("[WhatsApp] send error:", send.template, error);
    return { ok: false, error, retryable: true };
  }
}

/**
 * Send free text, inside the 24-hour customer service window.
 *
 * Only legal when the customer has messaged us in the last 24 hours. Outside
 * it Meta answers 131047, which is why `assertSendable()` checks the window
 * itself and refuses first — this function is the wire call, not the rule.
 *
 * Deliberately not merged with sendTemplate: the payloads differ, the rules
 * differ, and one function with a mode flag would make it easy to send free
 * text where a template was required.
 */
export async function sendText(send: {
  to: string;
  body: string;
}): Promise<SendResult> {
  const config = whatsappConfig();
  if (!config) {
    return { ok: false, error: "WhatsApp not configured", retryable: false };
  }

  const text = send.body.trim();
  if (!text) {
    return { ok: false, error: "Message is empty", retryable: false };
  }

  try {
    const res = await fetch(
      `${GRAPH}/${API_VERSION}/${config.phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: send.to,
          type: "text",
          // Link previews off: a preview of our own tracking page adds nothing
          // and turns a two-line reply into a card.
          text: { preview_url: false, body: text.slice(0, 4096) },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }
    );

    const json = (await res.json().catch(() => ({}))) as {
      messages?: { id: string }[];
      error?: { message?: string; code?: number; error_data?: { details?: string } };
    };

    if (!res.ok || json.error) {
      const code = json.error?.code;
      const hint = code !== undefined ? ERROR_HINTS[code] : undefined;
      const error = [
        json.error?.message ?? `HTTP ${res.status}`,
        json.error?.error_data?.details,
        hint ? `(${hint})` : null,
      ]
        .filter(Boolean)
        .join(" — ");

      console.error("[WhatsApp] text send failed:", send.to, error);
      return {
        ok: false,
        error: error.slice(0, 1000),
        code,
        retryable: code !== undefined ? RETRYABLE.has(code) : res.status >= 500,
      };
    }

    return { ok: true, messageId: json.messages?.[0]?.id };
  } catch (e) {
    const error = e instanceof Error ? e.message : "Request failed";
    console.error("[WhatsApp] text send error:", error);
    return { ok: false, error, retryable: true };
  }
}

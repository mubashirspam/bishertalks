import { after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { addressUrl } from "@/lib/order-token";
import {
  sendMakeEvent,
  sendMakeEvents,
  makeConfigured,
  currentEnv,
  EVENT_VERSION,
  type MakeEvent,
} from "@/lib/make";
import {
  claimNotification,
  claimNotifications,
  markNotificationResult,
  markNotificationResults,
} from "@/lib/db/notifications";
import { WIRE_EVENT, isHeld, type OrderEvent } from "@/lib/notify-events";
import { upsertContact } from "@/lib/crm/contacts";
import { sendTemplateMessage } from "@/lib/crm/send";
import { toWhatsAppNumber, whatsappConfigured } from "@/lib/whatsapp";
import {
  TEMPLATES,
  TEMPLATE_LANGUAGE,
  type TemplateContext,
} from "@/lib/whatsapp-templates";

/**
 * Customer notifications.
 *
 * This module decides *what happened* — payment landed, parcel shipped — claims
 * an idempotency key for it, and hands the facts to whoever is delivering
 * messages today. It has never known the wording, and still doesn't: the
 * Malayalam copy lives in lib/whatsapp-templates.ts, where it can be diffed and
 * submitted to Meta from the same definition that fills it in.
 *
 * Two providers, chosen by WHATSAPP_PROVIDER:
 *
 *   meta   direct Meta Cloud API — one approved template per event, a wamid
 *          back on every send, and real delivery receipts on the webhook.
 *   make   the Make.com scenario this replaced. Kept only so a rejected
 *          template or a throttled number is an env var away from being
 *          rolled back, and deleted once Meta has run clean.
 *
 * Nothing here throws.
 */

export type { OrderEvent };

/** Which one is live. Defaults to Meta as soon as its credentials exist. */
export type NotifyProvider = "meta" | "make";

export function notifyProvider(): NotifyProvider {
  const choice = process.env.WHATSAPP_PROVIDER;
  if (choice === "meta" || choice === "make") return choice;
  return whatsappConfigured() ? "meta" : "make";
}

/** Can anything actually be sent right now? */
function notifyConfigured(): boolean {
  return notifyProvider() === "meta" ? whatsappConfigured() : makeConfigured();
}

export interface NotifyResult {
  ok: boolean;
  /** HTTP status for the route that wraps this. */
  status: number;
  error?: string;
  /** Already sent once — suppressed, and not a failure. */
  duplicate?: boolean;
  /**
   * Deliberately withheld — see HELD_EVENTS. Distinct from `duplicate` and
   * from a failure: the caller succeeded, and nothing was sent on purpose.
   */
  held?: boolean;
}

const PRODUCT_NAME = "Neuro Code";
/** The bonus course every book buyer gets. */
const BONUS_COURSE = { title: "Neuro Linguistic Programming", slug: "nlp" };

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "https://bishertalks.com";
}

/**
 * Normalise to E.164 plus bare digits.
 *
 * Numbers reach us in every shape — typed by the customer, backfilled from
 * Razorpay, pasted by an admin. Only Indian numbers work, same as before.
 */
function normalizePhone(raw: string | null | undefined) {
  const digits = (raw ?? "").replace(/\D/g, "").replace(/^0+/, "");
  const local = digits.length > 10 ? digits.slice(-10) : digits;
  if (local.length !== 10) return null;
  return { e164: `+91${local}`, digits: local };
}

function formatDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** The columns any event needs. `select("*")` supplies them all. */
interface OrderRow {
  order_number: string;
  buyer_name: string | null;
  buyer_phone: string | null;
  buyer_email: string | null;
  amount_paise: number | null;
  status: string | null;
  payment_status: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  district: string | null;
  state: string | null;
  pincode: string | null;
  courier_name: string | null;
  tracking_number: string | null;
  expected_delivery: string | null;
  payment_link_url: string | null;
  address_reminders_sent: number | null;
}

/**
 * Turn an order row into the payload the scenario consumes.
 *
 * Everything is pre-formatted here — amounts already in rupees, dates already
 * in en-IN, "Kochi, Kerala" already joined. Make should map fields, never
 * compute them: a formula inside a scenario is code nobody reviews.
 */
function buildOrderEvent(
  order: OrderRow,
  event: OrderEvent,
  phone: { e164: string; digits: string },
  eventId: string
): MakeEvent {
  const paise = order.amount_paise ?? 0;
  const short = [order.city, order.state].filter(Boolean).join(", ");

  return {
    version: EVENT_VERSION,
    event: WIRE_EVENT[event],
    event_id: eventId,
    sent_at: new Date().toISOString(),
    env: currentEnv(),
    customer: {
      name: order.buyer_name?.trim() || "there",
      phone: phone.e164,
      phone_digits: phone.digits,
      email: order.buyer_email || null,
    },
    order: {
      number: order.order_number,
      amount: Math.round(paise / 100),
      amount_paise: paise,
      currency: "INR",
      status: order.status || "",
      payment_status: order.payment_status || "",
      product: PRODUCT_NAME,
      address: {
        line1: order.address_line1,
        line2: order.address_line2,
        city: order.city,
        district: order.district,
        state: order.state,
        pincode: order.pincode,
        short,
      },
      courier: order.courier_name,
      tracking_number: order.tracking_number,
      // Same two fallbacks the old templates used, so the wording customers
      // see doesn't change with the plumbing.
      expected_delivery:
        formatDate(order.expected_delivery) ??
        (event === "shipped" ? "3–5 business days" : "5–7 business days"),
      payment_link_url: order.payment_link_url,
    },
    links: {
      address: addressUrl(order.order_number),
      tracking: `${appUrl()}/neuro-code/track?id=${order.order_number}`,
      site: `${appUrl()}/neuro-code`,
      course: `${appUrl()}/courses/${BONUS_COURSE.slug}`,
    },
    course:
      event === "course_access"
        ? {
            title: BONUS_COURSE.title,
            slug: BONUS_COURSE.slug,
            url: `${appUrl()}/courses/${BONUS_COURSE.slug}`,
            login_phone: phone.digits,
          }
        : null,
  };
}

// ── Delivery ────────────────────────────────────────────────────────────────

/**
 * The event payload, read as a template's blanks.
 *
 * Everything is already formatted by the time it reaches here — this only
 * picks fields out and supplies the fallbacks Meta forces on us: a template
 * parameter may not be empty, so every value has to resolve to *something*.
 * "—" is deliberately visible; a blank line in a customer's message is a bug
 * you can see, and inventing plausible text would be worse.
 */
function templateContext(payload: MakeEvent): TemplateContext {
  return {
    customerName: payload.customer.name,
    orderNumber: payload.order?.number ?? "",
    amount: String(payload.order?.amount ?? ""),
    addressShort: payload.order?.address.short || "—",
    expectedDelivery: payload.order?.expected_delivery || "5–7 ദിവസം",
    addressUrl: payload.links.address ?? payload.links.site,
    trackingUrl: payload.links.tracking ?? payload.links.site,
    courseTitle: payload.course?.title ?? "",
    courseUrl: payload.course?.url ?? payload.links.course ?? payload.links.site,
    loginPhone: payload.customer.phone_digits,
  };
}

interface DeliveryOutcome {
  ok: boolean;
  error?: string;
  /** Meta's wamid — how a status callback finds this row later. */
  messageId?: string;
  /** True when the provider isn't configured, which is not a failure. */
  skipped?: boolean;
}

/**
 * Send one message through whichever provider is live.
 *
 * On the Meta path this is where an event becomes an actual template: the
 * event name picks the template, and the template picks which facts it wants
 * and in what order. Nothing else in the app knows that mapping.
 */
async function deliver(
  payload: MakeEvent,
  event: OrderEvent
): Promise<DeliveryOutcome> {
  if (notifyProvider() === "make") {
    const result = await sendMakeEvent(payload);
    return { ok: result.ok, error: result.error, skipped: result.skipped };
  }

  const to = toWhatsAppNumber(payload.customer.phone);
  if (!to) return { ok: false, error: "Unusable phone number" };

  // Through the gate, like everything else. An order notification is the one
  // kind of message with a real claim to be exempt — the customer paid for the
  // thing it is about — and it is still not exempt from the stop flag. Someone
  // who asked us to stop asked us to stop; the shop has their email and their
  // phone for anything that genuinely cannot wait.
  const contact = await upsertContact(to, {
    name: payload.customer.name,
    orderNumber: payload.order?.number ?? null,
  });

  if (!contact) return { ok: false, error: "Unusable phone number" };

  const template = TEMPLATES[event];
  const context = templateContext(payload);

  const outcome = await sendTemplateMessage({
    contact,
    kind: "transactional",
    template: {
      name: template.name,
      category: template.category,
      language: TEMPLATE_LANGUAGE,
    },
    params: template.params(context),
    buttonParams: buttonParamsFor(template, context),
    preview: fillPreview(template, context),
  });

  if (outcome.ok) return { ok: true, messageId: outcome.wamid ?? undefined };

  // A refusal is not a failure to retry — it is a decision. Marked skipped so
  // the log says "we chose not to" rather than "it broke".
  if (outcome.refused) {
    console.warn("[Notify] refused by gate:", template.name, outcome.reason);
    return { ok: false, error: outcome.reason, skipped: outcome.code === "opted_out" };
  }

  return { ok: false, error: outcome.error };
}

/**
 * The values for any URL button whose link carries a variable.
 *
 * Meta counts a button's `{{1}}` separately from the body's, and a template
 * with a variable button URL and no button component fails outright — so this
 * has to walk the buttons in the order they were approved in.
 */
function buttonParamsFor(
  template: (typeof TEMPLATES)[OrderEvent],
  context: ReturnType<typeof templateContext>
): string[] {
  return (template.buttons ?? [])
    .filter((b) => b.type === "URL" && b.param)
    .map((b) => (b.type === "URL" && b.param ? b.param(context) : ""));
}

/** The message as the customer will read it, for the conversation thread. */
function fillPreview(
  template: (typeof TEMPLATES)[OrderEvent],
  context: ReturnType<typeof templateContext>
): string {
  let text = template.body;
  template.params(context).forEach((value, i) => {
    text = text.replaceAll(`{{${i + 1}}}`, value);
  });
  return text;
}

/**
 * How many messages are in flight to Meta at once.
 *
 * The Cloud API takes one message per request — there is no batch endpoint —
 * so an admin marking fifty parcels shipped is fifty calls. A handful at a
 * time keeps that quick without tripping the per-number rate limit, which
 * costs far more than the seconds it saves.
 */
const SEND_CONCURRENCY = 5;

/**
 * Idempotency key.
 *
 * One per order per event, so the verify route and the Razorpay webhook racing
 * the same payment can only produce one message. Address reminders carry a
 * counter because repeating them is the point, and a deliberate admin re-send
 * carries a timestamp because overriding the guard is the point.
 */
function eventId(
  orderNumber: string,
  event: OrderEvent,
  opts: { resend?: boolean; sequence?: number } = {}
): string {
  const base = `${orderNumber}:${WIRE_EVENT[event]}`;
  if (opts.resend) return `${base}:resend:${Date.now()}`;
  if (opts.sequence !== undefined) return `${base}:${opts.sequence}`;
  return base;
}

/**
 * Send the notification for an order event.
 *
 * Lives here rather than behind an HTTP route so server-side callers can send
 * directly. The route at /api/notify/send delegates to this.
 */
export async function sendOrderNotification(
  orderNumber: string,
  event: OrderEvent,
  opts: { resend?: boolean } = {}
): Promise<NotifyResult> {
  // Bail out before claiming. A claim writes the event_id, and the unique index
  // would then suppress the real send once WhatsApp is finally configured — an
  // unsent message must not consume its own idempotency key.
  if (!notifyConfigured()) {
    console.warn("[Notify] no WhatsApp provider configured — not sending:", orderNumber, event);
    return { ok: false, status: 503, error: "WhatsApp automation not configured" };
  }

  try {
    const { data } = await supabaseAdmin
      .from("orders")
      .select("*")
      .eq("order_number", orderNumber)
      .single();

    const order = data as OrderRow | null;
    if (!order) return { ok: false, status: 404, error: "Order not found" };

    // With Magic Checkout the phone arrives from Razorpay after payment, so an
    // order can legitimately have none yet (or the backfill failed). Bail out
    // rather than throwing on null.
    const phone = normalizePhone(order.buyer_phone);
    if (!phone) {
      console.error("[Notify] no usable buyer_phone on order:", orderNumber);
      return { ok: false, status: 409, error: "Order has no phone number yet" };
    }

    const payload = buildOrderEvent(
      order,
      event,
      phone,
      eventId(orderNumber, event, { resend: opts.resend })
    );

    if (!(await claimNotification(payload))) {
      return { ok: true, status: 200, duplicate: true };
    }

    // Held back on purpose — see HELD_EVENTS. Claimed and logged first, so the
    // row says "we chose not to send this" rather than leaving no trace at all.
    if (isHeld(event)) {
      await markNotificationResult(payload.event_id, {
        status: "skipped",
        error: `${event} is held: its wording needs fixing before it goes out`,
      });
      console.warn("[Notify] held, not sent:", orderNumber, event);
      return { ok: true, status: 200, held: true };
    }

    const result = await deliver(payload, event);

    if (!result.ok) {
      await markNotificationResult(payload.event_id, {
        status: result.skipped ? "skipped" : "failed",
        error: result.error,
      });
      return result.skipped
        ? { ok: false, status: 503, error: "WhatsApp automation not configured" }
        : { ok: false, status: 502, error: result.error || "Send failed" };
    }

    // Meta answers with a wamid, which means it has taken the message — record
    // that now, and let the status webhook upgrade the row to delivered or
    // read. On the Make path there is no id and no such certainty, so the row
    // stays 'queued' until /api/notify/callback says otherwise.
    if (result.messageId) {
      await markNotificationResult(payload.event_id, {
        status: "sent",
        provider: "meta",
        providerMessageId: result.messageId,
      });
    }

    return { ok: true, status: 200 };
  } catch (err) {
    console.error("[Notify] order event failed:", orderNumber, event, err);
    return { ok: false, status: 500, error: "Internal server error" };
  }
}

/**
 * Same, for many orders at once.
 *
 * One database read and one webhook call for the whole batch — an admin
 * marking fifty parcels shipped should not cost fifty round trips here or
 * fifty operations in Make. Returns how many events were accepted.
 */
export async function sendOrderNotifications(
  orderNumbers: string[],
  event: OrderEvent
): Promise<number> {
  if (!orderNumbers.length) return 0;

  // As above — don't burn idempotency keys on messages that can't be sent.
  if (!notifyConfigured()) {
    console.warn("[Notify] no WhatsApp provider configured — not sending:", event);
    return 0;
  }

  // The second route to the wire, and it needs the same hold as the single
  // send. Checked before anything is claimed: a batch of held events has
  // nothing to record per order beyond the fact that the event is withheld,
  // which HELD_EVENTS already says once for all of them.
  if (isHeld(event)) {
    console.warn(
      `[Notify] ${event} is held — ${orderNumbers.length} not sent`
    );
    return 0;
  }

  try {
    const { data } = await supabaseAdmin
      .from("orders")
      .select("*")
      .in("order_number", orderNumbers);

    const orders = (data ?? []) as OrderRow[];
    const built: MakeEvent[] = [];

    for (const order of orders) {
      const phone = normalizePhone(order.buyer_phone);
      if (!phone) {
        console.error("[Notify] skipping, no phone:", order.order_number);
        continue;
      }

      built.push(
        buildOrderEvent(order, event, phone, eventId(order.order_number, event))
      );
    }

    const events = await claimNotifications(built);
    if (!events.length) return 0;

    // Make takes the whole batch in one call — the scenario's Iterator fans it
    // out — and chunking is only about its request size limit.
    if (notifyProvider() === "make") {
      let accepted = 0;
      for (let i = 0; i < events.length; i += 100) {
        const chunk = events.slice(i, i + 100);
        const result = await sendMakeEvents(chunk);

        if (result.ok) {
          accepted += chunk.length;
        } else {
          await markNotificationResults(
            chunk.map((e) => e.event_id),
            { status: result.skipped ? "skipped" : "failed", error: result.error }
          );
        }
      }
      return accepted;
    }

    // Meta is one request per message, so this is a real fan-out. A few at a
    // time: fifty sequential round trips would hold the admin's request open
    // for the better part of a minute, and fifty at once trips the rate limit.
    let sent = 0;
    for (let i = 0; i < events.length; i += SEND_CONCURRENCY) {
      const chunk = events.slice(i, i + SEND_CONCURRENCY);

      const outcomes = await Promise.all(
        chunk.map(async (payload) => ({
          payload,
          result: await deliver(payload, event),
        }))
      );

      // One row per message, because each carries its own wamid and its own
      // reason for failing. A batch that half-succeeds has to read that way in
      // the log, or support is guessing which customer heard from us.
      await Promise.all(
        outcomes.map(({ payload, result }) =>
          markNotificationResult(payload.event_id, {
            status: result.ok ? "sent" : "failed",
            provider: "meta",
            providerMessageId: result.messageId ?? null,
            error: result.error ?? null,
          })
        )
      );

      sent += outcomes.filter((o) => o.result.ok).length;
    }

    return sent;
  } catch (err) {
    console.error("[Notify] batch failed:", event, err);
    return 0;
  }
}

/**
 * Course-access notification.
 *
 * Unlike order events this isn't tied to an order — access is also granted by
 * an admin, or by CSV import, where no order exists. So it takes a phone
 * number directly.
 *
 * Never throws — a notification failure must never undo a granted course.
 */
export async function notifyCourseAccess(params: {
  phone: string | null | undefined;
  name?: string | null;
  courseTitle: string;
  courseSlug: string;
  /** When the grant came from a purchase, so the log ties to the order. */
  orderNumber?: string | null;
}): Promise<void> {
  const { phone: raw, name, courseTitle, courseSlug, orderNumber } = params;

  const phone = normalizePhone(raw);
  if (!phone) {
    console.error("[Notify] course access: no usable phone, skipping");
    return;
  }

  if (!notifyConfigured()) {
    console.warn("[Notify] no WhatsApp provider configured — course unlock not sent");
    return;
  }

  try {
    const url = `${appUrl()}/courses/${courseSlug}`;
    const payload: MakeEvent = {
      version: EVENT_VERSION,
      event: WIRE_EVENT.course_access,
      // Keyed on the person and the course, not the order: granting the same
      // course twice shouldn't message them twice, however it was granted.
      event_id: `${phone.digits}:course.access:${courseSlug}`,
      sent_at: new Date().toISOString(),
      env: currentEnv(),
      customer: {
        name: name?.trim() || "there",
        phone: phone.e164,
        phone_digits: phone.digits,
        email: null,
      },
      order: null,
      links: {
        address: null,
        tracking: null,
        site: `${appUrl()}/neuro-code`,
        course: url,
      },
      course: {
        title: courseTitle,
        slug: courseSlug,
        url,
        login_phone: phone.digits,
      },
    };

    // The log row carries the order when we know it, so the admin's message
    // history for a purchase includes the course unlock.
    if (!(await claimNotification(payload, orderNumber))) return;

    const result = await deliver(payload, "course_access");

    if (!result.ok) {
      await markNotificationResult(payload.event_id, {
        status: result.skipped ? "skipped" : "failed",
        error: result.error,
      });
    } else if (result.messageId) {
      await markNotificationResult(payload.event_id, {
        status: "sent",
        provider: "meta",
        providerMessageId: result.messageId,
      });
    }
  } catch (e) {
    console.error("[Notify] course access send failed:", e);
  }
}

/**
 * Fire a notification after the response has been sent.
 *
 * The three payment paths used to fire-and-forget a fetch at our own
 * /api/whatsapp/send: an extra cold start, a dependency on
 * NEXT_PUBLIC_APP_URL being right (which has silently broken before), and a
 * floating promise the platform may kill once the response is returned.
 * `after()` is the supported way to do post-response work.
 */
export function notifyAfterResponse(
  orderNumber: string,
  event: OrderEvent
): void {
  const run = () =>
    sendOrderNotification(orderNumber, event).catch((e) =>
      console.error("[Notify] deferred send failed:", orderNumber, event, e)
    );

  try {
    after(run);
  } catch {
    // Called outside a request scope (a script, a cron worker). Fall back to
    // running it inline rather than dropping the message.
    void run();
  }
}

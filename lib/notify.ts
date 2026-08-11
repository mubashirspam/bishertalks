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

/**
 * Customer notifications.
 *
 * This module builds *events*, not messages. Every WhatsApp message is written
 * and sent by the Make.com scenario; all this does is hand it the facts and an
 * idempotency key. That means message copy changes without a deploy, and a
 * change of WhatsApp provider is invisible from here.
 *
 * The internal event names are unchanged (`shipped`, `delivered`, …) because
 * they mirror order statuses and callers pass them straight through. WIRE_EVENT
 * maps them to the dotted names the scenario routes on.
 *
 * Nothing here throws.
 */

export type OrderEvent =
  | "payment_received"
  | "confirmed"
  | "shipped"
  | "delivered"
  | "course_access";

/** Internal name → the name the Make scenario's router matches on. */
const WIRE_EVENT: Record<OrderEvent, string> = {
  payment_received: "payment.received",
  confirmed: "order.confirmed",
  shipped: "order.shipped",
  delivered: "order.delivered",
  course_access: "course.access",
};

export interface NotifyResult {
  ok: boolean;
  /** HTTP status for the route that wraps this. */
  status: number;
  error?: string;
  /** Already sent once — suppressed, and not a failure. */
  duplicate?: boolean;
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
  // would then suppress the real send once Make is finally configured — an
  // unsent message must not consume its own idempotency key.
  if (!makeConfigured()) {
    console.warn("[Notify] MAKE_WEBHOOK_URL not set — not sending:", orderNumber, event);
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

    // Reminders are the one event meant to repeat, so the counter is part of
    // the key. Read before the increment below.
    const sequence =
      event === "payment_received"
        ? (order.address_reminders_sent ?? 0) + 1
        : undefined;

    const payload = buildOrderEvent(
      order,
      event,
      phone,
      eventId(orderNumber, event, { resend: opts.resend, sequence })
    );

    if (!(await claimNotification(payload))) {
      return { ok: true, status: 200, duplicate: true };
    }

    const result = await sendMakeEvent(payload);

    if (!result.ok) {
      await markNotificationResult(payload.event_id, {
        status: result.skipped ? "skipped" : "failed",
        error: result.error,
      });
      return result.skipped
        ? { ok: false, status: 503, error: "WhatsApp automation not configured" }
        : { ok: false, status: 502, error: result.error || "Send failed" };
    }

    // Left as 'queued' on purpose: Make has accepted it, but only the callback
    // at /api/notify/callback can say the message actually went out.
    if (event === "payment_received") {
      await supabaseAdmin
        .from("orders")
        .update({ address_reminders_sent: sequence })
        .eq("order_number", orderNumber);
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
  if (!makeConfigured()) {
    console.warn("[Notify] MAKE_WEBHOOK_URL not set — not sending:", event);
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

    // Chunked to stay inside Make's request size limit; each chunk is still a
    // single execution that the scenario's Iterator fans out.
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

  if (!makeConfigured()) {
    console.warn("[Notify] MAKE_WEBHOOK_URL not set — course unlock not sent");
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

    const result = await sendMakeEvent(payload);
    if (!result.ok) {
      await markNotificationResult(payload.event_id, {
        status: result.skipped ? "skipped" : "failed",
        error: result.error,
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

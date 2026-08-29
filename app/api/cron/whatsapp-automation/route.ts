export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  claimDue,
  finishEvent,
  noteAttempt,
  releaseStale,
  scheduleEvent,
  type AutomationEvent,
} from "@/lib/crm/automation";
import { getContact, upsertContact } from "@/lib/crm/contacts";
import { sendTemplateMessage } from "@/lib/crm/send";
import { tagsFor, onHold } from "@/lib/crm/tags";
import { FLOW_TEMPLATES, TEMPLATE_LANGUAGE } from "@/lib/whatsapp-templates";

/**
 * The follow-up worker.
 *
 * Two halves, in this order:
 *
 *   enqueue  turn elapsed time into queued rows — the "10 days after it was
 *            delivered" kind of rule, which no button tap will ever create
 *   drain    send what is due
 *
 * Enqueue first so a rule that becomes true this minute is acted on this run
 * rather than the next one.
 *
 * Every row still passes the gate on its own at send time. That is the whole
 * reason this is a queue and not a loop inside the thing that schedules: a
 * customer who taps *Received* on Monday and says STOP on Wednesday must not
 * get Thursday's follow-up, and only a decision made at send time can promise
 * that.
 *
 * Schedule it with `Authorization: Bearer $CRON_SECRET`, every 15 minutes.
 * There is no scheduler configured in this repo — see PENDING.md.
 */

/** One run's worth. Comfortably inside the daily budget the gate enforces. */
const PER_RUN = 100;

/** A network failure gets one more go, an hour later. Then it stops. */
const MAX_ATTEMPTS = 2;

function authorised(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error("[Automation] CRON_SECRET is unset — refusing to run");
    return false;
  }

  const sent =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    new URL(request.url).searchParams.get("key") ||
    "";
  const a = Buffer.from(sent);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function GET(request: NextRequest) {
  if (!authorised(request)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const released = await releaseStale();
  const queued = await enqueueElapsed();
  const drained = await drain();

  return NextResponse.json({ ok: true, released, queued, ...drained });
}

/**
 * Rules that fire on elapsed time rather than on a tap.
 *
 * Deliberately only the two the brief describes from `delivered_at`. The
 * unique index on (contact, event_type, order) makes this safe to run every
 * fifteen minutes forever: a parcel delivered eleven days ago whose customer
 * already tapped *Received* has a pending or sent row and gets nothing new.
 *
 * `neuro_order_paid` and `neuro_delivery_confirmed` are NOT enqueued here.
 * Both duplicate templates `lib/notify.ts` already sends on those events, and
 * sending two confirmations for one order is worse than sending the older
 * wording. Decide which survives first — see docs/neuro-crm-automation-plan.md.
 */
async function enqueueElapsed(): Promise<number> {
  const rules = [
    { days: 10, eventType: "reading_followup_10d", template: "neuro_reading_followup_10d" },
    { days: 30, eventType: "feedback_30d", template: "neuro_feedback_30d" },
  ];

  let queued = 0;

  for (const rule of rules) {
    const cutoff = new Date(Date.now() - rule.days * 86_400_000).toISOString();

    const { data, error } = await supabaseAdmin
      .from("orders")
      .select("id, order_number, buyer_name, buyer_phone, delivered_at")
      .eq("status", "delivered")
      .not("delivered_at", "is", null)
      .lte("delivered_at", cutoff)
      // A month past the trigger it stops being a follow-up and starts being
      // a message out of nowhere. The back catalogue is not an audience.
      .gte("delivered_at", new Date(Date.now() - (rule.days + 30) * 86_400_000).toISOString())
      .limit(200);

    if (error) {
      console.error("[Automation] enqueue read failed:", rule.eventType, error.message);
      continue;
    }

    for (const order of (data ?? []) as OrderRow[]) {
      // No contact row means nobody has ever messaged them through this
      // system. Create one — that is what makes them reachable — but do not
      // invent consent; the gate still decides.
      const contact = await upsertContact(order.buyer_phone, {
        name: order.buyer_name,
        orderNumber: order.order_number,
      });
      if (!contact || contact.opt_out_at) continue;

      const tags = await tagsFor(contact.id);
      if (onHold(tags)) continue;

      const row = await scheduleEvent({
        contactId: contact.id,
        orderId: order.id,
        eventType: rule.eventType,
        templateName: rule.template,
        // Due now: the elapsed time IS the schedule.
        afterDays: 0,
        reason: `${rule.days} days after delivery`,
      });
      if (row) queued++;
    }
  }

  return queued;
}

interface OrderRow {
  id: string;
  order_number: string;
  buyer_name: string | null;
  buyer_phone: string | null;
  delivered_at: string | null;
}

async function drain(): Promise<{
  claimed: number;
  sent: number;
  refused: number;
  failed: number;
  cancelled: number;
}> {
  const rows = await claimDue(PER_RUN);
  let sent = 0;
  let refused = 0;
  let failed = 0;
  let cancelled = 0;

  for (const event of rows) {
    const outcome = await runOne(event);
    if (outcome === "sent") sent++;
    else if (outcome === "refused") refused++;
    else if (outcome === "cancelled") cancelled++;
    else failed++;
  }

  return { claimed: rows.length, sent, refused, failed, cancelled };
}

async function runOne(
  event: AutomationEvent
): Promise<"sent" | "refused" | "failed" | "cancelled"> {
  const template = event.template_name ? FLOW_TEMPLATES[event.template_name] : null;

  if (!template) {
    await finishEvent(event.id, {
      status: "cancelled",
      error: `No template named ${event.template_name}`,
    });
    return "cancelled";
  }

  const contact = await getContact(event.contact_id);
  if (!contact) {
    await finishEvent(event.id, { status: "cancelled", error: "Contact is gone" });
    return "cancelled";
  }

  // Checked here as well as at schedule time, because the whole point of the
  // queue is that things change in between.
  if (contact.opt_out_at) {
    await finishEvent(event.id, { status: "cancelled", error: "Asked us to stop" });
    return "cancelled";
  }

  const tags = await tagsFor(contact.id);
  if (onHold(tags)) {
    await finishEvent(event.id, {
      status: "cancelled",
      error: "On hold — delivery or support issue open",
    });
    return "cancelled";
  }

  const result = await sendTemplateMessage({
    contact,
    // Campaign, not transactional: these are nudges, and they belong under the
    // campaign cap and the marketing consent check like every other nudge.
    kind: "campaign",
    template: {
      name: template.name,
      category: template.category,
      language: TEMPLATE_LANGUAGE,
    },
    params: template.params({
      customerName: contact.display_name ?? "സുഹൃത്തേ",
      orderNumber: contact.last_order_number ?? "",
    }),
    preview: fillPreview(template.body, template.params({
      customerName: contact.display_name ?? "സുഹൃത്തേ",
      orderNumber: contact.last_order_number ?? "",
    })),
  });

  if (result.ok) {
    await finishEvent(event.id, { status: "sent" });
    return "sent";
  }

  // A refusal is a decision, never retried. The code is kept so the admin
  // screen can say "no marketing opt-in" rather than "failed".
  if (result.refused) {
    await finishEvent(event.id, {
      status: "refused",
      refusalCode: result.code,
      error: result.reason,
    });
    return "refused";
  }

  // A failure might be the network. One more go, an hour later, then stop.
  if (result.retryable && event.attempts + 1 < MAX_ATTEMPTS) {
    await noteAttempt(event.id, event.attempts);
    await finishEvent(event.id, { status: "pending", error: result.error, retryInMinutes: 60 });
    return "failed";
  }

  await noteAttempt(event.id, event.attempts);
  await finishEvent(event.id, { status: "failed", error: result.error });
  return "failed";
}

/** The message as the customer will read it, for the conversation thread. */
function fillPreview(body: string, params: string[]): string {
  let text = body;
  params.forEach((value, i) => {
    text = text.replaceAll(`{{${i + 1}}}`, value);
  });
  return text;
}

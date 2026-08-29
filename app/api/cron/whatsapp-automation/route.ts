export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import {
  claimDue,
  finishEvent,
  noteAttempt,
  releaseStale,
  type AutomationEvent,
} from "@/lib/crm/automation";
import { getContacts } from "@/lib/crm/contacts";
import { sendTemplateMessage } from "@/lib/crm/send";
import { crmFieldsFor, onHold } from "@/lib/crm/tags";
import { FLOW_TEMPLATES, TEMPLATE_LANGUAGE } from "@/lib/whatsapp-templates";

/**
 * The follow-up worker.
 *
 * One job: drain what a customer's own button tap put in the queue. It does
 * not decide that anybody is due a message — see the note below the handler
 * for the rule that used to, and what it did.
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
  const drained = await drain();

  return NextResponse.json({ ok: true, released, ...drained });
}

/**
 * There is no time-based enqueue any more, and that is deliberate.
 *
 * There was one: "ten days after delivered_at, queue the reading follow-up",
 * with a thirty-day trailing window meant to keep it off the back catalogue.
 * It queued **700 people in one run** — every order delivered in the last
 * forty days, most of whom had had their book for weeks. Six hundred messages
 * were attempted before the daily budget refused the rest, and the budget
 * being the thing that stopped it is the tell: nothing else was going to.
 *
 * A rule that turns elapsed time into a bulk send is a campaign wearing a
 * cron's clothes. It has no preview, no recipient count, no cap anybody
 * chose, and no person deciding that today is the day. Campaigns have all
 * four — so the reading follow-up, the encouragement and the 30-day feedback
 * are built there now, filtered by how long ago the parcel was delivered.
 *
 * What remains in this worker is the queue itself, which still drains: rows
 * put there by a customer tapping a button, one person at a time, in a
 * conversation they started.
 */

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

  // One read for the whole run rather than one per row. A hundred due events
  // used to mean a hundred contact lookups before a single message was sent —
  // requests Meta's neighbour, the database, counts just as carefully.
  const contacts = await getContacts(rows.map((r) => r.contact_id));

  for (const event of rows) {
    const outcome = await runOne(event, contacts.get(event.contact_id) ?? null);
    if (outcome === "sent") sent++;
    else if (outcome === "refused") refused++;
    else if (outcome === "cancelled") cancelled++;
    else failed++;
  }

  return { claimed: rows.length, sent, refused, failed, cancelled };
}

async function runOne(
  event: AutomationEvent,
  contact: Awaited<ReturnType<typeof getContacts>> extends Map<string, infer C>
    ? C | null
    : never
): Promise<"sent" | "refused" | "failed" | "cancelled"> {
  const template = event.template_name ? FLOW_TEMPLATES[event.template_name] : null;

  if (!template) {
    await finishEvent(event.id, {
      status: "cancelled",
      error: `No template named ${event.template_name}`,
    });
    return "cancelled";
  }

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

  const { tags } = await crmFieldsFor(contact.id);
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

import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  getSettings,
  sentToday,
  windowState,
  type Contact,
  type WhatsAppSettings,
} from "@/lib/crm/contacts";
import { latestHealth, ratingAllows } from "@/lib/crm/health";
import type { TemplateCategory } from "@/lib/whatsapp-templates";

/**
 * The send gate.
 *
 * Every outbound WhatsApp message passes through here — order notifications,
 * hand-typed replies, campaign messages, everything. This is the whole safety
 * design of the CRM; the rest of it is plumbing arranged around this function.
 *
 * `sendTemplate` and `sendText` in lib/whatsapp.ts are the raw wire calls and
 * must not be reached any other way. That is enforced by the
 * `no-restricted-imports` rule in eslint.config.mjs, so a future caller that
 * bypasses the gate is a build error rather than an incident.
 *
 * Checks run in a fixed order and the first refusal wins, because the order
 * encodes what matters most: consent before commerce, and the customer's wish
 * before our budget.
 */

export type SendKind = "transactional" | "reply" | "campaign";

export interface SendRequest {
  contact: Contact;
  kind: SendKind;
  /** Absent for a free-text reply. */
  template?: { name: string; category: TemplateCategory };
  /** True when the message body is free text rather than a template. */
  freeText?: boolean;
}

export type GateVerdict =
  | { allow: true }
  | { allow: false; reason: string; code: RefusalCode };

/**
 * Machine-readable refusal, so the campaign screen can group thousands of
 * refusals into a handful of lines instead of listing sentences.
 */
export type RefusalCode =
  | "opted_out"
  | "sending_paused"
  | "number_health"
  | "template_not_approved"
  | "no_marketing_consent"
  | "frequency_cap"
  | "daily_budget"
  | "campaign_cap"
  | "window_closed"
  | "no_phone";

export const REFUSAL_LABEL: Record<RefusalCode, string> = {
  opted_out: "Asked us to stop",
  sending_paused: "Sending is paused",
  number_health: "Number quality too low",
  template_not_approved: "Template not approved",
  no_marketing_consent: "No marketing opt-in",
  frequency_cap: "Messaged too recently",
  daily_budget: "Daily budget spent",
  campaign_cap: "Campaign cap reached",
  window_closed: "24-hour window closed",
  no_phone: "No usable phone number",
};

/**
 * May we send this?
 *
 * Never throws. A gate that threw would take down a payment webhook, and the
 * whole point of the send path is that a messaging problem can never fail an
 * order.
 */
export async function assertSendable(req: SendRequest): Promise<GateVerdict> {
  try {
    return await run(req);
  } catch (e) {
    console.error("[Gate] check threw — refusing:", e);
    // Refuse on error, never allow. An unreadable rule is not permission.
    return {
      allow: false,
      reason: "Safety checks could not be completed",
      code: "sending_paused",
    };
  }
}

async function run(req: SendRequest): Promise<GateVerdict> {
  const { contact, kind } = req;

  // ── 01 · The stop flag ────────────────────────────────────────────────
  // First, and with no exemption. Not for transactional messages, not for
  // "this one is important". Someone who asked us to stop is done.
  if (contact.opt_out_at) {
    return {
      allow: false,
      code: "opted_out",
      reason: `Opted out on ${contact.opt_out_at.slice(0, 10)}`,
    };
  }

  if (!contact.phone) {
    return { allow: false, code: "no_phone", reason: "No usable phone number" };
  }

  const settings = await getSettings();

  // ── 02 · The kill switch ──────────────────────────────────────────────
  if (settings.sending_paused) {
    return {
      allow: false,
      code: "sending_paused",
      reason: settings.paused_reason || "Sending is paused",
    };
  }

  // ── 03 · Number health ────────────────────────────────────────────────
  // Read from the stored snapshot, never live: a Graph round trip inside the
  // send path would put Meta's latency on the critical path of a payment.
  const health = await latestHealth();
  const allowed = ratingAllows(health?.quality_rating ?? null, kind);
  if (!allowed.ok) {
    return { allow: false, code: "number_health", reason: allowed.reason };
  }

  // ── 04 · The template is approved, in the language we ask for ─────────
  if (req.template) {
    const ok = await templateIsApproved(req.template.name);
    if (!ok.approved) {
      return { allow: false, code: "template_not_approved", reason: ok.reason };
    }
  }

  // ── 05 · The window, for free text ────────────────────────────────────
  // Refused here rather than by Meta, so staff read "the customer last wrote
  // 26 hours ago" instead of error 131047.
  if (req.freeText) {
    const win = windowState(contact.last_inbound_at);
    if (!win.open) {
      return {
        allow: false,
        code: "window_closed",
        reason: contact.last_inbound_at
          ? "More than 24 hours since they last wrote — send a template instead"
          : "They have never written to us — send a template instead",
      };
    }
    // A free-text reply inside the window is exempt from everything below.
    // It costs nothing extra, it is a human answering a human, and capping it
    // would mean refusing to talk to a customer who is mid-conversation.
    return { allow: true };
  }

  // ── 06 · Category consent ─────────────────────────────────────────────
  if (req.template?.category === "MARKETING" && !contact.marketing_opt_in_at) {
    return {
      allow: false,
      code: "no_marketing_consent",
      reason: "Marketing template, and this contact has not opted in",
    };
  }

  // Transactional messages skip the caps below. An order update is something
  // the customer asked for by buying, it is not discretionary, and delaying it
  // to protect a budget is how someone ends up not knowing their book shipped.
  if (kind === "transactional") return { allow: true };

  // ── 07 · Frequency cap, per contact ───────────────────────────────────
  const freq = await frequencyBlocked(contact.id, settings);
  if (freq) return { allow: false, code: "frequency_cap", reason: freq };

  // ── 08 · Budget ───────────────────────────────────────────────────────
  const today = await sentToday();
  if (today.total >= settings.daily_budget) {
    return {
      allow: false,
      code: "daily_budget",
      reason: `Daily budget of ${settings.daily_budget} messages is spent`,
    };
  }
  if (kind === "campaign" && today.campaign >= settings.campaign_daily_cap) {
    return {
      allow: false,
      code: "campaign_cap",
      reason: `Campaign cap of ${settings.campaign_daily_cap} a day is reached`,
    };
  }

  return { allow: true };
}

/** Has this contact had a campaign message too recently? */
async function frequencyBlocked(
  contactId: string,
  settings: WhatsAppSettings
): Promise<string | null> {
  const since = new Date(
    Date.now() - settings.min_days_between_campaigns * 86400000
  ).toISOString();

  const { count: recent } = await supabaseAdmin
    .from("whatsapp_messages")
    .select("id", { count: "exact", head: true })
    .eq("contact_id", contactId)
    .eq("direction", "out")
    .not("campaign_id", "is", null)
    .gte("created_at", since);

  if ((recent ?? 0) > 0) {
    return `Had a campaign message in the last ${settings.min_days_between_campaigns} days`;
  }

  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString();
  const { count: monthly } = await supabaseAdmin
    .from("whatsapp_messages")
    .select("id", { count: "exact", head: true })
    .eq("contact_id", contactId)
    .eq("direction", "out")
    .not("campaign_id", "is", null)
    .gte("created_at", monthAgo);

  if ((monthly ?? 0) >= settings.max_campaigns_per_30_days) {
    return `Already had ${monthly} campaign messages in 30 days`;
  }

  return null;
}

/**
 * Is Meta currently willing to send this template?
 *
 * Reads the synced copy written by the health cron, so no Graph round trip
 * sits in the send path.
 *
 * The distinction that matters here is between "we synced, and this template
 * is not approved" and "we have never synced anything". The first is a real
 * refusal. The second means the cron has not run yet — on a fresh deploy, or
 * because nobody scheduled it — and refusing on it would silently stop every
 * order notification in the system until someone noticed.
 *
 * That is not hypothetical: it happened. Eight shipping notifications were
 * refused with "no approved Malayalam version on record" while the table was
 * simply empty, hours after this gate first ran. `ratingAllows` already takes
 * the opposite and correct position on the same question — an unknown rating
 * is treated as green rather than blocking — and this now matches it.
 *
 * When nothing has synced, Meta is the authority: it answers 132001, which is
 * mapped, logged and actionable. A template that is genuinely missing fails
 * loudly at the wire instead of silently at the gate.
 */
async function templateIsApproved(
  name: string
): Promise<{ approved: boolean; reason: string }> {
  const { data } = await supabaseAdmin
    .from("whatsapp_template_status")
    .select("status, language, rejected_reason")
    .eq("name", name)
    .eq("language", "ml")
    .maybeSingle();

  if (!data) {
    // Has the cron ever run? One cheap count answers it.
    const { count } = await supabaseAdmin
      .from("whatsapp_template_status")
      .select("name", { count: "exact", head: true });

    if (!count) {
      console.warn(
        `[Gate] template statuses have never synced — allowing ${name} and ` +
          `letting Meta decide. Schedule /api/cron/whatsapp-health.`
      );
      return { approved: true, reason: "" };
    }

    return {
      approved: false,
      reason: `${name} has no approved Malayalam version on record`,
    };
  }
  if (data.status !== "APPROVED") {
    return {
      approved: false,
      reason: `${name} is ${data.status}${
        data.rejected_reason && data.rejected_reason !== "NONE"
          ? ` (${data.rejected_reason})`
          : ""
      }`,
    };
  }
  return { approved: true, reason: "" };
}

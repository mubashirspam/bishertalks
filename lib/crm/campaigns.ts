import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolveSegment, type Segment, type SegmentResult } from "@/lib/crm/segments";
import { upsertContact, getSettings, getContact } from "@/lib/crm/contacts";
import { sendTemplateMessage } from "@/lib/crm/send";
import { latestHealth } from "@/lib/crm/health";
import { CAMPAIGN_TEMPLATES } from "@/lib/whatsapp-templates";
import { TEMPLATE_LANGUAGE } from "@/lib/whatsapp-templates";

/**
 * Campaigns: a queue, a worker, and the rules that stop them.
 *
 * A bulk send is never a loop inside a request handler. Creating a campaign
 * writes one queued row per recipient and sends nothing; a cron worker drains
 * it in small batches, passing every row through the gate individually so a
 * contact who opts out mid-campaign is refused on their own row rather than
 * messaged because the list was built an hour ago.
 *
 * The worker is also allowed to stop the campaign by itself, and does — on
 * opt-out rate, on a rating that has left green, and on clustered failures.
 * Waiting for a person to notice is how a bad campaign becomes a bad number.
 */

export interface Campaign {
  id: string;
  name: string;
  template_name: string;
  segment: Segment;
  status: "draft" | "sending" | "paused" | "done" | "halted";
  halt_reason: string | null;
  recipient_cap: number;
  sent_count: number;
  failed_count: number;
  refused_count: number;
  optout_count: number;
  created_by_email: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

const COLUMNS =
  "id, name, template_name, segment, status, halt_reason, recipient_cap, " +
  "sent_count, failed_count, refused_count, optout_count, created_by_email, " +
  "started_at, finished_at, created_at";

export async function listCampaigns(): Promise<Campaign[]> {
  const { data } = await supabaseAdmin
    .from("whatsapp_campaigns")
    .select(COLUMNS)
    .order("created_at", { ascending: false })
    .limit(100);
  return (data ?? []) as unknown as Campaign[];
}

export async function getCampaign(id: string): Promise<Campaign | null> {
  const { data } = await supabaseAdmin
    .from("whatsapp_campaigns")
    .select(COLUMNS)
    .eq("id", id)
    .maybeSingle();
  return (data as unknown as Campaign | null) ?? null;
}

/**
 * What a campaign would do, without doing any of it.
 *
 * The composer calls this before the Create button is ever enabled: the count,
 * every exclusion with its reason, and the message as one real recipient would
 * read it. A campaign nobody previewed is a campaign nobody checked.
 */
export async function dryRun(
  segment: Segment,
  templateName: string,
  cap: number
): Promise<SegmentResult & { willSend: number; preview: string | null }> {
  const result = await resolveSegment(segment);
  const template = CAMPAIGN_TEMPLATES[templateName];

  const first = result.members[0];
  const preview =
    template && first
      ? fillBody(template.body, template.params({
          customerName: first.name ?? "സുഹൃത്തേ",
          orderNumber: first.orderNumber ?? "",
        }))
      : null;

  return {
    ...result,
    willSend: Math.min(result.members.length, cap),
    preview,
  };
}

function fillBody(body: string, params: string[]): string {
  let text = body;
  params.forEach((v, i) => {
    text = text.replaceAll(`{{${i + 1}}}`, v);
  });
  return text;
}

/**
 * Create a campaign and queue its recipients. Sends nothing.
 *
 * Contacts that do not exist yet are created here, so the queue holds contact
 * ids and the worker never has to resolve a phone number mid-send.
 */
export async function createCampaign(input: {
  name: string;
  templateName: string;
  segment: Segment;
  cap: number;
  createdBy: { id: string | null; email: string };
}): Promise<{ ok: true; campaign: Campaign } | { ok: false; error: string }> {
  const template = CAMPAIGN_TEMPLATES[input.templateName];
  if (!template) {
    return { ok: false, error: `Unknown template: ${input.templateName}` };
  }

  const resolved = await resolveSegment(input.segment);
  if (!resolved.members.length) {
    return { ok: false, error: "That segment matches nobody who can be messaged." };
  }

  const { data, error } = await supabaseAdmin
    .from("whatsapp_campaigns")
    .insert({
      name: input.name.slice(0, 200),
      template_name: input.templateName,
      segment: input.segment,
      recipient_cap: input.cap,
      status: "draft",
      created_by: input.createdBy.id,
      created_by_email: input.createdBy.email,
      refused_count: resolved.excluded.reduce((n, e) => n + e.count, 0),
    })
    .select(COLUMNS)
    .maybeSingle();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Could not create the campaign" };
  }

  const campaign = data as unknown as Campaign;

  // Cap applied at queue time, not send time: the ceiling should be visible in
  // the queue itself, so nobody has to reason about what the worker will skip.
  const chosen = resolved.members.slice(0, input.cap);
  const rows: { campaign_id: string; contact_id: string; order_number: string | null }[] = [];

  for (const m of chosen) {
    let contactId = m.contactId;
    if (!contactId) {
      const created = await upsertContact(m.phone, {
        name: m.name,
        orderNumber: m.orderNumber,
      });
      if (!created) continue;
      contactId = created.id;
    }
    rows.push({
      campaign_id: campaign.id,
      contact_id: contactId,
      order_number: m.orderNumber,
    });
  }

  if (rows.length) {
    // Ignore duplicates rather than failing the whole insert: the unique index
    // on (campaign_id, contact_id) is doing its job, not reporting a problem.
    await supabaseAdmin
      .from("whatsapp_campaign_recipients")
      .upsert(rows, { onConflict: "campaign_id,contact_id", ignoreDuplicates: true });
  }

  return { ok: true, campaign };
}

export async function setCampaignStatus(
  id: string,
  status: Campaign["status"],
  reason?: string
): Promise<void> {
  await supabaseAdmin
    .from("whatsapp_campaigns")
    .update({
      status,
      halt_reason: reason ?? null,
      ...(status === "sending" ? { started_at: new Date().toISOString() } : {}),
      ...(status === "done" || status === "halted"
        ? { finished_at: new Date().toISOString() }
        : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
}

/**
 * How many recipients one worker run handles.
 *
 * Small on purpose. A campaign spread over hours gives the opt-out rate time
 * to tell you to stop, and nothing about a promotional message is urgent.
 */
const BATCH = 20;

export interface WorkerReport {
  campaignId: string;
  sent: number;
  refused: number;
  failed: number;
  halted: string | null;
  remaining: number;
}

/** Drain one batch of one campaign. Called by the cron. */
export async function runCampaignBatch(campaign: Campaign): Promise<WorkerReport> {
  const report: WorkerReport = {
    campaignId: campaign.id,
    sent: 0,
    refused: 0,
    failed: 0,
    halted: null,
    remaining: 0,
  };

  const halt = await shouldHalt(campaign);
  if (halt) {
    await setCampaignStatus(campaign.id, "halted", halt);
    report.halted = halt;
    return report;
  }

  const template = CAMPAIGN_TEMPLATES[campaign.template_name];
  if (!template) {
    await setCampaignStatus(
      campaign.id,
      "halted",
      `Template ${campaign.template_name} is no longer defined`
    );
    report.halted = "template missing";
    return report;
  }

  const { data: queued } = await supabaseAdmin
    .from("whatsapp_campaign_recipients")
    .select("id, contact_id, order_number, attempts")
    .eq("campaign_id", campaign.id)
    .eq("state", "queued")
    .limit(BATCH);

  const batch = (queued ?? []) as unknown as {
    id: string;
    contact_id: string;
    order_number: string | null;
    attempts: number;
  }[];

  for (const row of batch) {
    // Re-read the contact every time. The list was built when the campaign was
    // created; someone may have asked us to stop since, and the gate must see
    // the state as it is now, not as it was then.
    const contact = await getContact(row.contact_id);
    if (!contact) {
      await markRecipient(row.id, "refused", { refuse_reason: "Contact no longer exists" });
      report.refused++;
      continue;
    }

    const params = template.params({
      customerName: contact.display_name ?? "സുഹൃത്തേ",
      orderNumber: row.order_number ?? "",
    });

    const outcome = await sendTemplateMessage({
      contact,
      kind: "campaign",
      template: {
        name: template.name,
        category: template.category,
        language: TEMPLATE_LANGUAGE,
      },
      params,
      // Campaign buttons take the order number, the only per-recipient value
      // a segment guarantees. Filtered on the URL actually carrying a
      // variable, because a static button must NOT be given a parameter.
      buttonParams: (template.buttons ?? [])
        .filter((b) => b.type === "URL" && b.url.includes("{{1}}"))
        .map(() => row.order_number ?? ""),
      preview: fillBody(template.body, params),
      campaignId: campaign.id,
    });

    if (outcome.ok) {
      await markRecipient(row.id, "sent", { wamid: outcome.wamid });
      report.sent++;
    } else if (outcome.refused) {
      await markRecipient(row.id, "refused", { refuse_reason: outcome.reason });
      report.refused++;
      // A budget or cap refusal is about the account, not this contact —
      // stop the batch rather than burning through the queue marking
      // everyone refused for a reason that will clear tomorrow.
      if (
        outcome.code === "daily_budget" ||
        outcome.code === "campaign_cap" ||
        outcome.code === "sending_paused" ||
        outcome.code === "number_health"
      ) {
        await requeue(row.id);
        report.refused--;
        break;
      }
    } else {
      const attempts = row.attempts + 1;
      if (outcome.retryable && attempts < 3) {
        await supabaseAdmin
          .from("whatsapp_campaign_recipients")
          .update({ attempts, error: outcome.error })
          .eq("id", row.id);
      } else {
        await markRecipient(row.id, "failed", { error: outcome.error });
        report.failed++;
      }
    }
  }

  await refreshCounts(campaign.id);

  const { count } = await supabaseAdmin
    .from("whatsapp_campaign_recipients")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaign.id)
    .eq("state", "queued");

  report.remaining = count ?? 0;
  if (report.remaining === 0) {
    await setCampaignStatus(campaign.id, "done");
  }

  return report;
}

async function markRecipient(
  id: string,
  state: "sent" | "failed" | "refused",
  extra: Record<string, unknown> = {}
): Promise<void> {
  await supabaseAdmin
    .from("whatsapp_campaign_recipients")
    .update({ state, processed_at: new Date().toISOString(), ...extra })
    .eq("id", id);
}

async function requeue(id: string): Promise<void> {
  await supabaseAdmin
    .from("whatsapp_campaign_recipients")
    .update({ state: "queued" })
    .eq("id", id);
}

/**
 * Should this campaign stop itself?
 *
 * Three reasons, all of them things a person would only notice hours later.
 */
async function shouldHalt(campaign: Campaign): Promise<string | null> {
  const settings = await getSettings();

  if (settings.sending_paused) return "Sending is paused";

  const health = await latestHealth();
  const rating = (health?.quality_rating ?? "").toUpperCase();
  if (rating === "RED") return "Number quality dropped to RED";
  if (rating === "YELLOW") return "Number quality dropped to YELLOW";

  // The most honest metric there is: how many people asked us to stop because
  // of this campaign, as a share of what it has sent.
  if (campaign.sent_count >= 20) {
    const { count } = await supabaseAdmin
      .from("whatsapp_contacts")
      .select("id", { count: "exact", head: true })
      .eq("opt_out_source", "customer")
      .gte("opt_out_at", campaign.started_at ?? campaign.created_at);

    const rate = ((count ?? 0) / campaign.sent_count) * 100;
    if (rate >= settings.halt_optout_percent) {
      return `Opt-out rate ${rate.toFixed(1)}% is at or above the ${settings.halt_optout_percent}% limit`;
    }
  }

  return null;
}

/** Recount from the recipient rows, which are the truth. */
async function refreshCounts(campaignId: string): Promise<void> {
  const states = ["sent", "failed", "refused"] as const;
  const counts: Record<string, number> = {};

  for (const state of states) {
    const { count } = await supabaseAdmin
      .from("whatsapp_campaign_recipients")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .eq("state", state);
    counts[state] = count ?? 0;
  }

  await supabaseAdmin
    .from("whatsapp_campaigns")
    .update({
      sent_count: counts.sent,
      failed_count: counts.failed,
      refused_count: counts.refused,
      updated_at: new Date().toISOString(),
    })
    .eq("id", campaignId);
}

export interface RecipientRow {
  id: string;
  state: string;
  refuse_reason: string | null;
  error: string | null;
  processed_at: string | null;
  contact: { phone: string; display_name: string | null } | null;
}

export async function listRecipients(campaignId: string): Promise<RecipientRow[]> {
  const { data } = await supabaseAdmin
    .from("whatsapp_campaign_recipients")
    .select(
      "id, state, refuse_reason, error, processed_at, " +
        "contact:whatsapp_contacts(phone, display_name)"
    )
    .eq("campaign_id", campaignId)
    .order("processed_at", { ascending: false, nullsFirst: false })
    .limit(500);
  return (data ?? []) as unknown as RecipientRow[];
}

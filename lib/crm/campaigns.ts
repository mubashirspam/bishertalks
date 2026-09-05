import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolveSegment, type Segment, type SegmentResult } from "@/lib/crm/segments";
import { upsertContact, getSettings, getContacts } from "@/lib/crm/contacts";
import { sendTemplateMessage } from "@/lib/crm/send";
import { latestHealth } from "@/lib/crm/health";
import { CAMPAIGN_TEMPLATES, FLOW_TEMPLATES } from "@/lib/whatsapp-templates";
import { TEMPLATE_LANGUAGE } from "@/lib/whatsapp-templates";
import type { SegmentMember } from "@/lib/crm/segments";

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

/**
 * Templates a campaign may send.
 *
 * Both registries, because the split between them is about where a template
 * was written, not about what it can be used for. `neuro_interest_intro` is a
 * MARKETING template whose entire purpose is to open a conversation with
 * somebody who has not bought — which is a campaign — and looking only at
 * CAMPAIGN_TEMPLATES made it unusable for one.
 */
export function campaignTemplate(name: string) {
  return CAMPAIGN_TEMPLATES[name] ?? FLOW_TEMPLATES[name] ?? null;
}

/** Every template a campaign could be built on, for the composer. */
export function campaignTemplateNames(): string[] {
  return [...Object.keys(CAMPAIGN_TEMPLATES), ...Object.keys(FLOW_TEMPLATES)];
}

/**
 * Who has already had this exact template, ever.
 *
 * The duplicate rule that matters and did not exist. The gate stops a contact
 * getting campaign messages too *often* — a frequency cap — but nothing stopped
 * the same wording reaching the same person twice from two campaigns a month
 * apart, which is the version a customer actually notices and complains about.
 *
 * Applied when the queue is built rather than at send time, so the recipient
 * count on screen is the real one, and so a legitimate repeat scheduled by the
 * automation worker is untouched.
 */
async function alreadySent(
  contactIds: string[],
  templateName: string
): Promise<Set<string>> {
  const seen = new Set<string>();
  const ids = contactIds.filter(Boolean);
  if (!ids.length) return seen;

  const CHUNK = 300;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await supabaseAdmin
      .from("whatsapp_messages")
      .select("contact_id")
      .eq("direction", "out")
      .eq("template_name", templateName)
      .eq("status", "sent")
      .in("contact_id", ids.slice(i, i + CHUNK));

    if (error) {
      // Fail closed on a read error would mean messaging everybody twice.
      // Fail *open* here instead — treat everyone as already-sent — because a
      // campaign that sends nothing is recoverable and one that double-sends
      // to 400 people is not.
      console.error("[CRM] duplicate check failed:", error.message);
      for (const id of ids) seen.add(id);
      return seen;
    }
    for (const row of (data ?? []) as { contact_id: string }[]) seen.add(row.contact_id);
  }
  return seen;
}

/**
 * The marketing-consent refusal, predicted before the campaign runs.
 *
 * The gate refuses a MARKETING template to anyone without
 * `marketing_opt_in_at`, but it does that at send time — so a campaign could
 * be created showing 400 recipients, started, and refuse all 400 one by one.
 * The dry run has to say so up front, because the whole point of a dry run is
 * that the number on screen is the number that will be messaged.
 *
 * A missing contact row is NOT a missing consent. `createCampaign` calls
 * `upsertContact` with the member's order number as it queues, and that records
 * consent on the shop's standing basis — the number was typed into checkout for
 * that order. Counting those as refusals was the more damaging error of the
 * two: it reported 579 of 781 unreachable on a segment the campaign can in fact
 * message in full, and a preview that under-counts its own audience is a
 * campaign nobody starts.
 *
 * A member with no row AND no order number is still counted. Nothing will
 * consent them, and the gate will refuse them one at a time.
 */
async function withoutMarketingConsent(
  members: { phone: string; orderNumber: string | null }[]
): Promise<number> {
  if (!members.length) return 0;
  let missing = 0;
  const CHUNK = 300;

  for (let i = 0; i < members.length; i += CHUNK) {
    const slice = members.slice(i, i + CHUNK);
    const { data } = await supabaseAdmin
      .from("whatsapp_contacts")
      .select("phone, marketing_opt_in_at")
      .in(
        "phone",
        slice.map((m) => m.phone)
      );

    const rows = (data ?? []) as { phone: string; marketing_opt_in_at: string | null }[];
    const optedIn = new Set(rows.filter((c) => c.marketing_opt_in_at).map((c) => c.phone));
    const hasRow = new Set(rows.map((c) => c.phone));

    missing += slice.filter(
      (m) => !optedIn.has(m.phone) && (hasRow.has(m.phone) || !m.orderNumber)
    ).length;
  }
  return missing;
}

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
  const template = campaignTemplate(templateName);

  const excluded = [...result.excluded];
  let members = result.members;

  if (template) {
    // Already had this exact wording. Counted here so the number on screen is
    // the number that gets messaged, not an optimistic ceiling.
    const dupes = await alreadySent(
      members.map((m) => m.contactId),
      template.name
    );
    const before = members.length;
    members = members.filter((m) => !m.contactId || !dupes.has(m.contactId));
    if (before > members.length) {
      excluded.push({
        reason: "Already had this template",
        count: before - members.length,
      });
    }

    // The gate's category check, predicted. Without this a MARKETING campaign
    // shows 400 recipients, starts, and refuses all 400 one at a time — the
    // dry run's whole job is to make that visible before it happens.
    if (template.category === "MARKETING") {
      const missing = await withoutMarketingConsent(
        members.map((m) => ({ phone: m.phone, orderNumber: m.orderNumber }))
      );
      if (missing > 0) {
        excluded.push({
          reason: "Would be refused — no marketing opt-in",
          count: missing,
        });
      }
      // Not filtered out of `members`: consent can arrive between now and the
      // send, and a campaign queued today may legitimately run next week.
      // Reported, so the decision is informed rather than made for somebody.
    }
  }

  const first = members[0];
  const preview =
    template && first
      ? fillBody(template.body, template.params({
          customerName: first.name ?? "സുഹൃത്തേ",
          orderNumber: first.orderNumber ?? "",
        }))
      : null;

  return {
    ...result,
    excluded,
    members,
    willSend: Math.min(members.length, cap),
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
  const template = campaignTemplate(input.templateName);
  if (!template) {
    return { ok: false, error: `Unknown template: ${input.templateName}` };
  }

  const resolved = await resolveSegment(input.segment);
  if (!resolved.members.length) {
    return { ok: false, error: "That segment matches nobody who can be messaged." };
  }

  // Nobody gets the same wording twice, however many campaigns are built on it.
  const dupes = await alreadySent(
    resolved.members.map((m) => m.contactId),
    template.name
  );
  const members: SegmentMember[] = resolved.members.filter(
    (m) => !m.contactId || !dupes.has(m.contactId)
  );

  if (!members.length) {
    return {
      ok: false,
      error: "Everyone in that segment has already had this template.",
    };
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
  const chosen = members.slice(0, input.cap);
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

/**
 * Consecutive failures that stop a campaign dead.
 *
 * The opening messages of a campaign are a test of everything the rest depends
 * on: the token, the template, the category, the consent rule. If five in a
 * row do not land, the sixth will not either — and each attempt is a Graph
 * call that Meta counts and bills whether or not a customer ever sees it.
 *
 * Five rather than one, because a single bad number proves nothing. Five in a
 * row is never bad luck.
 *
 * Account-level refusals — budget, cap, paused, health — do not count toward
 * this. Those are handled above by requeueing and stopping the batch: they
 * clear on their own and the queue should survive them.
 */
const HALT_AFTER_CONSECUTIVE = 5;

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

  // A campaign that has already spent its opening on failures must not be
  // resumed into the same wall. This catches the case the per-run counter
  // cannot: five failures spread over five runs, one each, looking fine
  // individually and identical in aggregate.
  if (campaign.sent_count === 0 && campaign.failed_count + campaign.refused_count >= HALT_AFTER_CONSECUTIVE) {
    const why =
      `Nothing has sent — ${campaign.failed_count} failed and ` +
      `${campaign.refused_count} refused before the first success`;
    await setCampaignStatus(campaign.id, "halted", why);
    return { ...report, halted: why };
  }

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

  // Every contact in the batch, in one read rather than one per recipient.
  // The list was built when the campaign was created and someone may have
  // asked us to stop since — a single read taken now answers that for all
  // twenty exactly as well as twenty reads would, at a twentieth of the
  // requests.
  const contacts = await getContacts(batch.map((r) => r.contact_id));

  // Consecutive failures, reset by any success. See HALT_AFTER_CONSECUTIVE.
  let consecutiveBad = 0;

  for (const row of batch) {
    const contact = contacts.get(row.contact_id);
    if (!contact) {
      await markRecipient(row.id, "refused", { refuse_reason: "Contact no longer exists" });
      report.refused++;
      continue;
    }

    const params = template.params({
      customerName: contact.display_name ?? "സുഹൃത്തേ",
      orderNumber: row.order_number ?? "",
    });

    // A variable that resolves to nothing is rejected by Meta as a bad
    // parameter, and five of those in a row halt the campaign under an error
    // string that names the API rather than the cause. The order number is the
    // one that can be missing — `orderNumber` falls back to "" above, and a
    // person can reach a funnel stage with no order row behind them — and it
    // started mattering when the UTILITY payment templates began quoting it.
    //
    // Counted as a refusal rather than skipped, so a segment where *everybody*
    // lacks one still trips the halt instead of quietly marking the whole list
    // refused. The reason says which variable was empty.
    const blank = params.findIndex((p) => !p.trim());
    if (blank !== -1) {
      await markRecipient(row.id, "refused", {
        refuse_reason: `Template needs {{${blank + 1}}} and this recipient has no value for it`,
      });
      report.refused++;
      consecutiveBad++;
      if (consecutiveBad >= HALT_AFTER_CONSECUTIVE) {
        const why =
          `${consecutiveBad} in a row refused — last reason: ` +
          `template needs {{${blank + 1}}} and these recipients have no value for it`;
        await setCampaignStatus(campaign.id, "halted", why);
        report.halted = why;
        break;
      }
      continue;
    }

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
      consecutiveBad = 0;
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

      // A per-contact refusal that repeats is a campaign-level problem wearing
      // a per-contact disguise — "no marketing opt-in" is true of everybody or
      // nobody.
      consecutiveBad++;
      if (consecutiveBad >= HALT_AFTER_CONSECUTIVE) {
        const why =
          `${consecutiveBad} in a row refused — last reason: ${outcome.reason}`;
        await setCampaignStatus(campaign.id, "halted", why);
        report.halted = why;
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

        // Same rule for hard failures. An expired token or a template Meta has
        // stopped carrying fails identically for every recipient, and the only
        // thing continuing buys is a bill.
        consecutiveBad++;
        if (consecutiveBad >= HALT_AFTER_CONSECUTIVE) {
          const why = `${consecutiveBad} in a row failed — last error: ${outcome.error}`;
          await setCampaignStatus(campaign.id, "halted", why);
          report.halted = why;
          break;
        }
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

import {
  TEMPLATES,
  DRAFT_TEMPLATES,
  CAMPAIGN_TEMPLATES,
  FLOW_TEMPLATES,
  type TemplateDef,
} from "@/lib/whatsapp-templates";
import type { MetaStatus, MetaStatusReport } from "@/lib/whatsapp-meta";

/**
 * Every WhatsApp template this shop has, in one list.
 *
 * They were spread across four registries in the code and one account at Meta,
 * with no single place that answered "what have we got, and which of it can
 * actually send". The templates screen showed two of the four registries, so
 * seven templates existed, were submitted, and appeared nowhere in the admin.
 *
 * Two directions of missing, and both matter:
 *
 *   in code, not at Meta   never submitted. It will fail at send time, and the
 *                          only symptom is a customer who hears nothing.
 *   at Meta, not in code    approved and paid for, sending nothing. Usually a
 *                          retired wording; occasionally something somebody
 *                          submitted by hand and forgot.
 */

/** What a template is for, which decides how much its status matters. */
export type TemplatePurpose = "automatic" | "flow" | "campaign" | "draft" | "orphan";

export const PURPOSE_LABELS: Record<TemplatePurpose, string> = {
  automatic: "Automatic",
  flow: "Conversation flow",
  campaign: "Campaign",
  draft: "Draft",
  orphan: "At Meta only",
};

export const PURPOSE_HINTS: Record<TemplatePurpose, string> = {
  automatic: "Sent by the app on an order event",
  flow: "Starts or continues a button conversation",
  campaign: "Chosen by hand when running a campaign",
  draft: "Written, deliberately not submitted",
  orphan: "Meta holds it; no code sends it",
};

export interface RegistryEntry {
  name: string;
  purpose: TemplatePurpose;
  /** The order event, flow key, or draft key this is filed under. */
  key: string;
  category: string;
  status: MetaStatus;
  language?: string;
  rejectedReason?: string;
  /** Absent for an orphan — there is no definition to show. */
  def?: TemplateDef;
}

/**
 * Gather everything, code first, then whatever Meta holds that code does not.
 *
 * Order is deliberate: automatic templates first because a broken one costs a
 * customer their receipt, then flows, then campaigns, then drafts, then the
 * orphans nobody is sending.
 */
export function gatherTemplates(meta: MetaStatusReport): RegistryEntry[] {
  const entries: RegistryEntry[] = [];
  const seen = new Set<string>();

  const add = (key: string, def: TemplateDef, purpose: TemplatePurpose) => {
    const live = meta.byName.get(def.name);
    seen.add(def.name);
    entries.push({
      name: def.name,
      purpose,
      key,
      category: def.category,
      // No live row means Meta has never been shown it. Distinct from UNKNOWN,
      // which is "we could not ask" — see the `error` branch on the caller.
      status: live?.status ?? "NOT_SUBMITTED",
      language: live?.language,
      rejectedReason: live?.rejectedReason,
      def,
    });
  };

  for (const [key, def] of Object.entries(TEMPLATES)) add(key, def, "automatic");

  // Campaign and flow templates share TemplateDef's shape but type their
  // params against a campaign context, so they are widened here rather than
  // in the registries themselves.
  for (const [key, def] of Object.entries(FLOW_TEMPLATES)) {
    add(key, { ...def, params: () => def.example }, "flow");
  }
  for (const [key, def] of Object.entries(CAMPAIGN_TEMPLATES)) {
    add(key, { ...def, params: () => def.example }, "campaign");
  }
  for (const [key, def] of Object.entries(DRAFT_TEMPLATES)) add(key, def, "draft");

  for (const [name, live] of meta.byName) {
    if (seen.has(name)) continue;
    entries.push({
      name,
      purpose: "orphan",
      key: "—",
      category: live.category ?? "—",
      status: live.status,
      language: live.language,
      rejectedReason: live.rejectedReason,
    });
  }

  return entries;
}

/** The filter chips, in the order somebody would work down them. */
export const TEMPLATE_FILTERS = [
  "approved",
  "pending",
  "rejected",
  "not_submitted",
  "other",
] as const;

export type TemplateFilter = (typeof TEMPLATE_FILTERS)[number];

export const FILTER_LABELS: Record<TemplateFilter, string> = {
  approved: "Approved",
  pending: "In review",
  rejected: "Rejected",
  not_submitted: "Not submitted",
  other: "Paused or disabled",
};

export const FILTER_HINTS: Record<TemplateFilter, string> = {
  approved: "Meta will deliver these",
  pending: "Submitted, waiting on review. Cannot send yet",
  rejected: "Meta refused it. Nothing sends until it is fixed and resubmitted",
  not_submitted: "Written in the code and never shown to Meta",
  other: "Approved once, and stopped since — usually for quality",
};

export function isTemplateFilter(v: string | undefined | null): v is TemplateFilter {
  return !!v && (TEMPLATE_FILTERS as readonly string[]).includes(v);
}

/** Which chip a status belongs under. */
export function filterOf(status: MetaStatus): TemplateFilter {
  switch (status) {
    case "APPROVED":
      return "approved";
    case "PENDING":
      return "pending";
    case "REJECTED":
      return "rejected";
    case "NOT_SUBMITTED":
      return "not_submitted";
    default:
      // PAUSED, DISABLED and UNKNOWN. Rare, and lumping them together beats a
      // chip that reads "0" every day for a year.
      return "other";
  }
}

export function countByFilter(
  entries: RegistryEntry[]
): Record<TemplateFilter, number> {
  const out = Object.fromEntries(TEMPLATE_FILTERS.map((f) => [f, 0])) as Record<
    TemplateFilter,
    number
  >;
  for (const e of entries) out[filterOf(e.status)]++;
  return out;
}

/**
 * Templates that would fail if something tried to send them right now.
 *
 * Drafts and orphans are excluded on purpose: nothing sends a draft, and an
 * orphan has no code behind it to break. What is left is the real answer to
 * "how much of what we send is broken".
 */
export function sendableProblems(entries: RegistryEntry[]): RegistryEntry[] {
  return entries.filter(
    (e) =>
      e.purpose !== "draft" &&
      e.purpose !== "orphan" &&
      e.status !== "APPROVED"
  );
}

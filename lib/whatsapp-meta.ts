/**
 * What Meta currently holds, for a screen rather than a terminal.
 *
 * scripts/whatsapp-templates.ts answers the same question with `list`, but a
 * script only helps whoever has the repo checked out. Support staff asking
 * "did the customer get the confirmation, or is that template still in
 * review?" need the answer in the admin, so this is the same Graph call
 * shaped for a page.
 *
 * Call it from server components only. WHATSAPP_TOKEN is a permanent
 * system-user token with send and management rights over the whole WhatsApp
 * Business Account; it has no NEXT_PUBLIC_ prefix, so a client bundle would
 * not receive its value — it would just read undefined and report the
 * credentials as missing, which is a confusing way to find out.
 */

/** Meta's own vocabulary, plus the two states that mean "we never asked". */
export type MetaStatus =
  | "APPROVED"
  | "PENDING"
  | "REJECTED"
  | "PAUSED"
  | "DISABLED"
  | "NOT_SUBMITTED"
  | "UNKNOWN";

export interface MetaTemplateStatus {
  name: string;
  language: string;
  status: MetaStatus;
  category?: string;
  /** Only ever set alongside REJECTED. */
  rejectedReason?: string;
}

export interface MetaStatusReport {
  /** Keyed by template name. Empty when `error` is set. */
  byName: Map<string, MetaTemplateStatus>;
  /**
   * Why we have nothing, in words a non-developer can act on. Null on success.
   * Never an exception: this powers a page that must still render its copy
   * when Meta is unreachable or the token has expired again.
   */
  error: string | null;
}

interface GraphTemplate {
  name: string;
  language: string;
  status: string;
  category?: string;
  rejected_reason?: string;
}

const KNOWN: MetaStatus[] = [
  "APPROVED", "PENDING", "REJECTED", "PAUSED", "DISABLED",
];

/**
 * Ask Meta for every template on the account.
 *
 * Cached for a minute. The statuses move in hours, not seconds, and without
 * it every render of the admin screen spends a round trip to Graph.
 */
export async function fetchMetaTemplateStatus(): Promise<MetaStatusReport> {
  const token = process.env.WHATSAPP_TOKEN;
  const wabaId = process.env.WHATSAPP_WABA_ID;
  const version = process.env.WHATSAPP_API_VERSION || "v21.0";

  if (!token || !wabaId) {
    return {
      byName: new Map(),
      error:
        "WHATSAPP_TOKEN and WHATSAPP_WABA_ID are not set on this environment, " +
        "so the live status could not be read. The wording below is still what " +
        "the code would send.",
    };
  }

  try {
    const res = await fetch(
      `https://graph.facebook.com/${version}/${wabaId}/message_templates` +
        `?fields=name,language,status,category,rejected_reason&limit=200`,
      {
        headers: { Authorization: `Bearer ${token}` },
        next: { revalidate: 60 },
      }
    );

    const json = (await res.json()) as {
      data?: GraphTemplate[];
      error?: { message?: string; code?: number };
    };

    if (json.error) {
      // Code 190 is the one that has already happened once: someone used the
      // 24-hour token from the API Setup page. Say so rather than printing
      // Meta's phrasing, which does not mention where the good token lives.
      const detail =
        json.error.code === 190
          ? "the access token has expired or been revoked — see docs/whatsapp-meta-setup.md"
          : json.error.message || "Meta refused the request";
      return { byName: new Map(), error: `Could not read live status: ${detail}.` };
    }

    const byName = new Map<string, MetaTemplateStatus>();
    for (const t of json.data ?? []) {
      const status = (KNOWN as string[]).includes(t.status)
        ? (t.status as MetaStatus)
        : "UNKNOWN";
      byName.set(t.name, {
        name: t.name,
        language: t.language,
        status,
        category: t.category,
        rejectedReason:
          t.rejected_reason && t.rejected_reason !== "NONE"
            ? t.rejected_reason
            : undefined,
      });
    }
    return { byName, error: null };
  } catch {
    return {
      byName: new Map(),
      error:
        "Could not reach Meta. The wording below is still what the code would " +
        "send; only the approval status is missing.",
    };
  }
}

export const STATUS_BADGE: Record<MetaStatus, string> = {
  APPROVED: "bg-green-50 text-green-700 border-green-200",
  PENDING: "bg-amber-50 text-amber-700 border-amber-200",
  REJECTED: "bg-red-50 text-red-700 border-red-200",
  PAUSED: "bg-orange-50 text-orange-700 border-orange-300",
  DISABLED: "bg-red-50 text-red-700 border-red-200",
  NOT_SUBMITTED: "bg-neutral-100 text-neutral-600 border-neutral-200",
  UNKNOWN: "bg-neutral-100 text-neutral-600 border-neutral-200",
};

export const STATUS_LABEL: Record<MetaStatus, string> = {
  APPROVED: "Approved — sending",
  PENDING: "In review — cannot send",
  REJECTED: "Rejected — cannot send",
  PAUSED: "Paused by Meta",
  DISABLED: "Disabled by Meta",
  NOT_SUBMITTED: "Not submitted",
  UNKNOWN: "Unknown",
};

/** Meta's rejection codes, in plain English. */
export const REJECTION_REASON: Record<string, string> = {
  INCORRECT_CATEGORY:
    "Meta read it as marketing rather than an update about an order the " +
    "customer already placed.",
  INVALID_FORMAT: "The body breaks one of Meta's formatting rules.",
  ABUSIVE_CONTENT: "Meta flagged the wording itself.",
  SCAM: "Meta read it as a scam — usually a bare link with little context.",
  TAG_CONTENT_MISMATCH: "The wording does not match the category it was sent under.",
};

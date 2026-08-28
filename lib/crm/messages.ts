import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * The conversation store.
 *
 * Both directions in one table, so a thread is one ordered read. Keyed on
 * Meta's `wamid` where there is one, which is what makes the webhook safe to
 * replay: Meta retries a delivery it thinks failed, and a retry must not
 * produce a second copy of the customer's message.
 */

export interface Message {
  id: string;
  contact_id: string;
  direction: "in" | "out";
  wamid: string | null;
  kind: string;
  body: string | null;
  template_name: string | null;
  status: string | null;
  error: string | null;
  error_code: number | null;
  sent_by: string | null;
  campaign_id: string | null;
  created_at: string;
}

const COLUMNS =
  "id, contact_id, direction, wamid, kind, body, template_name, status, " +
  "error, error_code, sent_by, campaign_id, created_at";

/**
 * Store an inbound message.
 *
 * Returns false when the row already existed — the caller uses that to avoid
 * bumping the unread count twice on a webhook retry.
 */
export async function recordInbound(msg: {
  contactId: string;
  wamid: string;
  kind: string;
  body: string | null;
}): Promise<boolean> {
  try {
    const { data, error } = await supabaseAdmin
      .from("whatsapp_messages")
      .insert({
        contact_id: msg.contactId,
        direction: "in",
        wamid: msg.wamid,
        kind: msg.kind,
        body: msg.body,
      })
      .select("id")
      .maybeSingle();

    // 23505 is the unique violation on wamid: Meta sent this one before.
    if (error) {
      if (error.code !== "23505") {
        console.error("[CRM] inbound insert failed:", error.message);
      }
      return false;
    }
    return !!data;
  } catch (e) {
    console.error("[CRM] inbound insert threw:", e);
    return false;
  }
}

/** Store an outbound message we just sent, or tried to. */
export async function recordOutbound(msg: {
  contactId: string;
  wamid?: string | null;
  kind: "text" | "template";
  body: string | null;
  templateName?: string | null;
  status: "sent" | "failed";
  error?: string | null;
  errorCode?: number | null;
  sentBy?: string | null;
  campaignId?: string | null;
}): Promise<string | null> {
  try {
    const { data } = await supabaseAdmin
      .from("whatsapp_messages")
      .insert({
        contact_id: msg.contactId,
        direction: "out",
        wamid: msg.wamid ?? null,
        kind: msg.kind,
        body: msg.body,
        template_name: msg.templateName ?? null,
        status: msg.status,
        error: msg.error ?? null,
        error_code: msg.errorCode ?? null,
        sent_by: msg.sentBy ?? null,
        campaign_id: msg.campaignId ?? null,
      })
      .select("id")
      .maybeSingle();

    if (msg.status === "sent") {
      await supabaseAdmin
        .from("whatsapp_contacts")
        .update({ last_outbound_at: new Date().toISOString() })
        .eq("id", msg.contactId);
    }
    return data?.id ?? null;
  } catch (e) {
    console.error("[CRM] outbound insert failed:", e);
    return null;
  }
}

/**
 * Move an outbound message forward when a receipt arrives.
 *
 * Only ever forward. Meta does not guarantee receipt order, and a `sent`
 * callback arriving after `read` must not walk the row backwards — the same
 * rule lib/db/notifications.ts already applies to notification_log.
 */
const RANK: Record<string, number> = {
  queued: 0, sent: 1, delivered: 2, read: 3, failed: 4,
};

export async function applyReceipt(
  wamid: string,
  status: string,
  failure?: { error: string | null; code: number | null }
): Promise<{ contactId: string; moved: boolean } | null> {
  try {
    const { data } = await supabaseAdmin
      .from("whatsapp_messages")
      .select("id, contact_id, status")
      .eq("wamid", wamid)
      .maybeSingle();

    if (!data) return null;

    const current = RANK[data.status ?? "queued"] ?? 0;
    const next = RANK[status] ?? 0;
    // 'failed' always wins: it is terminal information, not a step.
    if (next <= current && status !== "failed") {
      return { contactId: data.contact_id, moved: false };
    }

    await supabaseAdmin
      .from("whatsapp_messages")
      .update({
        status,
        ...(failure
          ? { error: failure.error?.slice(0, 1000) ?? null, error_code: failure.code }
          : {}),
      })
      .eq("id", data.id);

    return { contactId: data.contact_id, moved: true };
  } catch (e) {
    console.error("[CRM] receipt apply failed:", wamid, e);
    return null;
  }
}

/** One conversation, oldest first — the order a thread reads in. */
export async function listThread(contactId: string, limit = 200): Promise<Message[]> {
  const { data } = await supabaseAdmin
    .from("whatsapp_messages")
    .select(COLUMNS)
    .eq("contact_id", contactId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return ((data ?? []) as unknown as Message[]).reverse();
}

export async function bumpUnread(contactId: string, lastInboundAt: string): Promise<void> {
  try {
    const { data } = await supabaseAdmin
      .from("whatsapp_contacts")
      .select("unread_count")
      .eq("id", contactId)
      .maybeSingle();

    await supabaseAdmin
      .from("whatsapp_contacts")
      .update({
        unread_count: (data?.unread_count ?? 0) + 1,
        last_inbound_at: lastInboundAt,
        updated_at: new Date().toISOString(),
      })
      .eq("id", contactId);
  } catch (e) {
    console.error("[CRM] unread bump failed:", contactId, e);
  }
}

export async function markRead(contactId: string): Promise<void> {
  await supabaseAdmin
    .from("whatsapp_contacts")
    .update({ unread_count: 0 })
    .eq("id", contactId);
}

// ── The message log screen ──────────────────────────────────────────────────

export interface LogFilters {
  direction?: "in" | "out";
  status?: string;
  templateName?: string;
  campaignId?: string;
  contactId?: string;
  limit?: number;
}

export interface LogRow extends Message {
  contact: { phone: string; display_name: string | null } | null;
}

export async function listMessages(f: LogFilters = {}): Promise<LogRow[]> {
  let query = supabaseAdmin
    .from("whatsapp_messages")
    .select(`${COLUMNS}, contact:whatsapp_contacts(phone, display_name)`)
    .order("created_at", { ascending: false })
    .limit(Math.min(f.limit ?? 200, 500));

  if (f.direction) query = query.eq("direction", f.direction);
  if (f.status) query = query.eq("status", f.status);
  if (f.templateName) query = query.eq("template_name", f.templateName);
  if (f.campaignId) query = query.eq("campaign_id", f.campaignId);
  if (f.contactId) query = query.eq("contact_id", f.contactId);

  const { data, error } = await query;
  if (error) {
    console.error("[CRM] listMessages failed:", error.message);
    return [];
  }
  return (data ?? []) as unknown as LogRow[];
}

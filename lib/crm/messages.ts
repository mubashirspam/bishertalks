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
  /** 0054. Absent on a database that has not applied it — see listThread. */
  media_id?: string | null;
  media_mime?: string | null;
  media_filename?: string | null;
}

const COLUMNS =
  "id, contact_id, direction, wamid, kind, body, template_name, status, " +
  "error, error_code, sent_by, campaign_id, created_at";

/** The same, plus what 0054 added. Selected only where a failure is survivable. */
const COLUMNS_WITH_MEDIA = COLUMNS + ", media_id, media_mime, media_filename";

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
  /**
   * The button id the customer tapped, for a `button` message.
   *
   * Stored separately from the body because the body is what they *read* and
   * this is what they *chose* — and only the second one can be routed on.
   */
  buttonPayload?: string | null;
  /**
   * Meta's media id, for a photo, voice note, video or document.
   *
   * Stored rather than resolved now: the URL it exchanges for expires in
   * minutes, so fetching at write time would store something already dead by
   * the time anybody opened the thread.
   */
  mediaId?: string | null;
  mediaMime?: string | null;
  mediaFilename?: string | null;
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
        button_payload: msg.buttonPayload ?? null,
        media_id: msg.mediaId ?? null,
        media_mime: msg.mediaMime ?? null,
        media_filename: msg.mediaFilename ?? null,
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

/** Store an outbound message we just sent, tried to, or have only queued. */
export async function recordOutbound(msg: {
  contactId: string;
  wamid?: string | null;
  kind: "text" | "template" | "interactive" | "image" | "audio" | "video" | "document";
  body: string | null;
  templateName?: string | null;
  /** For an interactive send, the button ids offered — so a reply can be read
   * back against what was actually on screen. */
  buttonPayload?: string | null;
  status: "queued" | "sent" | "failed";
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
        button_payload: msg.buttonPayload ?? null,
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
 * Settle a queued outbound row once the real Graph API call finishes.
 *
 * The optimistic reply path (see lib/crm/send.ts's queueReply) writes the row
 * as 'queued' before Meta has been asked anything, so the person sending it
 * sees their message in the thread immediately. This is what fills in the
 * result once the request that was deferred to the background actually
 * completes.
 */
export async function finalizeOutbound(
  messageId: string,
  contactId: string,
  result:
    | {
        ok: true;
        wamid: string | null;
        /** Set only for a media send — the upload happens after the row exists. */
        media?: { id: string; mime: string; filename: string | null };
      }
    | { ok: false; error: string | null; errorCode: number | null }
): Promise<void> {
  try {
    if (result.ok) {
      await supabaseAdmin
        .from("whatsapp_messages")
        .update({
          status: "sent",
          wamid: result.wamid,
          ...(result.media
            ? {
                media_id: result.media.id,
                media_mime: result.media.mime,
                media_filename: result.media.filename,
              }
            : {}),
        })
        .eq("id", messageId);
      await supabaseAdmin
        .from("whatsapp_contacts")
        .update({ last_outbound_at: new Date().toISOString() })
        .eq("id", contactId);
    } else {
      await supabaseAdmin
        .from("whatsapp_messages")
        .update({
          status: "failed",
          error: result.error?.slice(0, 1000) ?? null,
          error_code: result.errorCode,
        })
        .eq("id", messageId);
    }
  } catch (e) {
    console.error("[CRM] finalizeOutbound failed:", messageId, e);
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

/** Identifies one message for keyset pagination — see listThread. */
export interface ThreadCursor {
  createdAt: string;
  id: string;
}

export interface ThreadPage {
  /** Oldest first — the order a thread reads in. */
  messages: Message[];
  /** True when there are older messages than this page holds. */
  hasMore: boolean;
  /** Pass as `before` to fetch the page older than this one. Null when empty. */
  oldest: ThreadCursor | null;
}

/**
 * One page of a conversation, oldest first within the page.
 *
 * Capped at `limit` (default 50, not the whole history) so opening a chat — or
 * a poll re-fetching it — never pulls a whole year of messages just to show
 * the last few. Scrolling up asks for the next page with `before`, a
 * (created_at, id) pair rather than created_at alone: two messages can land
 * in the same millisecond, and a cursor that only compared timestamps could
 * silently skip or repeat one at the page boundary.
 */
export async function listThread(
  contactId: string,
  opts: { limit?: number; before?: ThreadCursor } = {}
): Promise<ThreadPage> {
  const limit = opts.limit ?? 50;

  const read = (columns: string) => {
    let q = supabaseAdmin
      .from("whatsapp_messages")
      .select(columns)
      .eq("contact_id", contactId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      // One extra row, spent purely to answer "is there more" without a
      // second count query.
      .limit(limit + 1);

    if (opts.before) {
      q = q.or(
        `created_at.lt.${opts.before.createdAt},and(created_at.eq.${opts.before.createdAt},id.lt.${opts.before.id})`
      );
    }
    return q;
  };

  let result = await read(COLUMNS_WITH_MEDIA);

  // Migrations here are applied by hand, and selecting a column that does not
  // exist fails the whole query — so a database still on 0053 would show an
  // empty conversation rather than one without pictures. Falling back costs a
  // second round trip on exactly the deployments that need it.
  if (result.error) {
    console.warn(
      "[CRM] thread read fell back — apply migration 0054 for media:",
      result.error.message
    );
    result = await read(COLUMNS);
  }

  const rows = (result.data ?? []) as unknown as Message[]; // newest first
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const oldestRow = page[page.length - 1] ?? null;

  return {
    messages: page.reverse(),
    hasMore,
    oldest: oldestRow ? { createdAt: oldestRow.created_at, id: oldestRow.id } : null,
  };
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
  /** Inclusive lower bound on created_at, as a UTC ISO string. */
  from?: string;
  /** Exclusive upper bound. */
  to?: string;
}

export interface LogRow extends Message {
  contact: { phone: string; display_name: string | null } | null;
}

export interface LogPage {
  rows: LogRow[];
  /** How many the filters match, before paging. */
  count: number;
}

/**
 * One page of the message log.
 *
 * Paged and time-bounded rather than "the newest 200". Every outbound
 * message, every inbound one and every refusal lands in this table — a
 * campaign of fifty writes fifty rows, and the poller and the flows write
 * more — so an unbounded read is one that gets slower every week and takes
 * the screen with it.
 *
 * The count is asked for in the same round trip. Paging without a total gives
 * you a Next button that cannot say whether there is a next.
 */
export async function listMessages(
  f: LogFilters = {},
  page = 0,
  perPage = 50
): Promise<LogPage> {
  const from = page * perPage;

  let query = supabaseAdmin
    .from("whatsapp_messages")
    .select(`${COLUMNS}, contact:whatsapp_contacts(phone, display_name)`, {
      count: "exact",
    })
    .order("created_at", { ascending: false })
    .range(from, from + perPage - 1);

  if (f.direction) query = query.eq("direction", f.direction);
  if (f.status) query = query.eq("status", f.status);
  if (f.templateName) query = query.eq("template_name", f.templateName);
  if (f.campaignId) query = query.eq("campaign_id", f.campaignId);
  if (f.contactId) query = query.eq("contact_id", f.contactId);
  // The bound that does the most work. Everything else narrows a scan; this
  // one stops the table being scanned to the beginning of time.
  if (f.from) query = query.gte("created_at", f.from);
  if (f.to) query = query.lt("created_at", f.to);

  const { data, error, count } = await query;
  if (error) {
    console.error("[CRM] listMessages failed:", error.message);
    return { rows: [], count: 0 };
  }
  return { rows: (data ?? []) as unknown as LogRow[], count: count ?? 0 };
}

/**
 * The last template we sent this contact, if any.
 *
 * The lookup that makes template quick replies routable. Meta gives us the
 * button's title and nothing else — no id, no template name — so "Need Help"
 * arrives identical from three different flows. The template that went out
 * most recently is what places it.
 *
 * Not perfect, and the imperfection is worth naming: a customer who taps a
 * button on a message from a fortnight ago, after a newer template has been
 * sent, is routed against the newer one. That is rare, it is always a stale
 * tap, and the alternative — guessing from the title alone — is wrong far more
 * often.
 */
export async function lastTemplateSent(contactId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("whatsapp_messages")
    .select("template_name")
    .eq("contact_id", contactId)
    .eq("direction", "out")
    .eq("status", "sent")
    .not("template_name", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data as { template_name?: string } | null)?.template_name ?? null;
}


import { supabaseAdmin } from "@/lib/supabase/admin";
import { toWhatsAppNumber } from "@/lib/whatsapp";

/**
 * Contacts and settings — the two things the send gate reads on every message.
 *
 * `phone` is always the twelve-digit form `toWhatsAppNumber()` produces. Every
 * write goes through `upsertContact`, so there is one normalisation in the
 * codebase and not one per caller; two rows for one person would mean a stop
 * flag that only covers half of them.
 */

export interface Contact {
  id: string;
  phone: string;
  display_name: string | null;
  user_id: string | null;
  last_order_number: string | null;
  opt_out_at: string | null;
  opt_out_reason: string | null;
  opt_out_source: string | null;
  marketing_opt_in_at: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  unread_count: number;
  assigned_to: string | null;
  failed_streak: number;
  notes: string | null;
  // Note: 0053's `tags`, `current_stage` and `source` are deliberately absent
  // from this type and from the SELECT below. See crmFieldsFor() in
  // lib/crm/tags.ts for why they are read separately.
  created_at: string;
}

const COLUMNS =
  "id, phone, display_name, user_id, last_order_number, opt_out_at, " +
  "opt_out_reason, opt_out_source, marketing_opt_in_at, last_inbound_at, " +
  "last_outbound_at, unread_count, assigned_to, failed_streak, notes, created_at";

// 0053's columns are deliberately NOT in that list. Selecting a column that
// does not exist fails the whole query, and this one is read by the webhook on
// every inbound message — so a database still on 0052 would stop receiving
// customer messages to show a tag. Read them through crmFieldsFor() in
// lib/crm/tags.ts, which returns empty rather than throwing.

/**
 * Find or create the contact for a phone number.
 *
 * Returns null for a number that is not a valid Indian mobile — the caller
 * gets a refusal rather than a row, because a contact we cannot message is
 * worse than no contact at all.
 */
export async function upsertContact(
  rawPhone: string | null | undefined,
  seed?: { name?: string | null; orderNumber?: string | null; userId?: string | null }
): Promise<Contact | null> {
  const phone = toWhatsAppNumber(rawPhone);
  if (!phone) return null;

  try {
    const existing = await getContactByPhone(phone);
    if (existing) {
      // Fill in blanks, never overwrite. A name typed by staff should not be
      // replaced by whatever Razorpay sent back on the next order.
      const patch: Record<string, unknown> = {};
      if (seed?.name && !existing.display_name) patch.display_name = seed.name.trim();
      if (seed?.orderNumber) patch.last_order_number = seed.orderNumber;
      if (seed?.userId && !existing.user_id) patch.user_id = seed.userId;

      if (Object.keys(patch).length) {
        patch.updated_at = new Date().toISOString();
        const { data } = await supabaseAdmin
          .from("whatsapp_contacts")
          .update(patch)
          .eq("id", existing.id)
          .select(COLUMNS)
          .maybeSingle();
        return (data as Contact | null) ?? existing;
      }
      return existing;
    }

    const { data, error } = await supabaseAdmin
      .from("whatsapp_contacts")
      .insert({
        phone,
        display_name: seed?.name?.trim() || null,
        last_order_number: seed?.orderNumber ?? null,
        user_id: seed?.userId ?? null,
      })
      .select(COLUMNS)
      .maybeSingle();

    // A concurrent insert loses the race on the unique index rather than
    // creating a second row. Re-read instead of failing.
    if (error) return await getContactByPhone(phone);
    return data as Contact | null;
  } catch (e) {
    console.error("[CRM] upsertContact failed:", phone, e);
    return null;
  }
}

export async function getContactByPhone(phone: string): Promise<Contact | null> {
  const normalised = toWhatsAppNumber(phone);
  if (!normalised) return null;
  const { data } = await supabaseAdmin
    .from("whatsapp_contacts")
    .select(COLUMNS)
    .eq("phone", normalised)
    .maybeSingle();
  return (data as Contact | null) ?? null;
}

export async function getContact(id: string): Promise<Contact | null> {
  const { data } = await supabaseAdmin
    .from("whatsapp_contacts")
    .select(COLUMNS)
    .eq("id", id)
    .maybeSingle();
  return (data as Contact | null) ?? null;
}

export interface InboxFilters {
  /** Free text over name and phone. */
  q?: string;
  unread?: boolean;
  /** Only conversations where a free-text reply is still allowed. */
  windowOpen?: boolean;
  optedOut?: boolean;
  limit?: number;
}

/** The inbox list. Most recently active first. */
export async function listConversations(f: InboxFilters = {}): Promise<Contact[]> {
  let query = supabaseAdmin
    .from("whatsapp_contacts")
    .select(COLUMNS)
    .order("last_inbound_at", { ascending: false, nullsFirst: false })
    .limit(Math.min(f.limit ?? 100, 300));

  if (f.q) {
    const term = f.q.replace(/[%,()]/g, " ").trim();
    if (term) query = query.or(`display_name.ilike.%${term}%,phone.ilike.%${term}%`);
  }
  if (f.unread) query = query.gt("unread_count", 0);
  if (f.optedOut === true) query = query.not("opt_out_at", "is", null);
  if (f.optedOut === false) query = query.is("opt_out_at", null);
  if (f.windowOpen) {
    query = query.gte("last_inbound_at", new Date(Date.now() - WINDOW_MS).toISOString());
  }

  const { data, error } = await query;
  if (error) {
    console.error("[CRM] listConversations failed:", error.message);
    return [];
  }
  return (data ?? []) as unknown as Contact[];
}

// ── The 24-hour window ──────────────────────────────────────────────────────

/**
 * Meta's customer service window.
 *
 * Free text is only permitted within 24 hours of the customer's own last
 * message. Outside it a send fails with 131047, which is already mapped in
 * lib/whatsapp.ts — but the gate refuses first, so the failure is explained in
 * our words rather than Meta's error code.
 */
export const WINDOW_MS = 24 * 60 * 60 * 1000;

export interface WindowState {
  open: boolean;
  /** Milliseconds left, 0 when shut. */
  remainingMs: number;
  closesAt: string | null;
}

export function windowState(lastInboundAt: string | null): WindowState {
  if (!lastInboundAt) return { open: false, remainingMs: 0, closesAt: null };
  const closes = new Date(lastInboundAt).getTime() + WINDOW_MS;
  const remaining = closes - Date.now();
  return {
    open: remaining > 0,
    remainingMs: Math.max(0, remaining),
    closesAt: new Date(closes).toISOString(),
  };
}

/** "6h 12m left" — the countdown the inbox shows on every open conversation. */
export function formatWindow(remainingMs: number): string {
  if (remainingMs <= 0) return "closed";
  const mins = Math.floor(remainingMs / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m left` : `${m}m left`;
}

// ── Settings ────────────────────────────────────────────────────────────────

export interface WhatsAppSettings {
  sending_paused: boolean;
  paused_reason: string | null;
  paused_at: string | null;
  paused_by_email: string | null;
  daily_budget: number;
  campaign_daily_cap: number;
  min_days_between_campaigns: number;
  max_campaigns_per_30_days: number;
  halt_optout_percent: number;
  retain_messages_days: number;
}

/**
 * What the gate falls back to when the settings row cannot be read.
 *
 * Paused. A database that will not answer is not a reason to keep messaging
 * customers — it is the clearest possible reason to stop until someone looks.
 */
const FAILSAFE: WhatsAppSettings = {
  sending_paused: true,
  paused_reason: "Settings unreadable — sending paused by failsafe",
  paused_at: null,
  paused_by_email: null,
  daily_budget: 0,
  campaign_daily_cap: 0,
  min_days_between_campaigns: 7,
  max_campaigns_per_30_days: 3,
  halt_optout_percent: 2,
  retain_messages_days: 365,
};

export async function getSettings(): Promise<WhatsAppSettings> {
  try {
    const { data, error } = await supabaseAdmin
      .from("whatsapp_settings")
      .select("*")
      .eq("id", true)
      .maybeSingle();
    if (error || !data) return FAILSAFE;
    return data as unknown as WhatsAppSettings;
  } catch (e) {
    console.error("[CRM] settings read failed:", e);
    return FAILSAFE;
  }
}

export async function setSendingPaused(
  paused: boolean,
  reason: string | null,
  byEmail: string
): Promise<void> {
  await supabaseAdmin
    .from("whatsapp_settings")
    .update({
      sending_paused: paused,
      paused_reason: paused ? reason : null,
      paused_at: paused ? new Date().toISOString() : null,
      paused_by_email: paused ? byEmail : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", true);
}

/** Today's sends, both automated and CRM, from the SQL function in 0052. */
export async function sentToday(): Promise<{ total: number; campaign: number }> {
  try {
    const { data, error } = await supabaseAdmin.rpc("whatsapp_sent_today");
    if (error || !data?.[0]) return { total: 0, campaign: 0 };
    return {
      total: Number(data[0].total ?? 0),
      campaign: Number(data[0].campaign ?? 0),
    };
  } catch {
    return { total: 0, campaign: 0 };
  }
}

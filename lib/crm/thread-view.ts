import { supabaseAdmin } from "@/lib/supabase/admin";
import { getContact, windowState, formatWindow } from "@/lib/crm/contacts";
import { listThread } from "@/lib/crm/messages";
import { quickReplies, type QuickReply, type ReplyLanguage } from "@/lib/crm/quick-replies";

/**
 * One conversation, in the exact shape the browser renders.
 *
 * Extracted so the two things that need it cannot drift apart: the thread PAGE
 * (/admin/crm/[id], the deep link and the no-JavaScript path) and the thread
 * API (/api/admin/crm/thread/[id], which the inbox calls when you click
 * somebody in the list).
 *
 * That drift is not hypothetical. The message mapping carries the 0054 media
 * fields, and a second hand-written copy of it is exactly how a picture message
 * ends up rendering as an empty bubble on one screen and correctly on the
 * other, months apart, with nothing to point at.
 *
 * PERMISSIONS ARE NOT DECIDED HERE. `canReply` and `canConsent` depend on the
 * staff member asking, and the caller already has them — this module would have
 * to be handed a staff object purely to pass it through. Every caller adds them
 * to what this returns.
 */

export interface ThreadMessageView {
  id: string;
  direction: "in" | "out";
  body: string | null;
  kind: string;
  hasMedia: boolean;
  mediaMime: string | null;
  mediaFilename: string | null;
  templateName: string | null;
  status: string | null;
  error: string | null;
  createdAt: string;
}

export interface ThreadView {
  contact: {
    id: string;
    phone: string;
    optedOut: boolean;
    marketingOptIn: boolean;
  };
  /** For the header, which shows a name and falls back to the number. */
  displayName: string;
  /** Everything the "this contact asked us to stop" banner needs, or null. */
  optOut: { at: string; reason: string | null; source: string | null } | null;
  messages: ThreadMessageView[];
  window: { open: boolean; label: string; everWrote: boolean };
  quickReplies: Record<ReplyLanguage, QuickReply[]>;
  /** Newest first. The thread uses [0] for the tracking link. */
  orders: OrderLite[];
}

export interface OrderLite {
  order_number: string;
  status: string;
  amount_paise: number | null;
  ordered_at: string | null;
}

/**
 * Orders for this handset.
 *
 * Matched on the last ten digits, because `buyer_phone` holds whatever the
 * customer typed or Razorpay sent back — some rows carry +91, some don't —
 * while the contact's phone is always normalised.
 */
export async function ordersFor(phone: string): Promise<OrderLite[]> {
  const local = phone.slice(-10);
  const { data } = await supabaseAdmin
    .from("orders")
    .select("order_number, status, amount_paise, ordered_at")
    .ilike("buyer_phone", `%${local}`)
    .order("ordered_at", { ascending: false })
    .limit(10);
  return (data ?? []) as unknown as OrderLite[];
}

/** Null when there is no such contact. */
export async function buildThreadView(contactId: string): Promise<ThreadView | null> {
  const contact = await getContact(contactId);
  if (!contact) return null;

  const [messages, orders] = await Promise.all([
    listThread(contact.id),
    ordersFor(contact.phone),
  ]);

  const win = windowState(contact.last_inbound_at);

  // The canned messages, filled in on the server rather than in the browser:
  // they carry the site URL and the customer's course login number, and
  // building them here keeps that logic — and NEXT_PUBLIC_APP_URL's localhost
  // guard — in one place instead of shipping a second copy into the bundle.
  const replyInput = {
    name: contact.display_name,
    phone: contact.phone,
    orderNumber: orders[0]?.order_number ?? null,
  };

  return {
    contact: {
      id: contact.id,
      phone: contact.phone,
      optedOut: !!contact.opt_out_at,
      marketingOptIn: !!contact.marketing_opt_in_at,
    },
    displayName: contact.display_name?.trim() || contact.phone,
    optOut: contact.opt_out_at
      ? {
          at: contact.opt_out_at,
          reason: contact.opt_out_reason ?? null,
          source: contact.opt_out_source ?? null,
        }
      : null,
    messages: messages.map((m) => ({
      id: m.id,
      direction: m.direction,
      body: m.body,
      kind: m.kind,
      hasMedia: !!m.media_id,
      mediaMime: m.media_mime ?? null,
      mediaFilename: m.media_filename ?? null,
      templateName: m.template_name,
      status: m.status,
      error: m.error,
      createdAt: m.created_at,
    })),
    window: {
      open: win.open,
      label: formatWindow(win.remainingMs),
      everWrote: !!contact.last_inbound_at,
    },
    quickReplies: {
      ml: quickReplies(replyInput, "ml"),
      en: quickReplies(replyInput, "en"),
    },
    orders,
  };
}

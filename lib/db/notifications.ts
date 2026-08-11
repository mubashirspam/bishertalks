import { supabaseAdmin } from "@/lib/supabase/admin";
import type { MakeEvent } from "@/lib/make";

/**
 * The notification log — see migration 0014.
 *
 * Two jobs: it is the audit trail behind "did the customer get the message?",
 * and it is the exactly-once guard. Claiming happens by INSERT, so the unique
 * index on event_id does the arbitration in the database rather than in a
 * check-then-write that two concurrent requests can both pass.
 *
 * Nothing here throws. A logging failure must never stop a message going out,
 * and must certainly never fail the payment that triggered it.
 */

export type NotificationStatus = "queued" | "sent" | "failed" | "skipped";

export interface NotificationRow {
  id: string;
  event_id: string;
  event: string;
  order_number: string | null;
  phone: string;
  status: NotificationStatus;
  provider: string | null;
  provider_message_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Reserve this event_id.
 *
 * Returns true when this caller is the one that should send. A false means
 * someone already claimed it — the verify route and the Razorpay webhook
 * racing the same payment, a Make retry, or a double-click in the admin.
 *
 * Returns true if the log itself is broken: a database hiccup should degrade
 * to "might send twice", never to "silently sends nothing".
 */
export async function claimNotification(
  event: MakeEvent,
  /** For events with no order payload but a known order — a course unlock. */
  orderNumber?: string | null
): Promise<boolean> {
  const { error } = await supabaseAdmin.from("notification_log").insert({
    event_id: event.event_id,
    event: event.event,
    order_number: event.order?.number ?? orderNumber ?? null,
    phone: event.customer.phone,
    status: "queued",
    payload: event,
  });

  if (!error) return true;

  // 23505 = unique_violation. The only expected failure, and not an error.
  if (error.code === "23505") {
    console.log("[Notify] duplicate suppressed:", event.event_id);
    return false;
  }

  console.error("[Notify] log insert failed:", error.message);
  return true;
}

/**
 * Claim many at once, for a bulk status change.
 *
 * One round trip instead of one per parcel: `ignoreDuplicates` lets the unique
 * index drop the ones already sent, and the returning rows are exactly the ones
 * this caller won. Fifty parcels is one insert, not fifty.
 *
 * On error, returns everything — same principle as the single claim: degrade to
 * "might send twice", never to "silently sends nothing".
 */
export async function claimNotifications(events: MakeEvent[]): Promise<MakeEvent[]> {
  if (!events.length) return [];

  const { data, error } = await supabaseAdmin
    .from("notification_log")
    .upsert(
      events.map((event) => ({
        event_id: event.event_id,
        event: event.event,
        order_number: event.order?.number ?? null,
        phone: event.customer.phone,
        status: "queued",
        payload: event,
      })),
      { onConflict: "event_id", ignoreDuplicates: true }
    )
    .select("event_id");

  if (error) {
    console.error("[Notify] bulk claim failed:", error.message);
    return events;
  }

  const claimed = new Set((data ?? []).map((r) => r.event_id as string));
  const won = events.filter((e) => claimed.has(e.event_id));

  if (won.length < events.length) {
    console.log(`[Notify] ${events.length - won.length} duplicate(s) suppressed`);
  }
  return won;
}

/** Record what happened to a claimed event. */
export async function markNotificationResult(
  eventId: string,
  result: {
    status: NotificationStatus;
    provider?: string | null;
    providerMessageId?: string | null;
    error?: string | null;
  }
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("notification_log")
    .update({
      status: result.status,
      provider: result.provider ?? null,
      provider_message_id: result.providerMessageId ?? null,
      error: result.error ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("event_id", eventId);

  if (error) console.error("[Notify] log update failed:", error.message);
}

/** Same, for a whole batch that shared one webhook call. */
export async function markNotificationResults(
  eventIds: string[],
  result: { status: NotificationStatus; error?: string | null }
): Promise<void> {
  if (!eventIds.length) return;

  const { error } = await supabaseAdmin
    .from("notification_log")
    .update({
      status: result.status,
      error: result.error ?? null,
      updated_at: new Date().toISOString(),
    })
    .in("event_id", eventIds);

  if (error) console.error("[Notify] log bulk update failed:", error.message);
}

/** Message history for one order, newest first. Powers the admin strip. */
export async function listNotifications(
  orderNumber: string
): Promise<NotificationRow[]> {
  const { data, error } = await supabaseAdmin
    .from("notification_log")
    .select(
      "id, event_id, event, order_number, phone, status, provider, provider_message_id, error, created_at, updated_at"
    )
    .eq("order_number", orderNumber)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[Notify] history read failed:", error.message);
    return [];
  }
  return (data ?? []) as NotificationRow[];
}

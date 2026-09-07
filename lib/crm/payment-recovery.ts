import { supabaseAdmin } from "@/lib/supabase/admin";
import { orderStage, type OrderStage } from "@/lib/order-stage";
import { upsertContact } from "@/lib/crm/contacts";
import { scheduleEvent, cancelEvents } from "@/lib/crm/automation";

/**
 * One automatic nudge for a payment that failed, and one for a checkout that
 * was started and never finished.
 *
 * Deliberately not new machinery: `payment_failed_2` and `payment_reminder_2`
 * already exist in CAMPAIGN_TEMPLATES for exactly these two audiences — UTILITY,
 * order-aware, and written with the lesson this codebase already paid for (see
 * the comment on payment_reminder_2): no payment link inside the template
 * itself, because a utility notice that also carries a buy link reads as a
 * promotion. The link goes out only when the customer taps to ask for it
 * (`payment:send_link` in lib/crm/flow-table.ts).
 *
 * Scheduled from the moment an order enters the stage, not swept from a
 * timer — see the long comment in app/api/cron/whatsapp-automation/route.ts
 * for why a time-swept bulk query is the thing this deliberately is not.
 */

const RECOVERY_EVENT_TYPES = [
  "payment_failed_reminder",
  "checkout_abandoned_reminder",
] as const;
type RecoveryEventType = (typeof RECOVERY_EVENT_TYPES)[number];

const RECOVERY_TEMPLATE: Record<RecoveryEventType, string> = {
  payment_failed_reminder: "payment_failed_2",
  checkout_abandoned_reminder: "payment_reminder_2",
};

/** Which order-stage each event expects to still find true when it fires. */
const RECOVERY_STAGE: Record<RecoveryEventType, OrderStage> = {
  payment_failed_reminder: "failed",
  checkout_abandoned_reminder: "payment_started",
};

interface RecoveryOrder {
  id: string;
  order_number: string;
  buyer_name: string | null;
  buyer_phone: string | null;
}

async function loadOrderByNumber(orderNumber: string): Promise<RecoveryOrder | null> {
  const { data } = await supabaseAdmin
    .from("orders")
    .select("id, order_number, buyer_name, buyer_phone")
    .eq("order_number", orderNumber)
    .maybeSingle();
  return (data as RecoveryOrder | null) ?? null;
}

async function scheduleRecovery(
  eventType: RecoveryEventType,
  orderNumber: string,
  afterMinutes: number
): Promise<void> {
  const order = await loadOrderByNumber(orderNumber);
  // No phone, nothing to message — standard checkout always has one by the
  // time an order row exists; Magic Checkout doesn't until after payment,
  // which is exactly the case these two events can never legitimately fire
  // for, so this is the correct exit rather than a gap to fill.
  if (!order?.buyer_phone) return;

  const contact = await upsertContact(order.buyer_phone, {
    name: order.buyer_name,
    orderNumber: order.order_number,
  });
  if (!contact) return;

  await scheduleEvent({
    contactId: contact.id,
    orderId: order.id,
    eventType,
    templateName: RECOVERY_TEMPLATE[eventType],
    afterMinutes,
    reason: `Order ${order.order_number} reached ${RECOVERY_STAGE[eventType]}`,
  });
}

/** Call once, right after an order is marked `failed`. */
export async function scheduleFailedPaymentRetry(orderNumber: string): Promise<void> {
  await scheduleRecovery("payment_failed_reminder", orderNumber, 30);
}

/** Call once, right after a Razorpay order is created on the standard checkout. */
export async function scheduleCheckoutAbandoned(orderNumber: string): Promise<void> {
  await scheduleRecovery("checkout_abandoned_reminder", orderNumber, 90);
}

export function isRecoveryEvent(eventType: string): eventType is RecoveryEventType {
  return (RECOVERY_EVENT_TYPES as readonly string[]).includes(eventType);
}

export type RecoveryVerdict =
  | { ok: true; customerName: string; orderNumber: string }
  | { ok: false; reason: string };

/**
 * Is this order still in the stage the event was scheduled for?
 *
 * The send-time half of "decide at send time, not schedule time" — the other
 * half is `cancelRecoveryEvents`, called the moment an order is claimed paid.
 * Between the two, an order that moves on in the gap between scheduling and
 * the worker's next run is caught either way: paid cancels the row outright,
 * and this catches everything else (a failed order paid through some other
 * path, a stale row, whatever else changed underneath it).
 */
export async function recoveryEligibility(
  eventType: string,
  orderId: string | null,
  contactId: string
): Promise<RecoveryVerdict> {
  const expected = RECOVERY_STAGE[eventType as RecoveryEventType];
  if (!expected) return { ok: false, reason: `Unknown recovery event: ${eventType}` };
  if (!orderId) return { ok: false, reason: "No order attached to this event" };

  // A staff-run campaign may already have sent this exact template to this
  // contact — same check campaigns.ts makes before queueing, applied here so
  // the two systems can't double-send the same wording just because neither
  // knows about the other.
  const { count: already } = await supabaseAdmin
    .from("whatsapp_messages")
    .select("id", { count: "exact", head: true })
    .eq("contact_id", contactId)
    .eq("direction", "out")
    .eq("template_name", RECOVERY_TEMPLATE[eventType as RecoveryEventType])
    .eq("status", "sent");
  if (already) return { ok: false, reason: "Already had this template" };

  const { data } = await supabaseAdmin
    .from("orders")
    .select(
      "order_number, buyer_name, payment_status, razorpay_order_id, address_line1, refunded_paise"
    )
    .eq("id", orderId)
    .maybeSingle();

  if (!data) return { ok: false, reason: "Order no longer exists" };

  const stage = orderStage(data as {
    razorpay_order_id: string | null;
    payment_status: string;
    address_line1: string | null;
    refunded_paise: number;
  });
  if (stage !== expected) {
    return { ok: false, reason: `Order has moved on — now ${stage}, not ${expected}` };
  }

  return {
    ok: true,
    customerName: data.buyer_name ?? "സുഹൃത്തേ",
    orderNumber: data.order_number,
  };
}

/** Drop any pending recovery nudge for this contact. Call the moment an order is paid. */
export async function cancelRecoveryEvents(contactId: string): Promise<void> {
  await cancelEvents(contactId, {
    types: [...RECOVERY_EVENT_TYPES],
    reason: "Order paid",
  });
}

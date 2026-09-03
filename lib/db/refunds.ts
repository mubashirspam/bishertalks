import { supabaseAdmin } from "@/lib/supabase/admin";
import { voidCommissions } from "@/lib/db/referrals";
import { audit } from "@/lib/audit";

/**
 * Recording money that went back to the customer.
 *
 * The one place a refund is written, shared by the Razorpay webhook and
 * scripts/refund-backfill.mjs, so a refund that arrives live and one that is
 * discovered afterwards land in the database identically.
 *
 * WHAT THIS DOES NOT DO: it never touches `payment_status`, `status`, or
 * `amount_paise`. A refund is a second fact recorded beside the payment, not an
 * edit to it — see the header of migration 0055 for why, and for why a
 * cancellation must never be read as a refund. Cancelling the order and
 * refunding the money are two separate decisions the owner makes, often only
 * one of them, and this file is only ever told about the second.
 */

/** An order, identified by whichever handle the caller happens to hold. */
export type RefundLookup =
  | { razorpayPaymentId: string }
  | { razorpayOrderId: string }
  | { orderNumber: string };

export interface RefundFacts {
  /**
   * Razorpay's own running total of what has been sent back on this payment
   * (`payment.amount_refunded`), NOT the size of the latest refund.
   *
   * Absolute rather than incremental on purpose. Razorpay retries webhooks and
   * sends `refund.created` and `refund.processed` for the same refund, so an
   * incremental write would double- or triple-count; assigning the gateway's
   * total makes every redelivery a no-op. It also self-corrects a refund that
   * later fails, since Razorpay takes the amount back out of its own total.
   */
  amountRefundedPaise: number;
  /** The latest refund's id, for tracing a figure back to the gateway. */
  refundId?: string | null;
  /** When the refund happened, ISO. Defaults to now. */
  at?: string | null;
}

export interface RefundResult {
  orderNumber: string;
  /** What the row said before this write — 0 on the first refund. */
  previousPaise: number;
  refundedPaise: number;
  amountPaise: number;
  /** Every rupee of the order has gone back. */
  full: boolean;
  /** False when the write changed nothing — a redelivered webhook. */
  changed: boolean;
}

/**
 * Write a refund against the order that payment belongs to.
 *
 * Returns null when no order matches, which is a real and expected case: the
 * shop has taken payments outside this system, and a refund on one of those
 * has nothing here to attach to. The caller logs it rather than failing the
 * webhook, because a 500 makes Razorpay retry an event that can never succeed.
 */
export async function recordRefund(
  lookup: RefundLookup,
  facts: RefundFacts
): Promise<RefundResult | null> {
  const column =
    "razorpayPaymentId" in lookup
      ? "razorpay_payment_id"
      : "razorpayOrderId" in lookup
        ? "razorpay_order_id"
        : "order_number";
  const value =
    "razorpayPaymentId" in lookup
      ? lookup.razorpayPaymentId
      : "razorpayOrderId" in lookup
        ? lookup.razorpayOrderId
        : lookup.orderNumber;

  const { data: order, error: readError } = await supabaseAdmin
    .from("orders")
    .select("order_number, amount_paise, refunded_paise, referral_status")
    .eq(column, value)
    .maybeSingle();

  if (readError) {
    console.error("[Refund] lookup failed:", { column, value, readError });
    return null;
  }
  if (!order) return null;

  const previousPaise = order.refunded_paise ?? 0;
  // Clamped at the order total. Razorpay refunds against the PAYMENT, and a
  // payment can in principle carry more than this row's amount (a link paid
  // for two orders at once, a manual capture someone adjusted). Letting the
  // refund exceed the sale would push the revenue sum negative and make a
  // single odd order look like a loss-making day.
  const refundedPaise = Math.max(
    0,
    Math.min(facts.amountRefundedPaise, order.amount_paise ?? 0)
  );

  const full = refundedPaise > 0 && refundedPaise >= (order.amount_paise ?? 0);

  if (refundedPaise === previousPaise) {
    return {
      orderNumber: order.order_number,
      previousPaise,
      refundedPaise,
      amountPaise: order.amount_paise ?? 0,
      full,
      changed: false,
    };
  }

  const { error } = await supabaseAdmin
    .from("orders")
    .update({
      refunded_paise: refundedPaise,
      // Cleared when a failed refund takes the total back to zero, so the date
      // never outlives the money it describes.
      refunded_at: refundedPaise > 0 ? (facts.at ?? new Date().toISOString()) : null,
      razorpay_refund_id: refundedPaise > 0 ? (facts.refundId ?? null) : null,
    })
    .eq("order_number", order.order_number);

  if (error) {
    console.error("[Refund] write failed:", { order: order.order_number, error });
    return null;
  }

  // Nothing is owed on a sale that was handed back in full. Same rule the
  // ledger already applies to a cancelled or returned parcel, and the same
  // guard: void_referral_commissions never touches a commission already paid
  // out, because that money has left the bank and the ledger must agree with it.
  if (full && order.referral_status) {
    await voidCommissions([order.order_number]);
  }

  await audit({
    actor: null,
    action: "order.refund",
    entity: "order",
    entityId: order.order_number,
    meta: {
      refunded_paise: refundedPaise,
      amount_paise: order.amount_paise ?? 0,
      full,
      refund_id: facts.refundId ?? null,
    },
  });

  return {
    orderNumber: order.order_number,
    previousPaise,
    refundedPaise,
    amountPaise: order.amount_paise ?? 0,
    full,
    changed: true,
  };
}

import { funnelWaMessage, deliveryWaMessage } from "@/lib/wa-message";
import { STAGE_LABELS, type OrderStage } from "@/lib/order-stage";
import { DELIVERY_LABELS, type DeliveryStage } from "@/lib/delivery-stage";
import { purchaseEmail } from "@/lib/email-templates";

/**
 * Every message the shop can send, rendered against one invented order.
 *
 * The admin screen must not show a template as a string full of `{{1}}` — the
 * question it exists to answer is "what does the customer actually read", and
 * a placeholder does not answer it. So each message is built by calling the
 * same function the Orders and Delivery screens call, with a fake order shaped
 * to land on the stage being previewed.
 *
 * Calling the real builders rather than copying their output is the whole
 * point: the day someone edits `wa-message.ts`, this screen changes with it.
 * A second copy of the wording would be wrong within a week and nobody would
 * know, which is the failure this screen is supposed to prevent.
 */

/** Recognisably fake, and shaped like a real one. */
const SAMPLE = {
  order_number: "ORD-K3523P",
  buyer_name: "Asraf",
  buyer_phone: "9847759381",
  amount_paise: 69900,
  city: "കണ്ണൂർ",
  state: "Kerala",
} as const;

export interface Preview {
  /** The stage or event this message belongs to. */
  key: string;
  label: string;
  body: string;
}

/**
 * The Orders screen's messages — one per funnel stage.
 *
 * The stage is derived, never passed, so each preview sets the three columns
 * `orderStage()` actually reads. Anything else would be a guess about a
 * function that can change.
 */
export function funnelPreviews(): Preview[] {
  const rows: { stage: OrderStage; row: Parameters<typeof funnelWaMessage>[0] }[] = [
    {
      stage: "lead",
      row: { ...SAMPLE, razorpay_order_id: null, payment_status: "pending", address_line1: null },
    },
    {
      stage: "payment_started",
      row: { ...SAMPLE, razorpay_order_id: "order_Nz1sample", payment_status: "pending", address_line1: null },
    },
    {
      stage: "failed",
      row: { ...SAMPLE, razorpay_order_id: "order_Nz1sample", payment_status: "failed", address_line1: null },
    },
    {
      stage: "paid_no_address",
      row: { ...SAMPLE, razorpay_order_id: "order_Nz1sample", payment_status: "paid", address_line1: null },
    },
    {
      stage: "complete",
      row: { ...SAMPLE, razorpay_order_id: "order_Nz1sample", payment_status: "paid", address_line1: "സാമ്പിൾ വിലാസം" },
    },
  ];

  return rows.map(({ stage, row }) => ({
    key: stage,
    label: STAGE_LABELS[stage],
    body: funnelWaMessage(row),
  }));
}

/** The Delivery screen's messages — one per delivery stage. */
export function deliveryPreviews(): Preview[] {
  const base = {
    ...SAMPLE,
    assigned_agent_id: null,
    courier_id: null as string | null,
    courier_name: null as string | null,
    tracking_number: null as string | null,
  };

  const rows: { stage: DeliveryStage; row: Parameters<typeof deliveryWaMessage>[0] }[] = [
    { stage: "new", row: { ...base, status: "confirmed" } },
    { stage: "assigned", row: { ...base, status: "confirmed", courier_id: "sample-courier" } },
    {
      stage: "shipped",
      row: {
        ...base,
        status: "shipped",
        courier_id: "sample-courier",
        courier_name: "KKR Logistics (Delhivery)",
        tracking_number: "54132310009962",
      },
    },
    { stage: "out_for_delivery", row: { ...base, status: "out_for_delivery", courier_id: "sample-courier" } },
    { stage: "delivered", row: { ...base, status: "delivered", courier_id: "sample-courier" } },
    { stage: "returned", row: { ...base, status: "returned", courier_id: "sample-courier" } },
    { stage: "cancelled", row: { ...base, status: "cancelled" } },
  ];

  return rows.map(({ stage, row }) => ({
    key: stage,
    label: DELIVERY_LABELS[stage],
    body: deliveryWaMessage(row),
  }));
}

export interface EmailPreview {
  key: string;
  label: string;
  when: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * The one email the shop sends.
 *
 * Only buyers who gave an email address get it — a good half of them do not,
 * which is why the hand-sent WhatsApp above carries the course link too. The
 * screen says so rather than leaving someone to assume every customer was
 * emailed.
 */
export function emailPreviews(): EmailPreview[] {
  const { subject, html, text } = purchaseEmail(
    {
      order_number: SAMPLE.order_number,
      buyer_name: SAMPLE.buyer_name,
      buyer_phone: SAMPLE.buyer_phone,
      amount_paise: SAMPLE.amount_paise,
      city: "Kannur",
      state: SAMPLE.state,
    },
    "https://bishertalks.com"
  );

  return [
    {
      key: "purchase",
      label: "Purchase receipt",
      when: "Sent once, after payment is verified — only if the buyer gave an email address.",
      subject,
      html,
      text,
    },
  ];
}

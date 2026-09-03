export type OrderStatus =
  | "confirmed"
  | "processing"
  | "shipped"
  | "out_for_delivery"
  | "delivered"
  | "cancelled"
  // Shipped, and it came back to us. Not the same as cancelled, which means
  // it never went out. See migration 0015.
  | "returned";

/**
 * Whether the money landed. NOT whether it stayed — a refund is recorded in
 * `refunded_paise` beside the payment rather than by rewriting this, so that
 * partial refunds are expressible and so that a refunded order does not vanish
 * from the ~40 queries that ask for payment_status = 'paid'. See migration 0055.
 *
 * 'refunded' is therefore never written by any code path today. It is kept
 * because rows may predate that decision and because dropping a value from a
 * union is how a `switch` starts silently missing a case.
 */
export type PaymentStatus = "pending" | "paid" | "failed" | "refunded";

export type CheckoutType = "standard" | "magic";

export interface Order {
  id: string;
  order_number: string;
  // Buyer and address are null until payment confirms: Magic Checkout collects
  // them itself, and they're written back from Razorpay afterwards.
  buyer_name: string | null;
  buyer_phone: string | null;
  buyer_email: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  district: string | null;
  state: string | null;
  pincode: string | null;
  shipping_fee_paise: number;
  checkout_type: CheckoutType;
  razorpay_order_id: string | null;
  razorpay_payment_id: string | null;
  razorpay_signature: string | null;
  amount_paise: number;
  /** Copies of the book. The bonus course is one per order regardless (0023). */
  quantity: number;
  /** Wrap it and write the card before it ships (migration 0027). */
  is_gift: boolean;
  /** What to write on the card, or null for wrapping with no message. */
  gift_message: string | null;
  /** What they were charged for wrapping, snapshotted at checkout. */
  gift_charge_paise: number;
  /** Sign every copy before wrapping it (0040). Gifts only, and free (0041). */
  is_signed: boolean;
  promo_code: string | null;
  discount_paise: number;
  payment_status: PaymentStatus;
  /**
   * How much of `amount_paise` has gone back to the customer (migration 0055).
   *
   * Written only by Razorpay — the webhook's refund events, or the backfill
   * script reading the same API. 0 on everything else, including every
   * cancelled order that was never refunded, which is most of them.
   *
   * Revenue is `amount_paise - refunded_paise` on every screen that sums money.
   * `payment_status` deliberately stays 'paid' through a refund; see 0055.
   */
  refunded_paise: number;
  /** When the money went back, or null. */
  refunded_at: string | null;
  /** The latest refund's Razorpay id (rfnd_...), for tracing a figure back. */
  razorpay_refund_id: string | null;
  status: OrderStatus;
  tracking_number: string | null;
  courier_name: string | null;
  expected_delivery: string | null;
  notes: string | null;
  // Delivery (migration 0005). These are the dates the customer sees against
  // each step on the tracking page. The label print used to move an order from
  // 'confirmed' to 'processing'; since 0020 it only records that a sheet was
  // printed — the agent ticks the stages in the portal.
  label_downloaded_at: string | null;
  label_download_count: number;
  shipped_at: string | null;
  delivered_at: string | null;
  /** When the parcel came back, or null (migration 0015). */
  returned_at: string | null;
  /** When the agent keyed the address into the courier's system (0016). */
  courier_entered_at: string | null;
  /**
   * Which logistics partner carries this parcel, or null for undecided (0030).
   *
   * Deliberately not defaulted: "assigned to Delhivery" is a decision someone
   * makes, and a default would put parcels in front of a courier nobody chose.
   */
  courier_id: string | null;
  /**
   * When the courier above was chosen, and by whom (migration 0057).
   *
   * The routing decision's own timestamp, and deliberately none of the three
   * that existed before it. `courier_entered_at` is a later, separate act and
   * is null on every parcel not yet handed over; `courier_sent_at` only ever
   * fills in for an integrated courier; `assigned_at` is the delivery agent,
   * who is a different person from the courier. This is the column the reports
   * screen filters on for "everything I gave Delhivery on 24 August".
   *
   * Re-stamped on a re-route, so it always names the current courier's day.
   */
  courier_assigned_at: string | null;
  courier_assigned_by: string | null;
  /**
   * When the partner's API accepted it (0030).
   *
   * Narrower than `courier_entered_at`, which every handoff sets — this one
   * means an API call succeeded, and is what makes a re-send detectable.
   */
  courier_sent_at: string | null;
  /** The last rejection from the partner, cleared on a successful send. */
  courier_send_error: string | null;
  /** The partner's most recent scan, in their own wording. */
  courier_last_scan: string | null;
  courier_last_scan_at: string | null;
  /**
   * India Post's article number, once one has been allotted (0049).
   *
   * Kept apart from `tracking_number` on purpose — see the migration. It is
   * minted from our own allotment before the parcel is posted, so an order can
   * hold one while India Post has still never seen the parcel. The customer's
   * tracking page reads it, and says which of those two states it is in rather
   * than offering a number that would look up to nothing.
   */
  postal_barcode: string | null;
  /** The delivery agent carrying this parcel, or null for New (0019). */
  assigned_agent_id: string | null;
  assigned_at: string | null;
  /** When the receipt email went out, or null. */
  invoice_email_sent_at: string | null;
  /** Recovery payment link generated from admin (migration 0013). */
  payment_link_id: string | null;
  payment_link_url: string | null;
  /**
   * When checkout began — the moment a valid mobile number was first typed.
   *
   * NOT the order date. A customer who abandons and comes back days later is
   * still the same row (see /api/leads), so this can be far from the payment.
   * Show `ordered_at` instead; this one answers "when did they first show up?"
   */
  created_at: string;
  /**
   * When the money landed and the order was confirmed (migration 0043).
   *
   * Null on anything unpaid, and null on orders paid before 0043 — nothing was
   * backfilled, so an old row falls through to created_at via `ordered_at`.
   * Stamped by a database trigger rather than by application code, so no write
   * path can forget it.
   */
  paid_at: string | null;
  /**
   * The order date, and the one every screen sorts, filters and displays by.
   *
   * Generated as COALESCE(paid_at, created_at) — read-only, and it cannot drift
   * from its inputs. For a paid order this is the confirmation date; for a lead
   * that never paid it is when they started.
   */
  ordered_at: string;
  /**
   * When the delivery address was submitted (migration 0004).
   *
   * Not the same as `created_at`: the order row is written when checkout
   * begins, and on the standard flow the address form comes after payment. It
   * is the closest stand-in for "when was this paid" on an order whose receipt
   * email never went out — there is no paid_at column.
   */
  address_submitted_at: string | null;
  updated_at: string;
  /** Audit trail, attached by /api/orders/[id] for the admin detail page. */
  history?: {
    id: number;
    actor_email: string | null;
    action: string;
    meta: Record<string, unknown> | null;
    created_at: string;
  }[];
  /**
   * WhatsApp messages sent for this order (migration 0014), attached by the
   * same route. 'queued' means Make accepted it but hasn't reported back yet.
   */
  notifications?: {
    id: string;
    event_id: string;
    event: string;
    /**
     * 'delivered' and 'read' come from Meta's status webhook (0025) — under
     * Make.com nothing ever reported them.
     */
    status: "queued" | "sent" | "delivered" | "read" | "failed" | "skipped";
    error: string | null;
    created_at: string;
  }[];
}

export const STATUS_LABELS: Record<OrderStatus, string> = {
  confirmed: "Order Confirmed",
  // Reached when the address label is printed — "Packed" is what that
  // actually means to a customer, and to whoever is packing.
  processing: "Packed",
  shipped: "Shipped",
  out_for_delivery: "Out for Delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
  returned: "Returned to us",
};

export const STATUS_STEPS: OrderStatus[] = [
  "confirmed",
  "processing",
  "shipped",
  "out_for_delivery",
  "delivered",
];

export const STATUS_BADGE: Record<OrderStatus, string> = {
  confirmed: "bg-blue-50 text-blue-700 border-blue-200",
  processing: "bg-amber-50 text-amber-700 border-amber-200",
  shipped: "bg-purple-50 text-purple-700 border-purple-200",
  out_for_delivery: "bg-orange-50 text-orange-700 border-orange-200",
  delivered: "bg-green-50 text-green-700 border-green-200",
  cancelled: "bg-red-50 text-red-700 border-red-200",
  returned: "bg-rose-50 text-rose-700 border-rose-300",
};

export type OrderStatus =
  | "confirmed"
  | "processing"
  | "shipped"
  | "out_for_delivery"
  | "delivered"
  | "cancelled";

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
  promo_code: string | null;
  discount_paise: number;
  payment_status: PaymentStatus;
  status: OrderStatus;
  tracking_number: string | null;
  courier_name: string | null;
  expected_delivery: string | null;
  notes: string | null;
  // Delivery (migration 0005). The label print is what moves an order from
  // 'confirmed' to 'processing', and these are the dates the customer sees
  // against each step on the tracking page.
  label_downloaded_at: string | null;
  label_download_count: number;
  shipped_at: string | null;
  delivered_at: string | null;
  /** When the receipt email went out, or null. */
  invoice_email_sent_at: string | null;
  /** Recovery payment link generated from admin (migration 0013). */
  payment_link_id: string | null;
  payment_link_url: string | null;
  created_at: string;
  updated_at: string;
  /** Audit trail, attached by /api/orders/[id] for the admin detail page. */
  history?: {
    id: number;
    actor_email: string | null;
    action: string;
    meta: Record<string, unknown> | null;
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
};

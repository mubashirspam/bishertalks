import Razorpay from "razorpay";

let _razorpay: Razorpay | undefined;

// Lazy singleton — not instantiated at module evaluation time
export function getRazorpay(): Razorpay {
  if (!_razorpay) {
    _razorpay = new Razorpay({
      key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID!,
      key_secret: process.env.RAZORPAY_KEY_SECRET!,
    });
  }
  return _razorpay;
}

/**
 * Contact + shipping details Magic Checkout collects from the customer. These
 * live on the Razorpay order, not on our form, so they are only available once
 * the customer has completed checkout.
 */
export interface MagicCustomerDetails {
  name: string | null;
  email: string | null;
  phone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
}

/** Address object Razorpay nests under the order's customer details. */
interface RzpAddress {
  name?: string;
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  zipcode?: string;
  postal_code?: string;
  contact?: string;
}

const str = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s || null;
};

/**
 * Fetch a Razorpay order and pull out the customer details Magic Checkout
 * captured. Prefers shipping_address, falling back to billing_address.
 *
 * Fields are read defensively: Razorpay returns `zipcode` on Magic Checkout
 * addresses but `postal_code` elsewhere, and the Node SDK's types don't cover
 * the Magic Checkout additions. Returns null rather than throwing so a payment
 * is never lost just because the address lookup failed.
 */
export async function fetchMagicCustomerDetails(
  razorpayOrderId: string
): Promise<MagicCustomerDetails | null> {
  try {
    const order = (await getRazorpay().orders.fetch(razorpayOrderId)) as unknown as {
      customer_details?: {
        name?: string;
        email?: string;
        contact?: string;
        shipping_address?: RzpAddress;
        billing_address?: RzpAddress;
      };
    };

    const cd = order?.customer_details;
    if (!cd) return null;

    const addr: RzpAddress = cd.shipping_address ?? cd.billing_address ?? {};

    return {
      name: str(cd.name) ?? str(addr.name),
      email: str(cd.email),
      phone: str(cd.contact) ?? str(addr.contact),
      addressLine1: str(addr.line1),
      addressLine2: str(addr.line2),
      city: str(addr.city),
      state: str(addr.state),
      pincode: str(addr.zipcode) ?? str(addr.postal_code),
    };
  } catch (e) {
    console.error("[Razorpay] fetch order failed:", razorpayOrderId, e);
    return null;
  }
}

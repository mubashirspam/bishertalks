import { supabaseAdmin } from "@/lib/supabase/admin";
import { fetchMagicCustomerDetails } from "@/lib/razorpay";
import { normalizePhone } from "@/lib/db/users";

/**
 * Copy the contact + shipping details Magic Checkout collected onto our order
 * row. With Magic Checkout the order is created before we know who the buyer
 * is, so this is what makes an order shippable.
 *
 * Must run BEFORE granting course access — the grant resolves the buyer from
 * the order's `buyer_phone`.
 *
 * Idempotent: only writes fields we don't already have, so a webhook arriving
 * after the browser handler can't blank out details or overwrite an address an
 * admin has since corrected. Never throws — a failed address lookup must not
 * cost us a confirmed payment.
 */
export async function backfillOrderFromRazorpay(
  orderNumber: string,
  razorpayOrderId: string
): Promise<void> {
  try {
    const { data: existing } = await supabaseAdmin
      .from("orders")
      .select(
        "buyer_name,buyer_phone,buyer_email,address_line1,address_line2,city,state,pincode"
      )
      .eq("order_number", orderNumber)
      .maybeSingle();

    if (!existing) {
      console.error("[Backfill] order not found:", orderNumber);
      return;
    }

    // Already have a shipping address and a phone — nothing to do.
    if (existing.address_line1 && existing.buyer_phone) return;

    const details = await fetchMagicCustomerDetails(razorpayOrderId);
    if (!details) {
      console.error(
        "[Backfill] no customer_details on Razorpay order:",
        razorpayOrderId
      );
      return;
    }

    const phone = details.phone ? normalizePhone(details.phone) : null;

    const patch: Record<string, string> = {};
    const put = (col: string, cur: unknown, next: string | null) => {
      if (!cur && next) patch[col] = next;
    };

    put("buyer_name", existing.buyer_name, details.name);
    put("buyer_phone", existing.buyer_phone, phone);
    put("buyer_email", existing.buyer_email, details.email);
    put("address_line1", existing.address_line1, details.addressLine1);
    put("address_line2", existing.address_line2, details.addressLine2);
    put("city", existing.city, details.city);
    put("state", existing.state, details.state);
    put("pincode", existing.pincode, details.pincode);

    if (Object.keys(patch).length === 0) return;

    const { error } = await supabaseAdmin
      .from("orders")
      .update(patch)
      .eq("order_number", orderNumber);

    if (error) {
      console.error("[Backfill] update failed:", orderNumber, error.message);
      return;
    }

    console.log(
      "[Backfill] filled",
      Object.keys(patch).join(","),
      "for",
      orderNumber
    );
  } catch (e) {
    console.error("[Backfill] unexpected error for", orderNumber, e);
  }
}

import { getProductPricing } from "@/lib/db/courses";
import { MAGIC_CHECKOUT_ENABLED } from "@/lib/magic-checkout";
import MagicCheckoutForm from "./MagicCheckoutForm";
import StandardCheckoutForm from "./StandardCheckoutForm";

export const dynamic = "force-dynamic";

export default async function CheckoutPage() {
  const pricing = await getProductPricing();

  // Magic Checkout collects the address itself, so the two forms are different
  // shapes. This flag must agree with what /api/orders/create sends to Razorpay.
  return MAGIC_CHECKOUT_ENABLED ? (
    <MagicCheckoutForm pricing={pricing} />
  ) : (
    <StandardCheckoutForm pricing={pricing} />
  );
}

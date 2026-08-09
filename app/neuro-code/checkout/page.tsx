import { cookies } from "next/headers";
import { getProductPricing } from "@/lib/db/courses";
import { MAGIC_CHECKOUT_ENABLED } from "@/lib/magic-checkout";
import { previewReferralPricing } from "@/lib/db/referrals";
import {
  decodeAttribution,
  ATTR_FIRST_COOKIE,
  ATTR_LAST_COOKIE,
} from "@/lib/attribution";
import MagicCheckoutForm from "./MagicCheckoutForm";
import StandardCheckoutForm from "./StandardCheckoutForm";

export const dynamic = "force-dynamic";

export default async function CheckoutPage() {
  const pricing = await referralAdjustedPricing();

  // Magic Checkout collects the address itself, so the two forms are different
  // shapes. This flag must agree with what /api/orders/create sends to Razorpay.
  return MAGIC_CHECKOUT_ENABLED ? (
    <MagicCheckoutForm pricing={pricing} />
  ) : (
    <StandardCheckoutForm pricing={pricing} />
  );
}

/**
 * The price this particular visitor will actually be charged.
 *
 * Someone who arrived through a referral link pays the referral price, and
 * until now the checkout still showed them the full one — so the page said
 * ₹699 and the card was debited ₹649. A quiet discount is a nice surprise; a
 * page that disagrees with the payment sheet reads as a bug and loses the sale.
 *
 * Display only. /api/orders/create recomputes the charge from the same cookie
 * and the same pricing function, so nothing here can be talked into a lower
 * price by editing the page.
 */
async function referralAdjustedPricing() {
  const pricing = await getProductPricing();

  const jar = await cookies();
  const first = decodeAttribution(jar.get(ATTR_FIRST_COOKIE)?.value);
  const last = decodeAttribution(jar.get(ATTR_LAST_COOKIE)?.value);
  const code = first?.ref_code ?? last?.ref_code ?? null;

  const referral = await previewReferralPricing(code, pricing.payablePaise);
  if (!referral) return pricing;

  return {
    ...pricing,
    // Keep the original as the struck-through price so the saving is visible.
    price: pricing.payable,
    offerPrice: Math.round(referral.finalPaise / 100),
    payable: Math.round(referral.finalPaise / 100),
    payablePaise: referral.finalPaise,
  };
}

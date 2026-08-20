import { cookies } from "next/headers";
import { getProductPricing } from "@/lib/db/courses";
import { getGiftSettings } from "@/lib/db/gift";
import { getCheckoutSettings } from "@/lib/db/checkout-settings";
import { MAGIC_CHECKOUT_ENABLED } from "@/lib/magic-checkout";
import { previewReferralPricing } from "@/lib/db/referrals";
import {
  decodeAttribution,
  ATTR_FIRST_COOKIE,
  ATTR_LAST_COOKIE,
} from "@/lib/attribution";
import MagicCheckoutForm from "./MagicCheckoutForm";
import StandardCheckoutForm from "./StandardCheckoutForm";
import {
  PREORDER_DELIVERY_DAYS,
  launchOfferIsLive,
  launchOfferDayLabel,
  preorderArrivesBy,
} from "@/lib/preorder";

export const dynamic = "force-dynamic";

export default async function CheckoutPage() {
  // All display only. /api/orders/create reads the same three things for
  // itself before it charges anything, so none of them can be talked down from
  // here — including `checkout`, which decides whether a typed promo code is
  // honoured at all and not merely whether the box is drawn.
  const [pricing, gift, checkout] = await Promise.all([
    referralAdjustedPricing(),
    getGiftSettings(),
    getCheckoutSettings(),
  ]);

  // The pre-order facts, resolved here rather than in the forms. Both are
  // client components, and `live` is a comparison against the clock — worked
  // out in the browser it would render one thing on the server and another
  // after hydration, on the line that sets the delivery expectation.
  const preorder = {
    live: launchOfferIsLive(),
    day: launchOfferDayLabel(),
    arrivesBy: preorderArrivesBy(),
    deliveryDays: PREORDER_DELIVERY_DAYS,
  };

  // Magic Checkout collects the address itself, so the two forms are different
  // shapes. This flag must agree with what /api/orders/create sends to Razorpay.
  return MAGIC_CHECKOUT_ENABLED ? (
    <MagicCheckoutForm pricing={pricing} gift={gift} checkout={checkout} preorder={preorder} />
  ) : (
    <StandardCheckoutForm pricing={pricing} gift={gift} checkout={checkout} preorder={preorder} />
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

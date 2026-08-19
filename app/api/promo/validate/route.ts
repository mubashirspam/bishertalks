export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { validatePromo } from "@/lib/db/promo";
import { getProductPricing } from "@/lib/db/courses";
import { clampQuantity } from "@/lib/quantity";
import { getCheckoutSettings } from "@/lib/db/checkout-settings";
import { promoCodeAllowed } from "@/lib/checkout-settings";

// POST { code, quantity } — validate a promo code against the current basket.
// Returns the discount + final amount (in paise) for display. The order route
// re-validates server-side, so this is display-only and safe to expose.
//
// The quantity is clamped rather than trusted: a percentage code priced against
// a basket of 10,000 books would preview a discount the payment sheet would
// never honour, which reads as a broken shop.
//
// Refuses outright while the promo field is switched off (0042). The checkout
// stops drawing the box, so nothing legitimate calls this — but an endpoint
// that keeps happily pricing codes is a way to find out which ones are live,
// and it would preview a discount /api/orders/create is now going to ignore.
export async function POST(request: NextRequest) {
  try {
    if (!promoCodeAllowed(await getCheckoutSettings())) {
      return NextResponse.json(
        { success: false, error: "Promo codes aren't available right now." },
        { status: 400 }
      );
    }

    const body = await request.json();
    const code = body?.code;
    const quantity = clampQuantity(body?.quantity ?? 1);
    const { payablePaise } = await getProductPricing();
    const result = await validatePromo(code || "", payablePaise * quantity);

    if (!result.valid) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      code: result.code,
      discountPaise: result.discountPaise,
      finalPaise: result.finalPaise,
    });
  } catch (err) {
    console.error("[/api/promo/validate] Error:", err);
    return NextResponse.json(
      { success: false, error: "Could not validate code." },
      { status: 500 }
    );
  }
}

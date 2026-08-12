export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { validatePromo } from "@/lib/db/promo";
import { getProductPricing } from "@/lib/db/courses";
import { clampQuantity } from "@/lib/quantity";

// POST { code, quantity } — validate a promo code against the current basket.
// Returns the discount + final amount (in paise) for display. The order route
// re-validates server-side, so this is display-only and safe to expose.
//
// The quantity is clamped rather than trusted: a percentage code priced against
// a basket of 10,000 books would preview a discount the payment sheet would
// never honour, which reads as a broken shop.
export async function POST(request: NextRequest) {
  try {
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

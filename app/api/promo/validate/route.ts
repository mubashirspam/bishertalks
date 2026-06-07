export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { validatePromo } from "@/lib/db/promo";
import { getProductPricing } from "@/lib/db/courses";

// POST { code } — validate a promo code against the current product price.
// Returns the discount + final amount (in paise) for display. The order route
// re-validates server-side, so this is display-only and safe to expose.
export async function POST(request: NextRequest) {
  try {
    const { code } = await request.json();
    const { payablePaise } = await getProductPricing();
    const result = await validatePromo(code || "", payablePaise);

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

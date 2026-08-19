export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/admin-auth";
import { updateCheckoutSettings } from "@/lib/db/checkout-settings";
import { audit } from "@/lib/audit";

/**
 * Show or hide the promo code field at checkout.
 *
 * Gated on `promos.manage`, the same permission that creates the codes — this
 * decides whether any of them can be entered at all, which is the same question
 * one step up. A new capability would have to be granted to every existing
 * owner before the screen worked for anyone.
 */
export async function PATCH(request: NextRequest) {
  const auth = await requirePermission("promos.manage");
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({}));

  const saved = await updateCheckoutSettings({
    // Strict equality, not truthiness: an absent field must not read as "on".
    promoFieldIsEnabled: body.promo_field_is_enabled === true,
  });

  if (!saved) {
    return NextResponse.json({ error: "Could not save" }, { status: 500 });
  }

  // Worth a trail. "When did the promo box disappear?" is a question someone
  // will ask, most likely a customer support conversation about a code that
  // suddenly could not be entered.
  await audit({
    actor: auth.staff,
    action: "checkout.settings.update",
    entity: "checkout_settings",
    meta: { promo_field_is_enabled: saved.promoFieldIsEnabled },
  });

  // The checkout is force-dynamic, so it picks this up on the next request by
  // itself. This is for the admin screen that just posted the change.
  revalidatePath("/admin/promos");

  return NextResponse.json({ ok: true, settings: saved });
}

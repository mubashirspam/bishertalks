export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/admin-auth";
import { updateGiftSettings } from "@/lib/db/gift";
import { MAX_GIFT_CHARGE_PAISE } from "@/lib/gift";
import { audit } from "@/lib/audit";

/**
 * Turn gift wrapping on or off, and set what it costs.
 *
 * Gated on `promos.manage` rather than a new permission of its own: that is
 * already "who decides what a customer pays at checkout", which is exactly what
 * this is. A new capability would have to be granted to every existing owner
 * before the screen worked for anyone.
 */
export async function PATCH(request: NextRequest) {
  const auth = await requirePermission("promos.manage");
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({}));

  // Rupees in the form, paise in the column. Rounded rather than truncated so
  // a pasted "59.5" becomes ₹60 instead of ₹59.50 — the fee is a whole-rupee
  // amount everywhere it is shown.
  const rupees = Number(body.charge_rupees);
  if (!Number.isFinite(rupees) || rupees < 0) {
    return NextResponse.json(
      { error: "Enter the wrapping fee in rupees." },
      { status: 400 }
    );
  }

  const chargePaise = Math.round(rupees) * 100;
  if (chargePaise > MAX_GIFT_CHARGE_PAISE) {
    // Not a taste judgement — orders.gift_charge_paise has a CHECK at this
    // number (0027), so a higher fee would price a charge that the order row
    // then refuses to store, and every gift checkout would fail at the last
    // step. Refuse it here, where someone can read why.
    return NextResponse.json(
      { error: `The most wrapping can cost is ₹${MAX_GIFT_CHARGE_PAISE / 100}.` },
      { status: 400 }
    );
  }

  const saved = await updateGiftSettings({
    isEnabled: body.is_enabled === true,
    chargePaise,
  });

  if (!saved) {
    return NextResponse.json({ error: "Could not save" }, { status: 500 });
  }

  // Worth a trail: this changes what every subsequent customer is charged, and
  // "when did wrapping go up to ₹79?" is a question someone will ask.
  await audit({
    actor: auth.staff,
    action: "gift.settings.update",
    entity: "gift_settings",
    meta: { is_enabled: saved.isEnabled, charge_paise: saved.chargePaise },
  });

  // The checkout is force-dynamic, so it picks this up on the next request by
  // itself. This is for the admin screen that just posted the change.
  revalidatePath("/admin/promos");

  return NextResponse.json({ ok: true, settings: saved });
}

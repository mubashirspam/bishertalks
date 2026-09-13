export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-auth";
import { setPincodeOverride } from "@/lib/db/pincode-stats";

/**
 * Pin a pincode's Delhivery eligibility by hand, or clear a pin.
 *
 * Gated on `delivery.assign` — the same trust as routing a courier, since
 * this is the same decision one step earlier: which pincodes are even worth
 * offering Delhivery in the first place. See setPincodeOverride for why the
 * override survives the next automatic recompute instead of being clobbered
 * by it.
 */
export async function POST(request: NextRequest) {
  const auth = await requirePermission("delivery.assign");
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({}));
  const pincode = typeof body.pincode === "string" ? body.pincode : "";
  const override =
    body.override === true ? true : body.override === false ? false : null;
  const reason = typeof body.reason === "string" ? body.reason.slice(0, 300) : null;

  if (!pincode) {
    return NextResponse.json({ error: "Missing pincode" }, { status: 400 });
  }

  const result = await setPincodeOverride(pincode, override, auth.staff, reason);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  return NextResponse.json({ ok: true });
}

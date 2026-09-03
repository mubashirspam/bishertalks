export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-auth";
import { recordMovement, MOVEMENT_KINDS, type MovementKind } from "@/lib/db/inventory";
import { audit } from "@/lib/audit";

/**
 * Write down something that happened to the books.
 *
 * Everything orders cannot account for: a damaged copy, one given to the
 * author, a stocktake that disagreed with the system, a returned parcel opened
 * and judged sellable again.
 *
 * Answers to `inventory.manage` rather than `inventory.view`, because this is
 * the difference between reading the shelf and rewriting it. A number typed
 * here moves every figure on the stock screen and, through the low-stock
 * warning, decides whether the shop thinks it can keep selling.
 *
 * The rules live in `recordMovement`; this is the permission and the trail.
 */
export async function POST(request: NextRequest) {
  const auth = await requirePermission("inventory.manage");
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({}));

  const kind = body.kind as MovementKind;
  if (!MOVEMENT_KINDS.includes(kind)) {
    return NextResponse.json({ error: "Unknown kind of movement" }, { status: 400 });
  }

  const result = await recordMovement({
    kind,
    copies: Number(body.copies),
    reason: typeof body.reason === "string" ? body.reason : "",
    orderNumber: typeof body.order_number === "string" ? body.order_number : null,
    actorId: auth.staff.id,
    actorEmail: auth.staff.email,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  // The movement row already carries who and why. This is the shop-wide trail,
  // where a stock write-off sits beside the order edits and status changes it
  // will need to be read against.
  await audit({
    actor: auth.staff,
    action: "inventory.movement",
    entity: "stock",
    entityId: kind,
    meta: {
      kind,
      copies: Math.trunc(Number(body.copies)),
      reason: String(body.reason ?? "").trim(),
      ...(body.order_number ? { order_number: body.order_number } : {}),
    },
  });

  return NextResponse.json({ ok: true });
}

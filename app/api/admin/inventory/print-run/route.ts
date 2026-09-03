export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-auth";
import { recordPrintRun } from "@/lib/db/inventory";
import { audit } from "@/lib/audit";

/**
 * Record a delivery from the printer.
 *
 * The only thing that adds books in quantity, and the reason `print_runs` is a
 * table rather than the constant it could have been: a fifth edition should
 * need somebody to type a number, not a deploy.
 *
 * Books count from when they ARRIVED, not from when the run was ordered — a
 * run still on the press is not stock, and dating it earlier would show the
 * shop covered on a day it was not.
 */
export async function POST(request: NextRequest) {
  const auth = await requirePermission("inventory.manage");
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({}));

  // Rupees on the wire, paise in the database — the same split every other
  // money field in this project uses, so nobody has to remember which screen
  // multiplies by a hundred.
  const rupees = Number(body.unit_cost_rupees);
  const unitCostPaise =
    Number.isFinite(rupees) && rupees > 0 ? Math.round(rupees * 100) : null;

  const result = await recordPrintRun({
    edition: Number(body.edition),
    copies: Number(body.copies),
    receivedOn: typeof body.received_on === "string" ? body.received_on : "",
    unitCostPaise,
    printer: typeof body.printer === "string" ? body.printer : null,
    note: typeof body.note === "string" ? body.note : null,
    actorId: auth.staff.id,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  await audit({
    actor: auth.staff,
    action: "inventory.print_run",
    entity: "stock",
    entityId: String(body.edition),
    meta: {
      edition: Math.trunc(Number(body.edition)),
      copies: Math.trunc(Number(body.copies)),
      received_on: body.received_on,
      ...(unitCostPaise ? { unit_cost_paise: unitCostPaise } : {}),
    },
  });

  return NextResponse.json({ ok: true });
}

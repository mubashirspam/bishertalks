export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-auth";
import { setSendingPaused } from "@/lib/crm/contacts";
import { audit } from "@/lib/audit";

/**
 * The kill switch.
 *
 * One row, one boolean, and every send in the system reads it — order
 * notifications included. If something is wrong enough to press this, it is
 * wrong enough to stop everything, so there is no "pause campaigns only"
 * variant here: that is what pausing a campaign is for.
 *
 * Behind `crm.campaign` rather than a settings permission, because the people
 * trusted to start a bulk send are exactly the people who need to be able to
 * stop one at speed.
 */
export async function POST(request: NextRequest) {
  const auth = await requirePermission("crm.campaign");
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({}));
  const paused = body.paused === true;
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";

  if (paused && !reason) {
    return NextResponse.json(
      { error: "Say why sending is being paused — it shows on the screen until it's lifted." },
      { status: 400 }
    );
  }

  await setSendingPaused(paused, reason || null, auth.staff.email);

  await audit({
    actor: auth.staff,
    action: paused ? "crm.sending.paused" : "crm.sending.resumed",
    entity: "whatsapp_settings",
    entityId: null,
    meta: { reason: reason || null },
  });

  return NextResponse.json({ ok: true, paused });
}

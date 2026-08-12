export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-auth";
import { assignOrders } from "@/lib/db/delivery";
import { listDeliveryAgents } from "@/lib/db/staff";
import { auditMany } from "@/lib/audit";

const MAX_BATCH = 300;

/**
 * Hand a batch of parcels to a delivery agent, or take them back.
 *
 * This replaced the bulk status endpoint that used to live next door. The
 * delivery list no longer marks anything shipped or delivered — those are the
 * agent's to tick in the portal, on the parcels they are actually holding —
 * so the one thing this screen writes is who is holding what.
 *
 *   { order_numbers: [...], agent_id: "uuid" }   assign
 *   { order_numbers: [...], agent_id: null }     unassign, back to New
 */
export async function POST(request: NextRequest) {
  const auth = await requirePermission("delivery.assign");
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({}));

  const orderNumbers: string[] = Array.isArray(body.order_numbers)
    ? body.order_numbers.filter((n: unknown) => typeof n === "string")
    : [];

  if (!orderNumbers.length) {
    return NextResponse.json({ error: "No orders selected" }, { status: 400 });
  }
  if (orderNumbers.length > MAX_BATCH) {
    return NextResponse.json(
      { error: `Too many orders — ${MAX_BATCH} at a time` },
      { status: 400 }
    );
  }

  const agentId = typeof body.agent_id === "string" ? body.agent_id : null;

  // Check the target against the same list the picker was built from, rather
  // than trusting an id off the wire. Otherwise any staff id — a support
  // account, someone switched off — could be given parcels they will never
  // see, and the work would sit in a portal nobody opens.
  let agentName: string | null = null;
  if (agentId) {
    const agent = (await listDeliveryAgents()).find((a) => a.id === agentId);
    if (!agent) {
      return NextResponse.json(
        { error: "That person isn't a delivery agent — give them portal access first." },
        { status: 400 }
      );
    }
    agentName = agent.name;
  }

  try {
    const updated = await assignOrders(orderNumbers, agentId, auth.staff.id);

    await auditMany(auth.staff, "order.assigned", "order", updated, {
      agent_id: agentId,
      agent_name: agentName,
    });

    return NextResponse.json({
      updated: updated.length,
      agent_id: agentId,
      agent_name: agentName,
    });
  } catch (e) {
    console.error("[Delivery assign] failed:", e);
    return NextResponse.json({ error: "Assignment failed" }, { status: 500 });
  }
}

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { CurrentStaff } from "@/lib/admin-auth";

/**
 * Who did what.
 *
 * Only worth having now that more than one person can change an order — before
 * staff accounts, the answer to "who marked this delivered?" was always the
 * same. Written from the routes that change something a customer would notice.
 *
 * Never throws: an audit failure must not roll back work that already
 * happened. A missing log line is a smaller problem than an order that looks
 * unshipped because logging it failed.
 */
export interface AuditEntry {
  actor: CurrentStaff | null;
  action: string;
  entity: string;
  entityId?: string | null;
  meta?: Record<string, unknown>;
}

export async function audit(entry: AuditEntry): Promise<void> {
  try {
    await supabaseAdmin.from("audit_log").insert({
      // Null for the ADMIN_EMAIL fallback owner, who has no staff row. The
      // email is stored either way, so the trail is still readable.
      actor_id: entry.actor?.id ?? null,
      actor_email: entry.actor?.email ?? "system",
      action: entry.action,
      entity: entry.entity,
      entity_id: entry.entityId ?? null,
      meta: entry.meta ?? null,
    });
  } catch (e) {
    console.error("[Audit] write failed:", entry.action, e);
  }
}

/** Several orders changed by one click — one row each, one insert. */
export async function auditMany(
  actor: CurrentStaff | null,
  action: string,
  entity: string,
  entityIds: string[],
  meta?: Record<string, unknown>
): Promise<void> {
  if (!entityIds.length) return;
  try {
    await supabaseAdmin.from("audit_log").insert(
      entityIds.map((id) => ({
        actor_id: actor?.id ?? null,
        actor_email: actor?.email ?? "system",
        action,
        entity,
        entity_id: id,
        meta: meta ?? null,
      }))
    );
  } catch (e) {
    console.error("[Audit] bulk write failed:", action, e);
  }
}

export interface AuditRow {
  id: number;
  actor_email: string | null;
  action: string;
  meta: Record<string, unknown> | null;
  created_at: string;
}

/** History for one entity, newest first. Drives the order detail strip. */
export async function getAuditTrail(
  entity: string,
  entityId: string,
  limit = 20
): Promise<AuditRow[]> {
  const { data } = await supabaseAdmin
    .from("audit_log")
    .select("id,actor_email,action,meta,created_at")
    .eq("entity", entity)
    .eq("entity_id", entityId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data as AuditRow[]) ?? [];
}

/** Plain-English description of a log row. */
export function describeAudit(row: AuditRow): string {
  const m = row.meta ?? {};
  switch (row.action) {
    case "order.status":
      return `Status changed to ${m.status ?? "?"}${m.courier ? ` (${m.courier})` : ""}`;
    case "labels.printed":
      return `Address label printed`;
    case "labels.unprinted":
      return `Label print undone`;
    case "order.updated":
      return `Order details updated`;
    case "order.payment_link":
      return `Payment link generated (₹${Math.round(Number(m.amount_paise ?? 0) / 100)})`;
    case "order.address":
      return `Delivery address edited manually`;
    default:
      return row.action;
  }
}

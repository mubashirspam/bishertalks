export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-auth";
import {
  setDeliveryStatus,
  markLabelsDownloaded,
  unmarkLabelsDownloaded,
  notifyStatusChange,
} from "@/lib/db/delivery";
import { BULK_STATUSES } from "@/lib/delivery-stage";
import { auditMany } from "@/lib/audit";
import type { OrderStatus } from "@/lib/types/order";

const MAX_BATCH = 300;

type Action = "status" | "mark_printed" | "unmark_printed";
const ACTIONS: Action[] = ["status", "mark_printed", "unmark_printed"];

/**
 * Bulk actions on the delivery queue.
 *
 * Deliberately one endpoint for all three: they take the same input (a list of
 * order numbers), have the same permissions, and the UI calls them from the
 * same toolbar. Three near-identical routes would drift.
 */
export async function POST(request: NextRequest) {
  const auth = await requirePermission("delivery.status");
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({}));

  const action = body.action as Action;
  if (!ACTIONS.includes(action)) {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

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

  try {
    if (action === "mark_printed") {
      const updated = await markLabelsDownloaded(orderNumbers);
      await auditMany(auth.staff, "labels.printed", "order", updated);
      return NextResponse.json({ updated: updated.length });
    }

    if (action === "unmark_printed") {
      const updated = await unmarkLabelsDownloaded(orderNumbers);
      await auditMany(auth.staff, "labels.unprinted", "order", updated);
      return NextResponse.json({ updated: updated.length });
    }

    const status = body.status as OrderStatus;
    if (!BULK_STATUSES.includes(status)) {
      return NextResponse.json({ error: "Unknown status" }, { status: 400 });
    }

    const courier =
      typeof body.courier_name === "string" ? body.courier_name.trim() : null;

    const updated = await setDeliveryStatus(orderNumbers, status, courier);

    await auditMany(auth.staff, "order.status", "order", updated, {
      status,
      ...(courier ? { courier } : {}),
    });

    // Only the rows that actually changed get a message.
    const notified = await notifyStatusChange(updated, status);

    return NextResponse.json({ updated: updated.length, notified });
  } catch (e) {
    console.error("[Delivery bulk] failed:", e);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}

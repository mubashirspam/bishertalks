export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getStaffById } from "@/lib/db/staff";
import { createTask } from "@/lib/db/tasks";
import { isTaskCategory, isTaskPriority } from "@/lib/tasks";
import { notifyCustomerTaskRegistered } from "@/lib/crm/task-notify";

/**
 * Create a task.
 *
 * The customer/order snapshot is re-derived from `order_id` here rather than
 * trusted off the wire whenever one is given — a client that sends a mismatched
 * id and name would otherwise write a task that lies about who it's for. Only
 * "enter manually" (no order_id) takes the typed name/phone as they are, which
 * is the whole point of that path — there is nothing in the system to check
 * them against.
 */
export async function POST(request: NextRequest) {
  // Creating — and, in the same request, choosing who it goes to — is a
  // tasks.manage act. tasks.view is the narrower "work what's already
  // assigned to me" tier and has no create button in the UI; this is the
  // matching server-side refusal for anyone who reaches the route anyway.
  const auth = await requirePermission("tasks.manage");
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({}));
  const title = String(body.title ?? "").trim();
  if (!title) {
    return NextResponse.json({ error: "Enter a title." }, { status: 400 });
  }

  const category = isTaskCategory(body.category) ? body.category : "other";
  const priority = isTaskPriority(body.priority) ? body.priority : "normal";
  const description = typeof body.description === "string" ? body.description.trim() : null;

  let orderId: string | null = null;
  let orderNumber: string | null = null;
  let customerName: string | null = null;
  let customerPhone: string | null = null;

  const rawOrderId = typeof body.order_id === "string" ? body.order_id.trim() : "";
  if (rawOrderId) {
    const { data: order } = await supabaseAdmin
      .from("orders")
      .select("id, order_number, buyer_name, buyer_phone")
      .eq("id", rawOrderId)
      .maybeSingle();
    if (!order) {
      return NextResponse.json({ error: "That order could not be found." }, { status: 400 });
    }
    orderId = order.id;
    orderNumber = order.order_number;
    customerName = order.buyer_name;
    customerPhone = order.buyer_phone;
  } else {
    customerName = typeof body.customer_name === "string" ? body.customer_name.trim() || null : null;
    customerPhone = typeof body.customer_phone === "string" ? body.customer_phone.trim() || null : null;
  }

  let assignedToId: string | null = null;
  let assignedToEmail: string | null = null;
  const rawAssignee = typeof body.assigned_to_id === "string" ? body.assigned_to_id.trim() : "";
  if (rawAssignee) {
    const assignee = await getStaffById(rawAssignee);
    if (!assignee || !assignee.is_active) {
      return NextResponse.json({ error: "Pick an active staff member to assign." }, { status: 400 });
    }
    assignedToId = assignee.id;
    assignedToEmail = assignee.email;
  }

  const task = await createTask(
    {
      title,
      description,
      category,
      priority,
      orderId,
      orderNumber,
      customerName,
      customerPhone,
      assignedToId,
      assignedToEmail,
    },
    auth.staff
  );

  if (!task) {
    return NextResponse.json({ error: "Could not create the task." }, { status: 500 });
  }

  // Off by default, and off is the common case — most tasks are internal and
  // have nobody to notify. Only ever attempted when the box was ticked AND
  // there's a phone to send to; never blocks the response either way.
  if (body.notify_customer === true && task.customer_phone) {
    notifyCustomerTaskRegistered(task, auth.staff).catch((e) =>
      console.error("[Tasks] notify failed:", task.id, e)
    );
  }

  return NextResponse.json({ task });
}

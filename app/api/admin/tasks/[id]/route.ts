export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-auth";
import { getStaffById, listStaff } from "@/lib/db/staff";
import { getTask, updateTask } from "@/lib/db/tasks";
import { getAuditTrail } from "@/lib/audit";
import { isTaskCategory, isTaskPriority, isTaskStatus } from "@/lib/tasks";

/**
 * The detail page is a client component (it needs to be editable in place),
 * so it can't call listStaff() itself — this carries the assignee list along
 * with the task rather than adding a second endpoint just to list staff.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePermission("tasks.view");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const task = await getTask(id);
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [history, staff] = await Promise.all([
    getAuditTrail("task", id, 50),
    listStaff(),
  ]);
  return NextResponse.json({ task, history, staff });
}

/**
 * Change a task — status, priority, category, assignee, or the text. Any
 * subset; only what's present in the body is touched, so the row's inline
 * status `<select>` can PATCH just `{ status }` without clobbering the rest.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePermission("tasks.view");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const existing = await getTask(id);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const patch: Parameters<typeof updateTask>[1] = {};

  if (typeof body.title === "string") {
    const title = body.title.trim();
    if (!title) return NextResponse.json({ error: "Title can't be empty." }, { status: 400 });
    patch.title = title;
  }
  if (typeof body.description === "string" || body.description === null) {
    patch.description = body.description;
  }
  if (body.category !== undefined) {
    if (!isTaskCategory(body.category)) {
      return NextResponse.json({ error: "Unknown category." }, { status: 400 });
    }
    patch.category = body.category;
  }
  if (body.priority !== undefined) {
    if (!isTaskPriority(body.priority)) {
      return NextResponse.json({ error: "Unknown priority." }, { status: 400 });
    }
    patch.priority = body.priority;
  }
  if (body.status !== undefined) {
    if (!isTaskStatus(body.status)) {
      return NextResponse.json({ error: "Unknown status." }, { status: 400 });
    }
    patch.status = body.status;
  }

  // Present in the body at all (including explicit null, which unassigns) —
  // undefined is how "don't touch this" is spelled in JSON.
  if ("assigned_to_id" in body) {
    const raw = typeof body.assigned_to_id === "string" ? body.assigned_to_id.trim() : "";
    if (!raw) {
      patch.assignedToId = null;
      patch.assignedToEmail = null;
    } else {
      const assignee = await getStaffById(raw);
      if (!assignee || !assignee.is_active) {
        return NextResponse.json({ error: "Pick an active staff member to assign." }, { status: 400 });
      }
      patch.assignedToId = assignee.id;
      patch.assignedToEmail = assignee.email;
    }
  }

  const task = await updateTask(id, patch, auth.staff);
  if (!task) return NextResponse.json({ error: "Could not update the task." }, { status: 500 });

  return NextResponse.json({ task });
}

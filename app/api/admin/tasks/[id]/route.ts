export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermissionAny } from "@/lib/admin-auth";
import { taskScope, mayTouchTask } from "@/lib/tasks-scope";
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
  const auth = await requirePermissionAny(["tasks.view", "tasks.manage"]);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const task = await getTask(id);
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // A tasks.view-only login opening a task that isn't theirs gets the same
  // "not found" a stranger would — not a 403, which would confirm the task
  // exists and just isn't theirs to see.
  const scope = taskScope(auth.staff);
  if (!mayTouchTask(scope, task.assigned_to_id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const [history, staff] = await Promise.all([
    getAuditTrail("task", id, 50),
    listStaff(),
  ]);
  // Carried along so the detail page can hide the controls PATCH would 403
  // on, rather than offering them and only saying so after a failed save.
  return NextResponse.json({ task, history, staff, canManage: scope.seesEveryone });
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
  const auth = await requirePermissionAny(["tasks.view", "tasks.manage"]);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const existing = await getTask(id);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const scope = taskScope(auth.staff);
  if (!mayTouchTask(scope, existing.assigned_to_id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const patch: Parameters<typeof updateTask>[1] = {};

  // A tasks.view-only login works their own task, not the record of it — the
  // title, category, priority and who it's assigned to are tasks.manage's to
  // change. Status, and the resolution that goes with a solve, are the job
  // itself: marking a task in progress or solved, and saying how, is the
  // whole reason they can see it at all.
  const SCOPED_KEYS = new Set([
    "status", "resolution_note", "resolution_tracking_id", "status_note",
  ]);
  if (!scope.seesEveryone) {
    const extraKeys = Object.keys(body).filter((k) => !SCOPED_KEYS.has(k));
    if (extraKeys.length) {
      return NextResponse.json(
        { error: "You can only update the status of your own tasks." },
        { status: 403 }
      );
    }
  }

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
  if (typeof body.status_note === "string" || body.status_note === null) {
    patch.statusNote = body.status_note;
  }
  if (typeof body.resolution_note === "string" || body.resolution_note === null) {
    patch.resolutionNote = body.resolution_note;
  }
  if (typeof body.resolution_tracking_id === "string" || body.resolution_tracking_id === null) {
    patch.resolutionTrackingId = body.resolution_tracking_id;
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

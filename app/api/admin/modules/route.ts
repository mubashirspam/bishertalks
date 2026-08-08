export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-auth";
import {
  createModule,
  updateModule,
  deleteModule,
  reorderModules,
} from "@/lib/db/courses-admin";

// POST { courseId, title } — add a module.
export async function POST(request: NextRequest) {
  const auth = await requirePermission("courses.manage");
  if (!auth.ok) return auth.response;
  const { courseId, title } = await request.json();
  if (!courseId || !String(title ?? "").trim()) {
    return NextResponse.json({ error: "Course and title are required." }, { status: 400 });
  }
  try {
    const module = await createModule(courseId, String(title).trim());
    return NextResponse.json({ success: true, module });
  } catch {
    return NextResponse.json({ error: "Failed to add module." }, { status: 500 });
  }
}

// PATCH { id, title } | { action: 'reorder', orderedIds } — rename or reorder.
export async function PATCH(request: NextRequest) {
  const auth = await requirePermission("courses.manage");
  if (!auth.ok) return auth.response;
  const body = await request.json();
  try {
    if (body.action === "reorder") {
      if (!Array.isArray(body.orderedIds)) {
        return NextResponse.json({ error: "Invalid order." }, { status: 400 });
      }
      await reorderModules(body.orderedIds);
      return NextResponse.json({ success: true });
    }
    if (!body.id || !String(body.title ?? "").trim()) {
      return NextResponse.json({ error: "Title is required." }, { status: 400 });
    }
    await updateModule(body.id, String(body.title).trim());
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Failed to update module." }, { status: 500 });
  }
}

// DELETE { id } — delete a module (cascades its lessons).
export async function DELETE(request: NextRequest) {
  const auth = await requirePermission("courses.manage");
  if (!auth.ok) return auth.response;
  const { id } = await request.json();
  if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
  try {
    await deleteModule(id);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Failed to delete module." }, { status: 500 });
  }
}

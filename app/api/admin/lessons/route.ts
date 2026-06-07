export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import {
  createLesson,
  updateLesson,
  deleteLesson,
  reorderLessons,
  type LessonFields,
} from "@/lib/db/courses-admin";

const slugify = (s: string) =>
  s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

function parseLesson(body: Record<string, unknown>): LessonFields | { error: string } {
  const title = String(body.title ?? "").trim();
  const url = String(body.url ?? "").trim();
  const type = body.type === "pdf" ? "pdf" : "video";
  if (!title) return { error: "A title is required." };
  if (!url) return { error: "A URL is required." };
  const slug = slugify(String(body.slug ?? "") || title);
  const duration =
    typeof body.duration === "string" && body.duration.trim() ? body.duration.trim() : null;
  return { slug, title, type, url, duration };
}

// POST { moduleId, ...fields } — add a lesson.
export async function POST(request: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json();
  if (!body.moduleId) {
    return NextResponse.json({ error: "Missing module." }, { status: 400 });
  }
  const parsed = parseLesson(body);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  try {
    const lesson = await createLesson(body.moduleId, parsed);
    return NextResponse.json({ success: true, lesson });
  } catch {
    return NextResponse.json({ error: "Failed to add lesson." }, { status: 500 });
  }
}

// PATCH { id, ...fields } | { action: 'reorder', orderedIds } — edit or reorder.
export async function PATCH(request: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json();
  try {
    if (body.action === "reorder") {
      if (!Array.isArray(body.orderedIds)) {
        return NextResponse.json({ error: "Invalid order." }, { status: 400 });
      }
      await reorderLessons(body.orderedIds);
      return NextResponse.json({ success: true });
    }
    if (!body.id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
    const parsed = parseLesson(body);
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    await updateLesson(body.id, parsed);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Failed to update lesson." }, { status: 500 });
  }
}

// DELETE { id } — delete a lesson.
export async function DELETE(request: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await request.json();
  if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
  try {
    await deleteLesson(id);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Failed to delete lesson." }, { status: 500 });
  }
}

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-auth";
import {
  createCourse,
  updateCourse,
  deleteCourse,
  type CourseFields,
} from "@/lib/db/courses-admin";

const slugify = (s: string) =>
  s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

function toInt(v: unknown): number | null {
  if (v === "" || v == null) return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Build a validated CourseFields from a request body. */
function parseCourse(body: Record<string, unknown>): CourseFields | { error: string } {
  const slug = slugify(String(body.slug ?? ""));
  const title = String(body.title ?? "").trim();
  if (!slug) return { error: "A slug is required." };
  if (!title) return { error: "A title is required." };

  const price = toInt(body.price);
  const offer_price = toInt(body.offer_price);
  if (price != null && price <= 0) return { error: "Price must be greater than 0." };
  if (offer_price != null && price != null && offer_price >= price) {
    return { error: "Offer price must be less than the price." };
  }

  const str = (v: unknown) => {
    const t = typeof v === "string" ? v.trim() : "";
    return t || null;
  };

  return {
    slug,
    title,
    subtitle: str(body.subtitle),
    description: str(body.description),
    thumbnail: str(body.thumbnail),
    price,
    offer_price,
    is_locked: body.is_locked !== false,
  };
}

// POST — create a course.
export async function POST(request: NextRequest) {
  const auth = await requirePermission("courses.manage");
  if (!auth.ok) return auth.response;
  const parsed = parseCourse(await request.json());
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  try {
    const course = await createCourse(parsed);
    return NextResponse.json({ success: true, course });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create course.";
    const friendly = /duplicate key/i.test(msg) ? "That slug already exists." : msg;
    return NextResponse.json({ error: friendly }, { status: 400 });
  }
}

// PATCH { id, ...fields } — update a course (all fields).
export async function PATCH(request: NextRequest) {
  const auth = await requirePermission("courses.manage");
  if (!auth.ok) return auth.response;
  const body = await request.json();
  const id = String(body.id ?? "");
  if (!id) return NextResponse.json({ error: "Missing course id." }, { status: 400 });

  const parsed = parseCourse(body);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  try {
    await updateCourse(id, parsed);
    return NextResponse.json({ success: true, slug: parsed.slug });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to update course.";
    const friendly = /duplicate key/i.test(msg) ? "That slug already exists." : msg;
    return NextResponse.json({ error: friendly }, { status: 400 });
  }
}

// DELETE { id } — delete a course (cascades modules, lessons, access).
export async function DELETE(request: NextRequest) {
  const auth = await requirePermission("courses.manage");
  if (!auth.ok) return auth.response;
  const { id } = await request.json();
  if (!id) return NextResponse.json({ error: "Missing course id." }, { status: 400 });
  try {
    await deleteCourse(id);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Failed to delete course." }, { status: 500 });
  }
}

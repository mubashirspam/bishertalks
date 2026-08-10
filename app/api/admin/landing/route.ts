export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-auth";
import {
  createTestimonial,
  updateTestimonial,
  deleteTestimonial,
  moveTestimonial,
  updateLandingSettings,
  sanitizeTestimonial,
  TESTIMONIAL_KINDS,
  type TestimonialKind,
} from "@/lib/db/landing";
import { audit } from "@/lib/audit";

/**
 * Landing page CMS.
 *
 * One route for testimonials and settings: same permission, same screen, same
 * shape of request. Splitting them would mean two files that always change
 * together.
 */

const isKind = (v: unknown): v is TestimonialKind =>
  typeof v === "string" && (TESTIMONIAL_KINDS as string[]).includes(v);

/** Create a testimonial. */
export async function POST(request: NextRequest) {
  const auth = await requirePermission("landing.manage");
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({}));

  if (!isKind(body.kind)) {
    return NextResponse.json({ error: "Pick a testimonial type." }, { status: 400 });
  }
  if (!String(body.name ?? "").trim()) {
    return NextResponse.json({ error: "Enter a name." }, { status: 400 });
  }

  const fields = sanitizeTestimonial(body);
  const created = await createTestimonial(fields);
  if (!created) {
    return NextResponse.json({ error: "Could not save" }, { status: 500 });
  }

  await audit({
    actor: auth.staff,
    action: "landing.testimonial_created",
    entity: "testimonial",
    entityId: created.id,
    meta: { kind: created.kind, name: created.name },
  });

  return NextResponse.json({ testimonial: created });
}

/** Update a testimonial, reorder one, or save the page settings. */
export async function PATCH(request: NextRequest) {
  const auth = await requirePermission("landing.manage");
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({}));

  if (body.scope === "settings") {
    const patch: Record<string, unknown> = {};
    if (typeof body.explainer_youtube_id === "string")
      patch.explainer_youtube_id = body.explainer_youtube_id.trim() || null;
    if ("explainer_video_url" in body)
      patch.explainer_video_url = body.explainer_video_url || null;
    if (typeof body.explainer_length === "string")
      patch.explainer_length = body.explainer_length.trim() || null;
    if (typeof body.show_placeholders === "boolean")
      patch.show_placeholders = body.show_placeholders;

    const settings = await updateLandingSettings(patch);
    if (!settings) return NextResponse.json({ error: "Could not save" }, { status: 500 });

    await audit({
      actor: auth.staff,
      action: "landing.settings",
      entity: "landing",
      meta: patch,
    });
    return NextResponse.json({ settings });
  }

  const id = String(body.id ?? "");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  if (body.move === "up" || body.move === "down") {
    await moveTestimonial(id, body.move);
    return NextResponse.json({ ok: true });
  }

  const fields = sanitizeTestimonial(body);
  if (!Object.keys(fields).length) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  if (!(await updateTestimonial(id, fields))) {
    return NextResponse.json({ error: "Could not save" }, { status: 500 });
  }

  await audit({
    actor: auth.staff,
    action: "landing.testimonial_updated",
    entity: "testimonial",
    entityId: id,
    meta: fields,
  });

  return NextResponse.json({ ok: true });
}

/**
 * Remove a testimonial.
 *
 * The row goes; the file stays in ImageKit. Deleting the media too would need
 * broader API credentials, and an orphaned file costs pennies where a wrongly
 * deleted one is gone for good.
 */
export async function DELETE(request: NextRequest) {
  const auth = await requirePermission("landing.manage");
  if (!auth.ok) return auth.response;

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  if (!(await deleteTestimonial(id))) {
    return NextResponse.json({ error: "Could not remove" }, { status: 500 });
  }

  await audit({
    actor: auth.staff,
    action: "landing.testimonial_removed",
    entity: "testimonial",
    entityId: id,
  });

  return NextResponse.json({ ok: true });
}

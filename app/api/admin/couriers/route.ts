export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isCourierHandoff } from "@/lib/couriers";
import { audit } from "@/lib/audit";

/**
 * Managing the list of logistics partners.
 *
 * This is the screen that makes "we might use Speed Post, or hand some to a
 * rider" cost nothing: a partner with a `manual` handoff works the day it is
 * added, with no code. Only an `api` partner needs an integration written, and
 * the UI says so rather than letting someone pick a setting that does nothing.
 *
 * Gated on `delivery.assign` — the same authority that decides which courier a
 * parcel goes to, since adding one to the list is the same decision made once.
 */

/** A stable, code-facing handle derived from the name someone typed. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export async function POST(request: NextRequest) {
  const auth = await requirePermission("delivery.assign");
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({}));

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "Give the courier a name." }, { status: 400 });
  }

  const handoff = isCourierHandoff(body.handoff) ? body.handoff : "manual";
  const slug = slugify(name);

  if (!slug) {
    return NextResponse.json(
      { error: "That name has no letters or numbers in it." },
      { status: 400 }
    );
  }

  const { data, error } = await supabaseAdmin
    .from("couriers")
    .insert({
      name,
      slug,
      handoff,
      config: cleanConfig(body.config),
      sort_order: Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : 50,
    })
    .select("id,name,slug,handoff")
    .single();

  if (error) {
    // The unique index on slug is the likely one, and "already exists" is a
    // more useful thing to read than a Postgres error code.
    const duplicate = error.message.includes("duplicate") || error.code === "23505";
    console.error("[Couriers] create failed:", error.message);
    return NextResponse.json(
      {
        error: duplicate
          ? `There is already a courier called something like "${name}".`
          : "Could not add that courier.",
      },
      { status: duplicate ? 409 : 500 }
    );
  }

  await audit({
    actor: auth.staff,
    action: "courier.created",
    entity: "courier",
    entityId: data.id,
    meta: { name, slug, handoff },
  });

  return NextResponse.json({ ok: true, courier: data });
}

export async function PATCH(request: NextRequest) {
  const auth = await requirePermission("delivery.assign");
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({}));
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "Which courier?" }, { status: 400 });

  // The slug is never editable. It is what an adapter is selected by, so
  // renaming a partner must not be able to unhook its integration.
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
  if (typeof body.is_active === "boolean") patch.is_active = body.is_active;
  if (isCourierHandoff(body.handoff)) patch.handoff = body.handoff;
  if (body.config !== undefined) patch.config = cleanConfig(body.config);
  if (Number.isFinite(Number(body.sort_order))) patch.sort_order = Number(body.sort_order);

  const { error } = await supabaseAdmin.from("couriers").update(patch).eq("id", id);

  if (error) {
    console.error("[Couriers] update failed:", error.message);
    return NextResponse.json({ error: "Could not save that." }, { status: 500 });
  }

  await audit({
    actor: auth.staff,
    action: "courier.updated",
    entity: "courier",
    entityId: id,
    meta: patch,
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const auth = await requirePermission("delivery.assign");
  if (!auth.ok) return auth.response;

  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "Which courier?" }, { status: 400 });

  const { error } = await supabaseAdmin.from("couriers").delete().eq("id", id);

  if (error) {
    // orders.courier_id is ON DELETE RESTRICT, so this is the expected answer
    // for any partner that has ever carried a parcel — and the right one. Its
    // history should keep naming it.
    console.error("[Couriers] delete failed:", error.message);
    return NextResponse.json(
      {
        error:
          "This courier has carried parcels, so it can't be deleted — " +
          "switch it off instead and it stops being offered.",
      },
      { status: 409 }
    );
  }

  await audit({
    actor: auth.staff,
    action: "courier.deleted",
    entity: "courier",
    entityId: id,
  });

  return NextResponse.json({ ok: true });
}

/**
 * Keep only the settings we understand.
 *
 * A courier's config is free-form JSON in the database, and this is the one
 * door it comes through. Anything unrecognised is dropped rather than stored —
 * partly so the admin form stays the description of what exists, and partly
 * because a secret pasted into a settings box would otherwise be persisted in a
 * table that is not meant to hold one.
 */
function cleanConfig(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const source = raw as Record<string, unknown>;
  const out: Record<string, string> = {};

  for (const key of [
    "pickup_location",
    "pickup_city",
    "pickup_pin",
    "pickup_phone",
    "pickup_address",
    "client_name",
    "mode",
    "tracking",
    // The return address printed on this partner's sheets. See CourierConfig.
    "from_name",
    "from_address",
    "from_phone",
  ]) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) out[key] = value.trim().slice(0, 200);
  }
  return out;
}

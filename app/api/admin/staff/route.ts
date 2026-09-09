export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  createStaff,
  updateStaff,
  setStaffCouriers,
  deleteStaff,
  getStaffById,
  countActiveOwners,
  sanitizePermissions,
  generateTempPassword,
} from "@/lib/db/staff";
import { STAFF_ROLES, type StaffRole } from "@/lib/permissions";
import { listCouriers } from "@/lib/db/couriers";
import { isStockLocation } from "@/lib/stock-location";
import { audit } from "@/lib/audit";

const isRole = (v: unknown): v is StaffRole =>
  typeof v === "string" && (STAFF_ROLES as string[]).includes(v);

/**
 * Create a staff member.
 *
 * Makes the Supabase Auth account and the staff row together, and returns a
 * generated temporary password once — there's no email infrastructure here, so
 * the owner passes it on over WhatsApp. It's shown a single time and never
 * stored in readable form.
 */
export async function POST(request: NextRequest) {
  const auth = await requirePermission("staff.manage");
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({}));
  const email = String(body.email ?? "").trim().toLowerCase();
  const name = String(body.name ?? "").trim();
  const role = body.role;

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  if (!name) {
    return NextResponse.json({ error: "Enter a name." }, { status: 400 });
  }
  if (!isRole(role)) {
    return NextResponse.json({ error: "Pick a role." }, { status: 400 });
  }

  const password = generateTempPassword();

  // email_confirm: true — there's no inbox to click a link in; the owner is
  // vouching for this person by creating the account.
  const { data: created, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (authError || !created?.user) {
    const msg = authError?.message ?? "Could not create the login";
    return NextResponse.json(
      { error: /already/i.test(msg) ? "That email already has an account." : msg },
      { status: 400 }
    );
  }

  const staff = await createStaff({
    email,
    name,
    phone: typeof body.phone === "string" ? body.phone.trim() : null,
    role,
    permissions: sanitizePermissions(body.permissions),
    courierIds: await resolveCouriers(role, body.courier_ids),
    stockLocation: isStockLocation(body.stock_location) ? body.stock_location : null,
    authUserId: created.user.id,
    createdBy: auth.staff.id,
  });

  if (!staff) {
    // Don't leave an auth account with no staff row — it would be a login
    // that resolves to nobody, which getCurrentStaff rejects but which would
    // also block the email from being reused.
    await supabaseAdmin.auth.admin.deleteUser(created.user.id);
    return NextResponse.json({ error: "Could not create the staff record" }, { status: 500 });
  }

  await audit({
    actor: auth.staff,
    action: "staff.created",
    entity: "staff",
    entityId: staff.id,
    meta: { email, role },
  });

  return NextResponse.json({ staff, password });
}

/**
 * The delivery partners a login belongs to, checked against the table (0071).
 *
 * Ids off the wire are not proof of anything, and this decides which
 * customers' addresses an outside company can read — so every id is looked
 * up rather than trusted, and anything that is not a real, current courier is
 * dropped rather than stored. An empty list is safe: a delivery login with no
 * partner linked sees nothing.
 *
 * Only meaningful on a `delivery` role. Every other role resolves to an empty
 * list, so a manager promoted from a partner account stops carrying links
 * that nothing would read but everything would have to explain.
 */
async function resolveCouriers(role: StaffRole, raw: unknown): Promise<string[]> {
  if (role !== "delivery") return [];
  const ids = Array.isArray(raw)
    ? [...new Set(raw.filter((v): v is string => typeof v === "string" && !!v.trim()))]
    : [];
  if (!ids.length) return [];

  const couriers = await listCouriers();
  const valid = new Set(couriers.map((c) => c.id));
  return ids.filter((id) => valid.has(id));
}

/**
 * Update a staff member: role, permissions, active state, or a password reset.
 */
export async function PATCH(request: NextRequest) {
  const auth = await requirePermission("staff.manage");
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({}));
  const id = String(body.id ?? "");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const target = await getStaffById(id);
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Password reset — a separate action, returns the new temp password once.
  if (body.action === "reset_password") {
    if (!target.auth_user_id) {
      return NextResponse.json({ error: "No login for this person" }, { status: 400 });
    }
    const password = generateTempPassword();
    const { error } = await supabaseAdmin.auth.admin.updateUserById(target.auth_user_id, {
      password,
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    await audit({
      actor: auth.staff,
      action: "staff.password_reset",
      entity: "staff",
      entityId: id,
    });
    return NextResponse.json({ password });
  }

  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
  if (typeof body.phone === "string") patch.phone = body.phone.trim() || null;
  if (isRole(body.role)) patch.role = body.role;
  if (body.permissions !== undefined) patch.permissions = sanitizePermissions(body.permissions);
  if (typeof body.is_active === "boolean") patch.is_active = body.is_active;

  // Resolved against the role being saved, not the one on the record: a
  // delivery login promoted to manager in the same request must drop its
  // partner links, and a manager demoted to delivery must be able to gain
  // some. null means "leave the links alone" — courier_ids is only sent
  // when the picker actually changed; an empty array is how it clears them.
  let courierIds: string[] | null = null;
  if (body.courier_ids !== undefined) {
    const role = isRole(body.role) ? body.role : target.role;
    courierIds = await resolveCouriers(role, body.courier_ids);
    // The legacy single column, kept as "the first one" for display.
    patch.courier_id = courierIds[0] ?? null;
  }
  // Any role may hold physical stock — Ajmal and Mubashir are not partner
  // logins, so this isn't gated on role the way courier_ids is above.
  if (body.stock_location !== undefined) {
    patch.stock_location = isStockLocation(body.stock_location) ? body.stock_location : null;
  }

  // The lockout guards. Whoever is last holding the keys keeps them.
  const losingOwner =
    (patch.role !== undefined && patch.role !== "owner") || patch.is_active === false;

  if (target.role === "owner" && losingOwner && (await countActiveOwners()) <= 1) {
    return NextResponse.json(
      { error: "This is the last active owner — promote someone else first." },
      { status: 400 }
    );
  }

  let staff = await updateStaff(id, patch);
  if (!staff) return NextResponse.json({ error: "Update failed" }, { status: 500 });

  if (courierIds !== null) {
    await setStaffCouriers(id, courierIds);
    staff = { ...staff, courier_ids: courierIds };
  }

  await audit({
    actor: auth.staff,
    action: "staff.updated",
    entity: "staff",
    entityId: id,
    meta: { ...patch, ...(courierIds !== null ? { courier_ids: courierIds } : {}) },
  });

  return NextResponse.json({ staff });
}

/** Remove a staff member and their login. */
export async function DELETE(request: NextRequest) {
  const auth = await requirePermission("staff.manage");
  if (!auth.ok) return auth.response;

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const target = await getStaffById(id);
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (target.role === "owner" && (await countActiveOwners()) <= 1) {
    return NextResponse.json(
      { error: "This is the last owner — you'd lock everyone out." },
      { status: 400 }
    );
  }

  // Removing yourself would end the current session mid-request.
  if (auth.staff.id && auth.staff.id === id) {
    return NextResponse.json({ error: "You can't remove your own account." }, { status: 400 });
  }

  if (!(await deleteStaff(target))) {
    return NextResponse.json({ error: "Could not remove" }, { status: 500 });
  }

  await audit({
    actor: auth.staff,
    action: "staff.removed",
    entity: "staff",
    entityId: id,
    meta: { email: target.email },
  });

  return NextResponse.json({ ok: true });
}

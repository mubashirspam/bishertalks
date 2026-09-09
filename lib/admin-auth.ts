import { cache } from "react";
import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getStaffByAuthId, type Staff } from "@/lib/db/staff";
import { can, canAny, landingPage, type Permission, type StaffRole } from "@/lib/permissions";

/**
 * Who is making this request.
 *
 * `id` is null only for the environment-variable owner described below, which
 * is also the one case where there's no staff row to attribute an audit entry
 * to.
 */
export interface CurrentStaff {
  id: string | null;
  email: string;
  name: string;
  role: StaffRole;
  permissions: string[];
  /**
   * The delivery partners this login belongs to (0071 — a login may now
   * carry more than one).
   *
   * Carried on the signed-in user because the portal and every delivery route
   * scope on it. Resolved here, from the database, on each request — the same
   * reason `permissions` is not trusted from the session token: an owner
   * moving somebody to another partner expects it on their next click.
   */
  courier_ids: string[];
}

/**
 * The logged-in staff member, or null.
 *
 * Wrapped in React `cache`, which memoises per request — not across requests.
 * That matters a lot: resolving a staff member costs two Supabase round trips
 * (validate the session, then read the staff row), and every admin page used to
 * pay for it twice — once in the layout to render the sidebar, once in the page
 * guard. On a connection where a round trip is ~450ms that was most of a second
 * of pure duplication on every single click.
 *
 * Still hits the database once per request rather than trusting claims baked
 * into the session token: an owner switching someone off expects it to take
 * effect on that person's next click, not in an hour when their JWT expires.
 * Caching within one request doesn't weaken that — it's the same request.
 *
 * ADMIN_EMAIL is honoured as an owner even with no staff row. That fallback is
 * the lockout escape hatch — without it, one bad permissions edit or a
 * half-applied migration would shut everyone out of the panel with no way back
 * in except direct database access.
 */
export const getCurrentStaff = cache(async function getCurrentStaff(): Promise<CurrentStaff | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const staff: Staff | null = await getStaffByAuthId(user.id);

  if (staff) {
    // Switched off — treated as not logged in at all.
    if (!staff.is_active) return null;
    return {
      id: staff.id,
      email: staff.email,
      name: staff.name,
      role: staff.role,
      permissions: staff.permissions ?? [],
      courier_ids: staff.courier_ids ?? [],
    };
  }

  if (user.email && user.email === process.env.ADMIN_EMAIL) {
    return {
      id: null,
      email: user.email,
      name: "Owner",
      role: "owner",
      permissions: [],
      // An owner is not a partner login and is never scoped to any.
      courier_ids: [],
    };
  }

  // Authenticated with Supabase but not staff — no business being here.
  return null;
});

/** True if the current user holds this capability. */
export async function hasPermission(permission: Permission): Promise<boolean> {
  return can(await getCurrentStaff(), permission);
}

type AuthResult =
  | { ok: true; staff: CurrentStaff }
  | { ok: false; response: NextResponse };

/**
 * Gate for API routes — the layer that actually enforces anything.
 *
 * The sidebar hiding a button and a page refusing to render are conveniences;
 * a delivery agent with the browser devtools open can still POST to any
 * endpoint. This is what stops them.
 *
 *   const auth = await requirePermission("delivery.assign");
 *   if (!auth.ok) return auth.response;
 */
export async function requirePermission(permission: Permission): Promise<AuthResult> {
  const staff = await getCurrentStaff();

  if (!staff) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  if (!can(staff, permission)) {
    // 403, not 404: they're a known user, they just can't do this. Logged
    // because a staff member hitting a wall is either a permissions mistake
    // worth fixing or something worth knowing about.
    console.warn(`[Auth] ${staff.email} denied ${permission}`);
    return {
      ok: false,
      response: NextResponse.json(
        { error: "You don't have permission to do that." },
        { status: 403 }
      ),
    };
  }

  return { ok: true, staff };
}

/**
 * The same, for a route two different permissions both open — same reason as
 * `requirePageAccessAny`: a login with one of two non-overlapping tiers
 * (tasks.view's own-tasks-only vs tasks.manage's whole board, say) must not
 * be locked out of the shared route both tiers use, just because it names
 * one permission and this login holds the other.
 */
export async function requirePermissionAny(permissions: Permission[]): Promise<AuthResult> {
  const staff = await getCurrentStaff();

  if (!staff) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  if (!canAny(staff, permissions)) {
    console.warn(`[Auth] ${staff.email} denied any of ${permissions.join(", ")}`);
    return {
      ok: false,
      response: NextResponse.json(
        { error: "You don't have permission to do that." },
        { status: 403 }
      ),
    };
  }

  return { ok: true, staff };
}

/**
 * Gate for admin PAGES (server components).
 *
 * Sends someone who lacks the capability to the first screen they can actually
 * use, rather than an error — a delivery agent following a stale bookmark to
 * /admin/orders lands on the delivery queue, which is what they wanted anyway.
 * No redirect loop is possible: `landingPage` only ever returns a page the
 * person is allowed to open.
 *
 * Not for route handlers — `redirect()` throws there. Use `requirePermission`.
 */
export async function requirePageAccess(permission: Permission): Promise<CurrentStaff> {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/admin/login");
  if (!can(staff, permission)) redirect(landingPage(staff));
  return staff;
}

/**
 * Gate for a page that several unrelated capabilities can each unlock on
 * their own — the Couriers screen, say, where managing couriers, entering
 * barcode stock and importing a delivery report are three different trusts
 * that happen to share one URL. Passes if the signed-in person holds ANY of
 * them; the page itself decides what each section shows from there, the same
 * way `requirePageAccess` leaves what to render to the page and only answers
 * "can they be here at all".
 */
export async function requirePageAccessAny(
  permissions: Permission[]
): Promise<CurrentStaff> {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/admin/login");
  if (!canAny(staff, permissions)) redirect(landingPage(staff));
  return staff;
}

import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  ROLE_PRESETS,
  isPermission,
  type Permission,
  type StaffRole,
} from "@/lib/permissions";

export interface Staff {
  id: string;
  auth_user_id: string | null;
  email: string;
  name: string;
  phone: string | null;
  role: StaffRole;
  permissions: string[];
  is_active: boolean;
  created_at: string;
  /**
   * The delivery partner this login belongs to (0047).
   *
   * Null for everyone who is not a partner login, which is most of the table.
   * On a `delivery` role it is what the portal scopes to — and null there means
   * "sees nothing", never "sees everything". See lib/delivery/scope.ts.
   */
  courier_id: string | null;
}

const COLUMNS =
  "id,auth_user_id,email,name,phone,role,permissions,is_active,created_at,courier_id";

/** The same list before 0047 — the fallback in getStaffByAuthId below. */
const LEGACY_COLUMNS =
  "id,auth_user_id,email,name,phone,role,permissions,is_active,created_at";

/**
 * Resolve the logged-in Supabase account to a staff record.
 *
 * Read live on every admin request rather than cached in the session token:
 * switching someone off has to take effect on their next click, not whenever
 * their JWT happens to expire.
 */
export async function getStaffByAuthId(authUserId: string): Promise<Staff | null> {
  const { data, error } = await supabaseAdmin
    .from("staff")
    .select(COLUMNS)
    .eq("auth_user_id", authUserId)
    .maybeSingle();

  if (!error) return (data as Staff) ?? null;

  // Migrations here are applied by hand, and this one query runs on EVERY admin
  // request — so a deploy that lands before 0047 does would not degrade one
  // screen, it would fail to resolve anybody and lock every member of staff out
  // of the admin panel, including whoever needs to get in and apply it.
  //
  // So a missing `courier_id` falls back to the columns that existed before it.
  // The portal then treats every delivery login as unlinked, which is the
  // fail-closed answer: an empty portal and a message saying so, rather than a
  // white screen nobody can act on. Applying 0047 fixes it with no redeploy.
  console.error(
    "[Staff] full staff read failed — is migration 0047 applied?",
    error.message
  );

  const { data: legacy } = await supabaseAdmin
    .from("staff")
    .select(LEGACY_COLUMNS)
    .eq("auth_user_id", authUserId)
    .maybeSingle();

  return legacy ? ({ ...(legacy as object), courier_id: null } as Staff) : null;
}

export async function getStaffById(id: string): Promise<Staff | null> {
  const { data } = await supabaseAdmin
    .from("staff")
    .select(COLUMNS)
    .eq("id", id)
    .maybeSingle();
  return (data as Staff) ?? null;
}

export async function listStaff(): Promise<Staff[]> {
  const { data } = await supabaseAdmin
    .from("staff")
    .select(COLUMNS)
    // Owners first, then newest — the list reads as a hierarchy, not a log.
    .order("role", { ascending: true })
    .order("created_at", { ascending: false });
  return (data as Staff[]) ?? [];
}

/** Who a parcel can be handed to: name and id only. */
export interface DeliveryAgent {
  id: string;
  name: string;
}

/**
 * The delivery agents parcels can be assigned to.
 *
 * Membership is the capability, not the role label: an owner may have given a
 * support account the portal, and that account is then a perfectly good person
 * to hand parcels to. Owners are excluded even though `can()` would say yes —
 * assigning the shop's owner their own parcels is never what the picker means,
 * and it would fill the list with people who never open the portal.
 */
export async function listDeliveryAgents(): Promise<DeliveryAgent[]> {
  const { data, error } = await supabaseAdmin
    .from("staff")
    .select("id,name")
    .eq("is_active", true)
    .neq("role", "owner")
    .contains("permissions", ["delivery.portal"])
    .order("name", { ascending: true });

  if (error) {
    console.error("[Staff] delivery agent list failed:", error.message);
    return [];
  }
  return (data as DeliveryAgent[]) ?? [];
}

/** Drop anything that isn't a real capability — the list comes from a form. */
export function sanitizePermissions(input: unknown): Permission[] {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.filter((p): p is Permission => typeof p === "string" && isPermission(p)))];
}

export function presetFor(role: StaffRole): Permission[] {
  return [...ROLE_PRESETS[role]];
}

export interface CreateStaffInput {
  email: string;
  name: string;
  phone?: string | null;
  role: StaffRole;
  permissions: Permission[];
  authUserId: string;
  createdBy: string | null;
  /** The partner this login works for. Only meaningful on a delivery role. */
  courierId?: string | null;
}

export async function createStaff(input: CreateStaffInput): Promise<Staff | null> {
  const { data, error } = await supabaseAdmin
    .from("staff")
    .insert({
      auth_user_id: input.authUserId,
      email: input.email.toLowerCase(),
      name: input.name,
      phone: input.phone || null,
      role: input.role,
      permissions: input.permissions,
      // Only a delivery login is scoped to a partner. Storing it on a manager
      // would be a value nothing reads and everything has to explain later.
      courier_id: input.role === "delivery" ? input.courierId || null : null,
      is_active: true,
      created_by: input.createdBy,
    })
    .select(COLUMNS)
    .single();

  if (error) {
    console.error("[Staff] create failed:", error.message);
    return null;
  }
  return data as Staff;
}

export async function updateStaff(
  id: string,
  patch: Partial<
    Pick<Staff, "name" | "phone" | "role" | "permissions" | "is_active" | "courier_id">
  >
): Promise<Staff | null> {
  const { data, error } = await supabaseAdmin
    .from("staff")
    .update(patch)
    .eq("id", id)
    .select(COLUMNS)
    .single();

  if (error) {
    console.error("[Staff] update failed:", error.message);
    return null;
  }
  return data as Staff;
}

/**
 * Remove a staff member entirely — the auth account goes too, so the login
 * stops working rather than merely losing its permissions. The `staff` row is
 * cascaded away by the FK.
 */
export async function deleteStaff(staff: Staff): Promise<boolean> {
  if (staff.auth_user_id) {
    const { error } = await supabaseAdmin.auth.admin.deleteUser(staff.auth_user_id);
    if (error) {
      console.error("[Staff] auth delete failed:", error.message);
      return false;
    }
    return true;
  }

  const { error } = await supabaseAdmin.from("staff").delete().eq("id", staff.id);
  if (error) {
    console.error("[Staff] delete failed:", error.message);
    return false;
  }
  return true;
}

/**
 * How many owners are left.
 *
 * Guards the two operations that could lock everyone out of the panel:
 * demoting the last owner, and deleting them.
 */
export async function countActiveOwners(): Promise<number> {
  const { count } = await supabaseAdmin
    .from("staff")
    .select("id", { count: "exact", head: true })
    .eq("role", "owner")
    .eq("is_active", true);
  return count ?? 0;
}

/**
 * A temporary password to hand over on WhatsApp.
 *
 * Deliberately not a random blob: it gets typed by hand, often from a phone
 * screen, so it avoids characters that are ambiguous in most fonts (0/O, 1/l/I)
 * while staying long enough to be safe for the short time it exists.
 */
export function generateTempPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(14));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

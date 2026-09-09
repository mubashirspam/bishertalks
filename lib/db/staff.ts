import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  ROLE_PRESETS,
  isPermission,
  type Permission,
  type StaffRole,
} from "@/lib/permissions";
import { isStockLocation, type StockLocation } from "@/lib/stock-location";

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
   * Superseded by `courier_ids` below (0071) as what scoping actually reads —
   * kept only because dropping a column by hand is a risk this migration
   * chain does not take. Do not read this for access control; it is not kept
   * in sync with `staff_couriers` after a login is edited.
   */
  courier_id: string | null;
  /**
   * The delivery partners this login may see and act on (0071).
   *
   * Empty for everyone who is not a partner login, which is most of the
   * table. On a `delivery` role this is what the portal scopes to — and
   * empty there means "sees nothing", never "sees everything". See
   * lib/delivery/scope.ts. A login can now carry more than one partner.
   */
  courier_ids: string[];
  /**
   * Whose shelf this person's own direct sales draw down (0069).
   *
   * Not scoped to a role the way `courier_id` is: Ajmal and Mubashir enter
   * sales as whatever role they hold, not as a partner login. Null for
   * everyone who does not hold physical stock, which is most of the table.
   */
  stock_location: StockLocation | null;
}

const COLUMNS =
  "id,auth_user_id,email,name,phone,role,permissions,is_active,created_at," +
  "courier_id,stock_location";

/** The same list before 0047 — the fallback in getStaffByAuthId below. */
const LEGACY_COLUMNS =
  "id,auth_user_id,email,name,phone,role,permissions,is_active,created_at";

/**
 * Every courier id linked to each of these staff ids (0071).
 *
 * A second query rather than a join in the main select: PostgREST embeds a
 * to-many relationship as a nested array of objects, not a flat array of
 * ids, and every caller here wants the plain list. One extra query over a
 * tiny table is cheaper than reshaping that on every read.
 */
async function courierIdsFor(staffIds: string[]): Promise<Map<string, string[]>> {
  const byStaff = new Map<string, string[]>();
  if (!staffIds.length) return byStaff;

  const { data, error } = await supabaseAdmin
    .from("staff_couriers")
    .select("staff_id,courier_id")
    .in("staff_id", staffIds);

  if (error) {
    // Migrations here are applied by hand — a database still on 0047 has no
    // staff_couriers table yet. Every login degrades to "no partner linked"
    // rather than failing the whole staff read, same contract as the
    // courier_id fallback below.
    console.error("[Staff] staff_couriers unreadable — is 0071 applied?", error.message);
    return byStaff;
  }

  for (const row of (data ?? []) as { staff_id: string; courier_id: string }[]) {
    byStaff.set(row.staff_id, [...(byStaff.get(row.staff_id) ?? []), row.courier_id]);
  }
  return byStaff;
}

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

  if (!error) {
    if (!data) return null;
    const row = data as unknown as Staff;
    const byStaff = await courierIdsFor([row.id]);
    return { ...row, courier_ids: byStaff.get(row.id) ?? [] };
  }

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

  return legacy
    ? ({
        ...(legacy as object),
        courier_id: null,
        courier_ids: [],
        stock_location: null,
      } as unknown as Staff)
    : null;
}

export async function getStaffById(id: string): Promise<Staff | null> {
  const { data } = await supabaseAdmin
    .from("staff")
    .select(COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const row = data as unknown as Staff;
  const byStaff = await courierIdsFor([row.id]);
  return { ...row, courier_ids: byStaff.get(row.id) ?? [] };
}

export async function listStaff(): Promise<Staff[]> {
  const { data } = await supabaseAdmin
    .from("staff")
    .select(COLUMNS)
    // Owners first, then newest — the list reads as a hierarchy, not a log.
    .order("role", { ascending: true })
    .order("created_at", { ascending: false });
  const rows = (data as unknown as Staff[]) ?? [];
  if (!rows.length) return rows;

  const byStaff = await courierIdsFor(rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, courier_ids: byStaff.get(r.id) ?? [] }));
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
  /** The partners this login works for. Only meaningful on a delivery role. */
  courierIds?: string[];
  /** Whose shelf this person's own direct sales draw down. Any role. */
  stockLocation?: StockLocation | null;
}

export async function createStaff(input: CreateStaffInput): Promise<Staff | null> {
  const courierIds = input.role === "delivery" ? (input.courierIds ?? []) : [];

  const { data, error } = await supabaseAdmin
    .from("staff")
    .insert({
      auth_user_id: input.authUserId,
      email: input.email.toLowerCase(),
      name: input.name,
      phone: input.phone || null,
      role: input.role,
      permissions: input.permissions,
      // The legacy single column — kept as "the first one" for whatever
      // still reads it for display. Scoping reads staff_couriers, below.
      courier_id: courierIds[0] ?? null,
      stock_location:
        input.stockLocation && isStockLocation(input.stockLocation)
          ? input.stockLocation
          : null,
      is_active: true,
      created_by: input.createdBy,
    })
    .select(COLUMNS)
    .single();

  if (error) {
    console.error("[Staff] create failed:", error.message);
    return null;
  }
  const staff = data as unknown as Staff;

  if (courierIds.length) await setStaffCouriers(staff.id, courierIds);

  return { ...staff, courier_ids: courierIds };
}

export async function updateStaff(
  id: string,
  patch: Partial<
    Pick<
      Staff,
      "name" | "phone" | "role" | "permissions" | "is_active" | "courier_id" | "stock_location"
    >
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
  const staff = data as unknown as Staff;
  const byStaff = await courierIdsFor([staff.id]);
  return { ...staff, courier_ids: byStaff.get(staff.id) ?? [] };
}

/**
 * Replace which couriers a staff login may see, wholesale (0071).
 *
 * Delete-then-insert rather than a diff: the form always sends the complete
 * set somebody wants, a login typically has a handful of these at most, and
 * working out an add/remove list would cost more code than it would ever
 * save on a screen edited this rarely.
 */
export async function setStaffCouriers(
  staffId: string,
  courierIds: string[]
): Promise<boolean> {
  const { error: deleteError } = await supabaseAdmin
    .from("staff_couriers")
    .delete()
    .eq("staff_id", staffId);
  if (deleteError) {
    console.error("[Staff] courier link clear failed:", deleteError.message);
    return false;
  }

  const unique = [...new Set(courierIds.filter(Boolean))];
  if (!unique.length) return true;

  const { error: insertError } = await supabaseAdmin
    .from("staff_couriers")
    .insert(unique.map((courier_id) => ({ staff_id: staffId, courier_id })));
  if (insertError) {
    console.error("[Staff] courier link write failed:", insertError.message);
    return false;
  }
  return true;
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

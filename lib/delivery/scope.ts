import { can, type PermissionHolder } from "@/lib/permissions";

/**
 * Whose parcels a signed-in user may work on.
 *
 * One function, asked by the portal page and by every route that writes to or
 * exports a parcel, because the expensive failure here is the screen and the
 * API disagreeing — which is exactly what was happening before 0047. The
 * portal showed `kkrlogistic` all 512 live parcels while three routes refused
 * to act on 314 of them, so two thirds of the queue was visible, clickable,
 * and answered "that parcel isn't assigned to you".
 *
 * The rule, from docs/delivery-model.md: who sees a parcel is answered by the
 * COURIER, not by an agent. A partner login belongs to a courier and sees that
 * courier's work — however many people that partner has, and whether or not
 * anybody was named on the individual parcel.
 */

/** A user, as far as scoping is concerned. */
export type ScopedStaff = PermissionHolder & { courier_id: string | null };

export type PortalScope = {
  /** Runs the whole queue: every courier, and the filters to narrow by hand. */
  seesEveryone: boolean;
  /**
   * The courier they are pinned to, or null.
   *
   * Read this ONLY together with `seesEveryone`. null means two opposite
   * things depending on it — every courier for an owner, and no courier at all
   * for a partner login nobody has linked yet.
   */
  courierId: string | null;
};

export function portalScope(staff: ScopedStaff): PortalScope {
  // Owners and managers hold delivery.view — they run the queue and route the
  // parcels, so scoping them to one courier would take away the screen they
  // use to decide which courier a parcel goes to in the first place.
  if (can(staff, "delivery.view")) {
    return { seesEveryone: true, courierId: null };
  }
  return { seesEveryone: false, courierId: staff.courier_id };
}

/**
 * May this user act on a parcel routed to `courierId`?
 *
 * Fails closed on both nulls, and they are different failures worth keeping
 * apart in your head:
 *
 *   the STAFF has no courier   an account somebody created without picking a
 *                              partner. It must see nothing — the alternative
 *                              is a misconfigured login quietly inheriting
 *                              every partner's customer addresses.
 *   the PARCEL has no courier  not routed to anyone yet. It belongs on
 *                              /admin/delivery, where an owner decides, and on
 *                              nobody's partner portal until they have.
 */
export function mayHandle(scope: PortalScope, parcelCourierId: string | null): boolean {
  if (scope.seesEveryone) return true;
  if (!scope.courierId || !parcelCourierId) return false;
  return scope.courierId === parcelCourierId;
}

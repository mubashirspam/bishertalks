/**
 * Logistics partners.
 *
 * A partner is a row (migration 0030), not a constant, so adding Speed Post or
 * a rider we hand parcels to is a form rather than a deploy. This module holds
 * the shape and the vocabulary; lib/db/couriers.ts does the reading.
 *
 * Nothing here sends anything. Handing a parcel over is Phase 3 of
 * docs/delhivery-integration-plan.md, and deliberately waits until one call has
 * actually been accepted by Delhivery — designing an adapter interface against
 * an API nobody has successfully called yet is how you write the wrong one.
 */

/**
 * How a parcel physically leaves us. The one field with behaviour attached.
 *
 * Ordered by how much of it we automate, which is also the order the work
 * happened in: the sheet is what we have, the API is what replaces it, and
 * manual is what covers everything we have not integrated.
 */
export const COURIER_HANDOFFS = ["api", "sheet", "manual"] as const;

export type CourierHandoff = (typeof COURIER_HANDOFFS)[number];

export interface Courier {
  id: string;
  /** What a human calls it. Renameable; nothing in the code reads this. */
  name: string;
  /**
   * What the code calls it. The stable handle an adapter is selected by, so
   * renaming a partner in the admin can never unhook its integration.
   */
  slug: string;
  handoff: CourierHandoff;
  /** Pickup location, service mode — whatever this one partner needs. */
  config: CourierConfig;
  is_active: boolean;
  sort_order: number;
}

/**
 * Per-partner settings. Everything optional: these are the fields *some*
 * partner needs, and a `manual` one needs none of them.
 *
 * Never secrets — tokens live in the environment. This is shown in an admin
 * form and readable by anything holding the service key.
 */
export interface CourierConfig {
  /**
   * The warehouse the partner collects from, spelled exactly as they have it
   * registered. Delhivery rejects an entire payload whose pickup location it
   * does not recognise, so this is the field most likely to break a send.
   */
  pickup_location?: string;
  /** Their name for our account, where an API asks for it. */
  client_name?: string;
  /** Service level, e.g. "surface" or "express". */
  mode?: string;
  /**
   * Whose API can tell us where a parcel is, if anyone's.
   *
   * Deliberately separate from `handoff`. A courier we hand a spreadsheet to
   * can still have an API that reports scans — which is exactly the case for
   * everything KKR uploaded by hand — and treating "we can't send to them" as
   * "we can't ask them" hid a year of live tracking behind a spreadsheet.
   */
  tracking?: string;
}

/** What each handoff means, in the words the admin screens use. */
export const HANDOFF_LABELS: Record<CourierHandoff, string> = {
  api: "We send it to them",
  sheet: "Excel sheet they upload",
  manual: "We hand it over",
};

/**
 * The longer version, for the one place that has to explain the choice — the
 * form where someone adds a partner and has to pick one of these.
 */
export const HANDOFF_HINTS: Record<CourierHandoff, string> = {
  api: "We send the parcel to them over their API. Only works for a partner we have written an integration for.",
  sheet: "We produce a spreadsheet for them to upload themselves.",
  manual: "We hand it over or post it, and type the tracking number in afterwards. Works for any partner, with no setup.",
};

export function isCourierHandoff(v: unknown): v is CourierHandoff {
  return typeof v === "string" && (COURIER_HANDOFFS as readonly string[]).includes(v);
}

/**
 * Couriers whose tracking API we have written, by the name in
 * `config.tracking`.
 *
 * Tracking only. Asking where a parcel is cannot create, charge for or move
 * anything, which is why this list exists while its sending counterpart does
 * not — see below.
 */
export const TRACKED_INTEGRATIONS: readonly string[] = ["delhivery"];

/**
 * We do not manifest. KKR LOGISTICS FRANCHISE does.
 *
 * There is deliberately no code in this repository that can create a shipment
 * at Delhivery — the route, the payload builder and the send script were all
 * removed rather than left behind a flag, because a flag is something someone
 * turns on. Manifesting from here would produce a second waybill for a parcel
 * KKR is about to manifest themselves: two shipments, two pickups, two
 * delivery charges, one book.
 *
 * Our use of their API is read-only — tracking, serviceability, charges,
 * packing slips.
 */

/**
 * Can we ask this courier where a parcel is?
 *
 * True for anything with a tracking integration behind it, whatever way its
 * parcels leave the building. This is what puts the Excel channel's parcels on
 * a live tracking screen instead of a spreadsheet.
 */
export function canTrack(courier: Courier): boolean {
  return !!courier.config.tracking && TRACKED_INTEGRATIONS.includes(courier.config.tracking);
}

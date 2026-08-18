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
 * Partners we have actually written an integration for, by slug.
 *
 * A row can be set to `api` in the database before its adapter exists — that is
 * a misconfiguration, not a crash, and this is what lets the screens say so
 * instead of failing at the moment someone presses send.
 *
 * Delhivery was held out of this list until a manifest call had genuinely been
 * accepted, because the payload had never been tried and there is no staging
 * account to try it on — the token is production-only. That proof now exists:
 * six real shipments accepted on 18 August, waybills 54132310017275 through
 * ...323, every one Manifested under KKR LOGISTICS FRANCHISE.
 */
export const INTEGRATED_SLUGS: readonly string[] = ["delhivery"];

/**
 * Couriers whose tracking API we have written, by the name used in
 * `config.tracking`.
 *
 * Unlike INTEGRATED_SLUGS this is not gated on a live send being proven —
 * asking where a parcel is cannot create, charge for or move anything, so it
 * carries none of the risk that keeps sending switched off.
 */
export const TRACKED_INTEGRATIONS: readonly string[] = ["delhivery"];

/**
 * Can we actually hand a parcel to this partner ourselves?
 *
 * False for a `manual` partner (nothing to call), and false for an `api`
 * partner whose adapter has not been written yet — which is every one of them
 * today. The screens read this rather than checking the handoff directly, so
 * shipping the Delhivery adapter turns the button on in one place.
 */
export function canSendAutomatically(courier: Courier): boolean {
  return courier.handoff === "api" && INTEGRATED_SLUGS.includes(courier.slug);
}

/**
 * A partner set to `api` with no adapter behind it. Worth naming, because the
 * fix is "write the integration or change the handoff", and an admin staring at
 * a dead button deserves to be told which.
 */
export function isMisconfigured(courier: Courier): boolean {
  return courier.handoff === "api" && !INTEGRATED_SLUGS.includes(courier.slug);
}

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

import { capabilitiesFor, trackAdapterFor } from "./adapters";

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

  /**
   * The return address printed on this partner's paperwork.
   *
   * Per courier because it genuinely differs: a parcel handed to KKR comes back
   * to KKR's franchise counter, one posted through Speed Post comes back to the
   * post office branch it was booked at, and a rider's parcels come back to the
   * office. One return address across all of them sends a failed parcel to a
   * building that never had it.
   *
   * Every field is optional and falls back to the environment defaults in
   * `senderFromEnv()` — a partner that has not been given its own address keeps
   * printing the one that was there before, rather than printing nothing. A
   * return address is the field whose absence makes a parcel unrecoverable.
   */
  from_name?: string;
  from_address?: string;
  from_phone?: string;

  /**
   * The heading across the top of this partner's address sheets.
   *
   * A contractual India Post parcel is posted under a printed heading the
   * counter recognises — "INDIA POST PARCEL CONTRACTUAL" — and a parcel handed
   * to KKR is not. The words differ per partner, and they are the first thing
   * the person taking the parcel reads, so they live beside the return address
   * rather than in the code.
   *
   * Empty falls back to the partner-neutral default in `sheetHeaderFromEnv()`.
   */
  sheet_title?: string;
  /**
   * The account this partner books our parcels against, printed under the
   * heading.
   *
   * India Post's contractual counter refuses a parcel whose customer and
   * contract numbers are not on the paperwork — they are how the booking is
   * charged to the account rather than paid for at the window. Per courier
   * because they are issued per courier; blank for a partner that has none,
   * and the band then does not print at all.
   */
  customer_id?: string;
  contract_id?: string;

  /**
   * Refuse to route a parcel this courier demonstrably cannot deliver.
   *
   * Off everywhere by default, and deliberately so. The normal behaviour is to
   * route anyway and mark the parcel `unserviceable` — a courier's coverage
   * answer is advice, someone may know better, and blocking an assignment on a
   * secondary lookup is a bigger failure than the one it prevents.
   *
   * The manual Delhivery channel is the exception, because the failure lands
   * somewhere nothing else catches it. There is no API call to be refused by:
   * the parcel goes onto a spreadsheet, gets packed, is carried to KKR, and is
   * rejected at the counter — by which point it has cost a trip and a day.
   * With `handoff: 'api'` the same mistake surfaces in seconds as a refused
   * manifest, which is why Delhivery proper does not need this.
   *
   * **Only a definite no refuses.** `serviceabilityFor` returns undefined when
   * it could not find out, and undefined still routes — an unreachable lookup
   * must never stop a day's dispatch. See lib/db/serviceability.ts.
   */
  require_serviceable?: boolean;
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
export const TRACKED_INTEGRATIONS: readonly string[] = ["delhivery", "india-post"];

/**
 * Couriers we can hand a parcel to over their API, by slug.
 *
 * Delhivery's only endpoint for putting an order into their system is
 * /api/cmu/create.json, and it manifests: a waybill comes back in the same
 * response. There is no create-without-manifest call available on this
 * account, so "push the order and let KKR manifest it" is not a thing the API
 * can do — pushing IS manifesting.
 *
 * That turned out not to matter in practice. The parcels sent this way landed
 * in KKR LOGISTICS FRANCHISE's own account, under their pickup location, and
 * KKR printed and collected them exactly as they would have done from a
 * spreadsheet they uploaded themselves. The only step it removes is the typing.
 */
export const INTEGRATED_SLUGS: readonly string[] = ["delhivery"];

/**
 * Can we hand a parcel to this courier ourselves?
 *
 * Both halves are required and they check different things. `handoff === api`
 * is the row's own decision — the Excel channel is Delhivery underneath and
 * must still never be sent to. `capabilities.book` is the carrier's: India
 * Post has an adapter and is tracked by it, but `booking.ts` does not exist,
 * so it declares `book: false` and no Send button is drawn.
 *
 * Derived from the adapter rather than read off INTEGRATED_SLUGS, so a carrier
 * gaining the ability to book turns its button on in one place instead of
 * two. The list stays as the record of which slugs ever had an integration.
 */
export function canSendAutomatically(courier: Courier): boolean {
  if (courier.handoff !== "api") return false;
  return capabilitiesFor(courier)?.book === true;
}

/**
 * Can we ask this courier where a parcel is?
 *
 * True for anything with a tracking integration behind it, whatever way its
 * parcels leave the building. This is what puts the Excel channel's parcels on
 * a live tracking screen instead of a spreadsheet.
 */
export function canTrack(courier: Courier): boolean {
  return trackAdapterFor(courier)?.capabilities.track === true;
}

/**
 * The code a partner's reference numbers start with.
 *
 * A reference used to say nothing about which partner it belonged to: every
 * one of them was `BISH` plus digits of the customer's mobile, whoever was
 * carrying the parcel. That is how ORD-YP97XR — an India Post parcel — came to
 * be given `BISH40490`, the same string Delhivery already had on file for a
 * different customer's shipment, and inherited that shipment's waybill and its
 * "Delivered" scan. Two different couriers cannot file two different parcels
 * under one number if the number names the courier.
 *
 * `BISH` is kept for Delhivery because KKR has years of sheets under it and a
 * prefix they recognise is worth more than a tidy scheme. Everyone else gets
 * their own.
 *
 * A partner added in the admin and never listed here gets a code derived from
 * its slug. Two partners can theoretically derive the same code; that costs
 * legibility and nothing else, because what actually makes a reference unique
 * is the order number it ends with.
 */
const REFERENCE_CODES: Record<string, string> = {
  delhivery: "BISH",
  "delhivery-sheet": "BISH",
  "speed-post": "SP",
  "mubashir-logistic": "ML",
};

/** The house code, for a parcel not routed anywhere yet. */
export const DEFAULT_REFERENCE_CODE = "BISH";

export function referenceCode(
  courier: Pick<Courier, "slug"> | null | undefined
): string {
  const slug = courier?.slug ?? "";
  if (!slug) return DEFAULT_REFERENCE_CODE;
  if (REFERENCE_CODES[slug]) return REFERENCE_CODES[slug];

  // "blue-dart" → BD, "ecom" → ECOM. Letters only, so a slug that is all
  // punctuation cannot produce an empty prefix and a reference beginning "-".
  const parts = slug.split(/[^a-zA-Z]+/).filter(Boolean);
  const derived =
    parts.length > 1
      ? parts.map((p) => p[0]).join("")
      : (parts[0] ?? "").slice(0, 4);

  return derived.toUpperCase() || DEFAULT_REFERENCE_CODE;
}

/**
 * Does this partner ever see the reference we mint?
 *
 * A `sheet` partner reads it off the file they upload; an `api` partner is sent
 * it as `order`. A `manual` one is handed a parcel across a counter and issues
 * their own barcode — our number is never written down anywhere they can see,
 * which is why an India Post parcel's reference can still be corrected after
 * it has been marked entered, and a Delhivery one's cannot.
 */
export function referenceIsPrivate(courier: Pick<Courier, "handoff"> | null | undefined): boolean {
  return courier?.handoff === "manual";
}

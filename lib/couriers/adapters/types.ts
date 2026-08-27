import type { NormalisedScan } from "@/lib/db/courier-scan";
import type { CourierConfig } from "@/lib/couriers/types";

/**
 * One interface, one implementation per carrier.
 *
 * Before this, every route imported `lib/delhivery/*` directly — `courier`
 * pulled in `manifestParcels`, `courier-sync` pulled in `trackWaybills`,
 * `lib/db/serviceability` pulled in `checkPincodes`. Adding a second carrier
 * that way means a second branch in each of those files, and every branch is a
 * chance to break the carrier that already works.
 *
 * So the routes ask "which adapter" once, and the carrier-specific knowledge
 * stays inside `lib/delhivery/*` and `lib/india-post/*` exactly where it is.
 * Nothing moved out of those modules to build this; the adapters wrap them.
 *
 * ── Two decisions worth knowing about ─────────────────────────────────────
 *
 * **Settings never leave the adapter.** Every method takes the courier's
 * `config` and resolves its own credentials from it, rather than the caller
 * holding a `DelhiverySettings` or an `IndiaPostSettings` and passing it back
 * in. Those two types have nothing in common, and threading them through the
 * seam would mean either a generic parameter in every signature or an
 * `unknown` that each call site casts — one is noisy, the other is a lie.
 * Resolving per call costs a pure function reading `process.env`.
 *
 * **Capabilities are declared, not inferred.** `capabilities.book` is a
 * boolean on the adapter rather than `typeof adapter.book === "function"`,
 * because the screens need to answer "does this courier have a Send button"
 * synchronously, from a `Courier` row, without constructing anything. See
 * `canSendAutomatically` in ../types.ts.
 */

/** One parcel's movement, as any carrier reports it. */
export interface CarrierScan {
  /**
   * The carrier's own name for the parcel — a Delhivery waybill, an India Post
   * article number. Written to `orders.tracking_number` when we did not
   * already have it, which is how a parcel handed over on a spreadsheet gets
   * its waybill without anyone typing one in.
   */
  carrierId: string;
  /**
   * Our reference, when the carrier echoes it back.
   *
   * Null for a carrier that does not index on it. India Post's bulk tracking
   * knows only article numbers, so its scans arrive with nothing but
   * `carrierId` — which is fine, because we minted that number ourselves and
   * it is already on the order.
   */
  reference: string | null;
  /** Already read into our vocabulary by the carrier's own status module. */
  scan: NormalisedScan;
}

/** What a booking attempt did to one parcel. */
export interface BookResult {
  order_number: string;
  ok: boolean;
  /** The carrier's number for it, when they gave us one. */
  waybill: string | null;
  error: string | null;
  /**
   * They told us they do not know either.
   *
   * The distinction the whole send path is built on: a refusal releases the
   * claim, an uncertainty holds it. Treating "might be saved" as a refusal
   * invites a second shipment for one that already exists.
   */
  uncertain: boolean;
  /** The shipment already existed and was adopted rather than created. */
  adopted?: boolean;
}

/** Whether this pincode can be reached. `undefined` means we could not find out. */
export type ServiceabilityMap = Map<string, boolean | undefined>;

/**
 * What a carrier can do, answerable without building anything.
 *
 * Every flag here is read by a screen deciding which buttons to draw, so they
 * are plain booleans and stay in sync with the methods below by hand. A flag
 * set true with no method behind it is a button that throws when pressed —
 * which is why `adapterFor` is the only thing allowed to construct one, and
 * why India Post's `book` is false until `booking.ts` exists.
 */
export interface CarrierCapabilities {
  book: boolean;
  track: boolean;
  serviceability: boolean;
  quote: boolean;
  label: boolean;
}

export interface Readiness {
  ready: boolean;
  /** What is still missing, in words a person can act on. */
  missing: string[];
}

export interface CarrierAdapter {
  /** Matches `couriers.slug` for the carrier this adapter speaks for. */
  slug: string;
  /**
   * Matches `config.tracking`, and is deliberately not the slug.
   *
   * Several courier rows share one tracking integration: both KKR rows are
   * Delhivery underneath, one over the API and one by spreadsheet. The slug
   * says which partner; this says whose API answers for it.
   */
  trackingKey: string;
  capabilities: CarrierCapabilities;
  /** How many parcels one tracking call may carry. */
  trackBatch: number;

  /** Is this courier configured well enough to call at all? */
  readiness(config: CourierConfig): Readiness;

  /** Look parcels up by the carrier's own number. */
  trackByCarrierId?(ids: string[], config: CourierConfig): Promise<CarrierScan[]>;
  /**
   * Look parcels up by *our* reference.
   *
   * Optional because not every carrier indexes on it, and the difference
   * matters: it is the only way to find a parcel whose waybill we never saw.
   */
  trackByReference?(references: string[], config: CourierConfig): Promise<CarrierScan[]>;

  serviceability?(pincodes: string[], config: CourierConfig): Promise<ServiceabilityMap>;
}

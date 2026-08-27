import type { Courier, CourierConfig } from "@/lib/couriers/types";
import type { CarrierAdapter, CarrierCapabilities } from "./types";
import { delhiveryAdapter } from "./delhivery";
import { indiaPostAdapter } from "./india-post";

export type {
  CarrierAdapter,
  CarrierCapabilities,
  CarrierScan,
  BookResult,
  ServiceabilityMap,
  Readiness,
} from "./types";

/**
 * Choosing the carrier for a courier row.
 *
 * Two lookups, because a courier row and a tracking integration are not the
 * same thing and conflating them is what caused the bug this whole seam sits
 * on top of:
 *
 *   by slug           which partner is this — decides who can be *sent* to
 *   by config.tracking whose API answers for it — decides who can be *asked*
 *
 * They come apart in practice. Both KKR rows are Delhivery underneath: one
 * hands parcels over the API, the other produces a spreadsheet KKR uploads.
 * The second cannot be sent to and can absolutely be tracked, and treating
 * "we can't send to them" as "we can't ask them" is precisely what hid a year
 * of live tracking behind a spreadsheet.
 */

const BY_SLUG: Record<string, CarrierAdapter> = {
  [delhiveryAdapter.slug]: delhiveryAdapter,
  [indiaPostAdapter.slug]: indiaPostAdapter,
};

const BY_TRACKING: Record<string, CarrierAdapter> = {
  [delhiveryAdapter.trackingKey]: delhiveryAdapter,
  [indiaPostAdapter.trackingKey]: indiaPostAdapter,
};

/** Every adapter, for a sweep that runs once per carrier. */
export const ADAPTERS: readonly CarrierAdapter[] = [delhiveryAdapter, indiaPostAdapter];

/**
 * The adapter that can *send* to this courier, or null.
 *
 * Keyed on slug, and gated on the handoff: a courier we produce a spreadsheet
 * for has a perfectly good Delhivery adapter behind it and must still never be
 * sent to over the API. That is the difference between the two KKR rows, and
 * it is a property of the row rather than of the carrier.
 */
export function sendAdapterFor(courier: Pick<Courier, "slug" | "handoff">): CarrierAdapter | null {
  if (courier.handoff !== "api") return null;
  return BY_SLUG[courier.slug] ?? null;
}

/**
 * The adapter that can *answer* for this courier's parcels, or null.
 *
 * Keyed on `config.tracking`, so it works for every handoff — which is the
 * whole reason the Excel channel's parcels appear on a live tracking screen.
 */
export function trackAdapterFor(
  courier: Pick<Courier, "config">
): CarrierAdapter | null {
  const key = courier.config.tracking;
  return key ? (BY_TRACKING[key] ?? null) : null;
}

/** What this courier's carrier can do, or null if we have no adapter for it. */
export function capabilitiesFor(
  courier: Pick<Courier, "slug" | "config">
): CarrierCapabilities | null {
  const adapter = BY_SLUG[courier.slug] ?? trackAdapterFor(courier);
  return adapter?.capabilities ?? null;
}

/** Is this courier's carrier configured well enough to be called? */
export function trackReadiness(
  courier: Pick<Courier, "config">
): { ready: boolean; missing: string[]; adapter: CarrierAdapter | null } {
  const adapter = trackAdapterFor(courier);
  if (!adapter) return { ready: false, missing: ["No tracking integration"], adapter: null };
  const { ready, missing } = adapter.readiness(courier.config as CourierConfig);
  return { ready, missing, adapter };
}

/**
 * Split a list into calls that stay inside a carrier's batch limit.
 *
 * Carrier-neutral because the limits differ and the reason to respect them is
 * the same: Delhivery caps a query at 50 waybills, India Post at 50 articles,
 * and overrunning either does not error — it silently answers about the first
 * N and drops the rest, which reads as "those parcels do not exist".
 */
export function trackingBatches(ids: string[], size: number): string[][] {
  const clean = [...new Set(ids.filter(Boolean))];
  const out: string[][] = [];
  for (let i = 0; i < clean.length; i += Math.max(1, size)) {
    out.push(clean.slice(i, i + Math.max(1, size)));
  }
  return out;
}

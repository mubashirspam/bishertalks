import { delhiveryReadiness } from "@/lib/delhivery/config";
import {
  trackWaybills,
  trackReferencesResilient,
  TRACK_BATCH,
} from "@/lib/delhivery/track";
import { checkPincodes } from "@/lib/delhivery/serviceability";
import { statusFromScan, describeScan } from "@/lib/delhivery/status";
import type { CourierConfig } from "@/lib/couriers/types";
import type {
  CarrierAdapter,
  CarrierScan,
  ServiceabilityMap,
} from "./types";

/**
 * Delhivery, behind the seam.
 *
 * A wrapper and nothing more. Every line of behaviour still lives in
 * `lib/delhivery/*` — the rate-limit batching, the `ref_ids` quirk where one
 * unknown id refuses the whole query, the `uncertain` vs `refused` distinction.
 * Moving any of it here would have made this refactor a rewrite of the one
 * carrier that works.
 *
 * The acceptance test for this file is that routing, sending, syncing and the
 * poller behave identically to before it existed.
 */

/** Their scan, read into our vocabulary. Shared by both lookup directions. */
function toCarrierScan(p: Awaited<ReturnType<typeof trackWaybills>>[number]): CarrierScan {
  return {
    carrierId: p.waybill,
    reference: p.reference,
    scan: {
      description: describeScan(p.scan),
      at: p.scan.statusDateTime,
      next: statusFromScan(p.scan),
    },
  };
}

export const delhiveryAdapter: CarrierAdapter = {
  slug: "delhivery",
  trackingKey: "delhivery",

  capabilities: {
    book: true,
    track: true,
    serviceability: true,
    quote: true,
    // Their packing slip is a PDF we fetch, but the Print button draws our own
    // docket today and nothing calls it. False until something does.
    label: false,
  },

  trackBatch: TRACK_BATCH,

  readiness(config: CourierConfig) {
    const { ready, missing } = delhiveryReadiness(config);
    return { ready, missing };
  },

  async trackByCarrierId(ids: string[], config: CourierConfig): Promise<CarrierScan[]> {
    const { ready, settings } = delhiveryReadiness(config);
    if (!ready || !settings) return [];
    return (await trackWaybills(ids, settings)).map(toCarrierScan);
  },

  async trackByReference(references: string[], config: CourierConfig): Promise<CarrierScan[]> {
    const { ready, settings } = delhiveryReadiness(config);
    if (!ready || !settings) return [];
    // Resilient, not the plain call: one reference Delhivery has never seen
    // refuses the entire batch, and a send always contains new ones.
    return (await trackReferencesResilient(references, settings)).map(toCarrierScan);
  },

  async serviceability(pincodes: string[], config: CourierConfig): Promise<ServiceabilityMap> {
    const out: ServiceabilityMap = new Map();
    const { ready, settings } = delhiveryReadiness(config);
    if (!ready || !settings) return out;

    const answers = await checkPincodes(pincodes, settings);
    for (const [pin, answer] of answers) out.set(pin, answer.serviceable);
    return out;
  },
};

import { delhiveryRequest } from "./client";
import type { DelhiverySettings } from "./config";

/**
 * Delhivery's own packing slip for a parcel.
 *
 * Worth having alongside our shipping label rather than instead of it: this is
 * the document *they* recognise, with their barcode and their sorting centre
 * on it, so a parcel handed over with it needs no re-labelling at their end.
 *
 * They return JSON, not a PDF — the barcode is meant to be rendered from the
 * waybill number in Code 128. So this fetches the facts and leaves the drawing
 * to the caller, which is also what lets us put it on our own stationery.
 */

export interface PackingSlip {
  waybill: string;
  /** Our reference — they call it oid. */
  reference: string | null;
  consigneeName: string | null;
  address: string | null;
  pincode: string | null;
  originCentre: string | null;
  destinationCentre: string | null;
  destinationCity: string | null;
  /** Their sort code, which is what the hub actually reads. */
  sortCode: string | null;
  paymentMode: string | null;
  createdAt: string | null;
}

interface SlipResponse {
  packages?: {
    wbn?: string;
    oid?: string;
    name?: string;
    address?: string;
    pin?: number | string;
    origin?: string;
    destination?: string;
    destination_city?: string;
    sort_code?: string;
    pt?: string;
    cd?: string;
  }[];
}

export async function packingSlips(
  waybills: string[],
  settings: DelhiverySettings
): Promise<PackingSlip[]> {
  const wanted = waybills.filter(Boolean);
  if (!wanted.length) return [];

  const response = await delhiveryRequest<SlipResponse>({
    settings,
    path: "/api/p/packing_slip",
    query: { wbns: wanted.join(",") },
    retryOnNetworkError: true,
  });

  return (response.packages ?? []).map((p) => ({
    waybill: String(p.wbn ?? ""),
    reference: p.oid ?? null,
    consigneeName: p.name ?? null,
    address: p.address ?? null,
    pincode: p.pin != null ? String(p.pin) : null,
    originCentre: p.origin ?? null,
    destinationCentre: p.destination ?? null,
    destinationCity: p.destination_city ?? null,
    sortCode: p.sort_code ?? null,
    paymentMode: p.pt ?? null,
    createdAt: p.cd ?? null,
  }));
}

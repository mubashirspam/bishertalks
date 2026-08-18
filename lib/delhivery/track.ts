import { delhiveryRequest } from "./client";
import type { DelhiverySettings } from "./config";
import type { DelhiveryScan } from "./status";

/**
 * Asking Delhivery where a parcel is.
 *
 * The pull API is rate limited to 750 requests per 5 minutes per IP, which is
 * generous per *request* and unforgiving per *parcel* — a poller that loops one
 * waybill at a time burns the budget on a few hundred parcels. So this batches:
 * one request carries many waybills, and the caller chunks.
 */

/** Delhivery's own cap on how many waybills one query may carry. */
export const TRACK_BATCH = 50;

export interface TrackedParcel {
  waybill: string;
  /** Our order number, which they echo back as ReferenceNo. */
  reference: string | null;
  scan: DelhiveryScan;
  /**
   * Facts about the shipment itself, for checking that a *speculative* match
   * really is this order — see lib/delhivery/legacy.ts. Never needed when the
   * reference is one we minted, since that is unique by construction.
   *
   * Note their shape: `Destination` comes back empty and the real pincode is
   * on `Consignee`, and consignee telephone numbers are masked to "". A fact
   * they do not return cannot corroborate anything, which the matcher expects.
   */
  invoiceAmount: number | null;
  destinationPin: string | null;
  consigneePhone: string | null;
  consigneeName: string | null;
}

interface TrackResponse {
  /** Set instead of ShipmentData when they refuse the whole query. */
  Error?: string;
  ShipmentData?: {
    Shipment?: {
      AWB?: string;
      ReferenceNo?: string;
      Status?: {
        Status?: string;
        StatusType?: string;
        StatusDateTime?: string;
        StatusLocation?: string;
        Instructions?: string;
      };
      InvoiceAmount?: number | string;
      Consignee?: {
        Name?: string;
        PinCode?: number | string;
        Telephone1?: string;
        Telephone2?: string;
      };
    };
  }[];
}

/**
 * The latest scan for each of these waybills.
 *
 * Parcels Delhivery has never heard of are simply absent from the result — the
 * caller decides what that means, because "not found" a minute after a manifest
 * is a lag and a week after one is a problem.
 */
export async function trackWaybills(
  waybills: string[],
  settings: DelhiverySettings
): Promise<TrackedParcel[]> {
  return track({ waybill: waybills.filter(Boolean).slice(0, TRACK_BATCH).join(",") }, settings);
}

/**
 * The same, looked up by *our* reference instead of their waybill.
 *
 * This is what makes the parcels KKR already uploaded visible: every one of
 * them went out with a Reference No from `courier_reference` (migration 0024),
 * and Delhivery indexes on it. So a year of parcels we only ever handed over on
 * a spreadsheet can be tracked without anyone typing in a waybill — and the
 * waybill comes back in the same response, which is how they get one stored.
 *
 * Note their quirk: the parameter is `ref_ids`, and passing an order number
 * that was never a reference returns `{"Error": "No such waybill or Order Id
 * found"}` for the whole call rather than omitting that one entry.
 */
export async function trackReferences(
  references: string[],
  settings: DelhiverySettings
): Promise<TrackedParcel[]> {
  return track({ ref_ids: references.filter(Boolean).slice(0, TRACK_BATCH).join(",") }, settings);
}

/** One tracking call, however the parcels were named. */
async function track(
  query: Record<string, string>,
  settings: DelhiverySettings
): Promise<TrackedParcel[]> {
  if (!Object.values(query).some(Boolean)) return [];

  const response = await delhiveryRequest<TrackResponse>({
    settings,
    path: "/api/v1/packages/json/",
    query,
    // A read. Repeating it costs nothing and changes nothing.
    retryOnNetworkError: true,
  });

  // A whole-call refusal — an unknown reference does this rather than being
  // quietly left out. Not an error worth throwing over: the caller asked about
  // parcels Delhivery may legitimately never have seen.
  if (response.Error) {
    console.warn("[Delhivery] tracking:", response.Error, query);
    return [];
  }

  const out: TrackedParcel[] = [];

  for (const entry of response.ShipmentData ?? []) {
    const shipment = entry.Shipment;
    if (!shipment?.AWB) continue;

    const status = shipment.Status ?? {};
    const consignee = shipment.Consignee ?? {};
    const amount = Number(shipment.InvoiceAmount);

    out.push({
      waybill: String(shipment.AWB),
      reference: shipment.ReferenceNo ? String(shipment.ReferenceNo) : null,
      scan: {
        status: status.Status ?? "",
        statusType: status.StatusType ?? "",
        statusDateTime: status.StatusDateTime ?? null,
        location: status.StatusLocation ?? null,
        instructions: status.Instructions ?? null,
      },
      invoiceAmount: Number.isFinite(amount) ? amount : null,
      destinationPin: consignee.PinCode ? String(consignee.PinCode) : null,
      consigneePhone: consignee.Telephone1 || consignee.Telephone2 || null,
      consigneeName: consignee.Name || null,
    });
  }

  return out;
}

/** Split a long list into requests that stay inside their batch limit. */
export function trackingBatches(waybills: string[]): string[][] {
  const batches: string[][] = [];
  for (let i = 0; i < waybills.length; i += TRACK_BATCH) {
    batches.push(waybills.slice(i, i + TRACK_BATCH));
  }
  return batches;
}

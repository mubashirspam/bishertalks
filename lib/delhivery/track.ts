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
  return (await trackRaw(query, settings)).parcels;
}

/**
 * The same call, keeping the difference between "none of these" and "we would
 * not answer that".
 *
 * Delhivery refuses a whole `ref_ids` query the moment one id in it is unknown
 * to them — see the note on trackReferences — so a caller that cannot tell a
 * refusal from an empty result will read "one of these fifty is new" as "none
 * of these fifty exist". That difference is the whole of `refused`.
 */
async function trackRaw(
  query: Record<string, string>,
  settings: DelhiverySettings
): Promise<{ parcels: TrackedParcel[]; refused: boolean }> {
  if (!Object.values(query).some(Boolean)) return { parcels: [], refused: false };

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
    return { parcels: [], refused: true };
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

  return { parcels: out, refused: false };
}

/**
 * Look these references up without letting one unknown id lose the rest.
 *
 * The batch is tried first, because when every id is known that is a single
 * request for fifty parcels. If Delhivery refuses the whole query — which is
 * what one unrecognised id does — the ids are asked for individually, and only
 * the genuinely unknown ones come back empty.
 *
 * The fallback costs one request per parcel, so it is deliberately the second
 * thing tried rather than the first. Their pull limit is 750 requests per five
 * minutes, which a screenful never approaches and a whole-account sweep could:
 * a sweep that had to degrade would spend fifty requests on fifty parcels, so
 * callers doing thousands should keep passing known references.
 */
export async function trackReferencesResilient(
  references: string[],
  settings: DelhiverySettings
): Promise<TrackedParcel[]> {
  const ids = references.filter(Boolean).slice(0, TRACK_BATCH);
  if (!ids.length) return [];

  const batch = await trackRaw({ ref_ids: ids.join(",") }, settings);
  if (!batch.refused) return batch.parcels;

  // A single id cannot be poisoned by a neighbour — the batch WAS the id, so a
  // refusal is the answer, not a reason to ask the identical question again.
  // Without this every check on a parcel Delhivery has never seen costs two
  // requests instead of one, which is most of them on a normal send.
  if (ids.length === 1) return [];

  // One at a time. A single id cannot poison itself, so whatever exists is
  // found and whatever does not is simply absent — which is the answer the
  // caller wanted from the batch in the first place.
  const found: TrackedParcel[] = [];
  for (const id of ids) {
    const one = await trackRaw({ ref_ids: id }, settings);
    found.push(...one.parcels);
  }
  return found;
}

/** Split a long list into requests that stay inside their batch limit. */
export function trackingBatches(waybills: string[]): string[][] {
  const batches: string[][] = [];
  for (let i = 0; i < waybills.length; i += TRACK_BATCH) {
    batches.push(waybills.slice(i, i + TRACK_BATCH));
  }
  return batches;
}

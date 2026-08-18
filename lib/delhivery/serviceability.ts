import { delhiveryRequest } from "./client";
import type { DelhiverySettings } from "./config";

/**
 * Does Delhivery deliver here?
 *
 * Used to drop an unserviceable parcel out of a batch before it is sent, rather
 * than have Delhivery refuse the whole file. Kerala is well covered, so this
 * will almost always come back yes — which is exactly why it is worth checking
 * cheaply instead of discovering the exception with fifty parcels selected.
 *
 * Advisory by design. A lookup that fails does not block a send: being unable
 * to ask whether an address is deliverable is not evidence that it isn't, and
 * refusing to work because a secondary API is down would be worse than the
 * problem it prevents.
 */

interface PinResponse {
  delivery_codes?: {
    postal_code?: {
      pin?: number | string;
      /** "Y"/"N" — whether prepaid shipments are accepted here. */
      pre_paid?: string;
      /** "Y"/"N" — whether they collect from here at all. */
      pickup?: string;
      district?: string;
      state_code?: string;
    };
  }[];
}

export interface Serviceability {
  pincode: string;
  /** Undefined when we could not find out — never treated as "no". */
  serviceable: boolean | undefined;
}

/**
 * Check a set of pincodes. Their API takes one code per call, so this is
 * deliberately called with the *distinct* pincodes in a batch — a day's parcels
 * to one town is one lookup, not fifty.
 */
export async function checkPincodes(
  pincodes: string[],
  settings: DelhiverySettings
): Promise<Map<string, Serviceability>> {
  const out = new Map<string, Serviceability>();
  const distinct = [...new Set(pincodes.filter((p) => /^\d{6}$/.test(p)))];

  for (const pincode of distinct) {
    try {
      const response = await delhiveryRequest<PinResponse>({
        settings,
        path: "/c/api/pin-codes/json/",
        query: { filter_codes: pincode },
        retryOnNetworkError: true,
      });

      const code = response.delivery_codes?.[0]?.postal_code;

      // An empty list is their way of saying "not serviced" — the docs call it
      // NSZ. A present record with pre_paid "N" means they reach it but will
      // not take a prepaid parcel there, which for us is the same answer.
      const serviceable = !code
        ? false
        : String(code.pre_paid ?? "Y").toUpperCase() !== "N";

      out.set(pincode, { pincode, serviceable });
    } catch (e) {
      // Unknown, not unserviceable. The send goes ahead.
      console.warn("[Delhivery] serviceability lookup failed for", pincode, e);
      out.set(pincode, { pincode, serviceable: undefined });
    }
  }

  return out;
}

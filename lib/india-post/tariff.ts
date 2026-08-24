import { indiaPostRequest } from "./client";
import { ENDPOINTS, type IndiaPostSettings } from "./config";
import { postalParcel } from "./parcel";

/**
 * What India Post will charge for a parcel.
 *
 * The counterpart of lib/delhivery/charges.ts, and it writes the same two
 * columns — `courier_freight_paise` and `courier_charge_detail`, added in
 * migration 0037 — so the margin figures in /admin/reports pick Speed Post up
 * with no change at all.
 *
 * A read, so it retries on a dropped connection. Asking twice what a parcel
 * costs changes nothing.
 *
 * Note what their answer decides for us: **they pick the product from the
 * weight**, whatever we ask for. Under 500 g comes back as SP_INLAND_DOC even
 * when the box is 2.5 cm thick and cannot be a document. `product_code` in the
 * response is therefore the live answer to the question in §2.1 of the plan,
 * and worth reading rather than assuming.
 */

export interface PostalTariff {
  /** What we will be charged, in paise, tax included. */
  paise: number;
  /** Their product, decided by them. */
  productCode: string;
  /** Grams they will actually bill — the higher of actual and volumetric. */
  chargeableWeightGrams: number | null;
  /** Their whole answer, stored rather than flattened. */
  detail: Record<string, unknown>;
}

interface TariffResponse {
  success?: boolean;
  product_code?: string;
  chargeable_weight?: number;
  final_amount?: number;
  message?: string;
}

/**
 * Price one parcel between two pincodes.
 *
 * Weight goes as a whole number because their documentation is explicit that
 * decimals are rejected; dimensions may be fractional and a book's 2.5 cm is
 * sent as it is.
 */
export async function quote(
  settings: IndiaPostSettings,
  input: {
    quantity: number;
    isGift?: boolean;
    sourcePincode: string;
    destinationPincode: string;
    /** Declared value, in rupees, if the parcel is being insured. */
    insureRupees?: number;
  }
): Promise<PostalTariff | null> {
  const parcel = postalParcel(input.quantity, input.isGift);

  const source = input.sourcePincode.replace(/\D/g, "");
  const destination = input.destinationPincode.replace(/\D/g, "");
  if (source.length !== 6 || destination.length !== 6) {
    console.warn("[India Post] tariff skipped — pincodes must be six digits");
    return null;
  }

  const response = await indiaPostRequest<TariffResponse>({
    settings,
    path: ENDPOINTS.speedPostTariff,
    query: {
      "product-code": "SP",
      // Whole grams. Their validator refuses decimals outright.
      weight: Math.round(parcel.weightGrams),
      "source-pincode": source,
      "destination-pincode": destination,
      length: parcel.lengthCm,
      width: parcel.breadthCm,
      height: parcel.heightCm,
      INS: input.insureRupees && input.insureRupees > 0 ? input.insureRupees : undefined,
    },
    retryOnNetworkError: true,
  });

  const amount = Number(response.final_amount);
  if (!Number.isFinite(amount)) {
    console.warn("[India Post] tariff had no final_amount:", response.message ?? "");
    return null;
  }

  return {
    // Their amount is rupees, and can carry paise — 17.7 appears in their own
    // tracking samples. Rounded to the paise we store rather than truncated.
    paise: Math.round(amount * 100),
    productCode: response.product_code ?? "",
    chargeableWeightGrams: Number.isFinite(Number(response.chargeable_weight))
      ? Number(response.chargeable_weight)
      : null,
    detail: response as unknown as Record<string, unknown>,
  };
}

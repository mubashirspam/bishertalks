import { delhiveryRequest } from "./client";
import type { DelhiverySettings } from "./config";
import { COURIER_DEFAULTS, parcelSize } from "@/lib/courier-sheet";

/**
 * What Delhivery bills us for carrying a parcel.
 *
 * The only per-parcel cost in this business that is a real number rather than
 * an estimate. Printing, packaging and the rest are typed into /admin/reports
 * by hand and are educated guesses; this one the courier will actually invoice,
 * and it varies by distance and weight in ways nobody can hold in their head —
 * a book to the next town and a book to Lakshadweep are not the same cost.
 *
 * Priced from origin pincode, destination pincode and chargeable weight. Their
 * answer breaks down into a dozen surcharges; `total_amount` is the one that
 * matters, and the rest is kept whole rather than flattened into columns that
 * guess at a shape we did not design.
 */

/** Their `md`: S is surface, E is express. */
const MODE: Record<string, string> = { Surface: "S", Express: "E" };

interface ChargeRow {
  status?: string;
  zone?: string;
  /** Rupees, including tax. The number they will bill. */
  total_amount?: number;
  gross_amount?: number;
  charged_weight?: number;
  [key: string]: unknown;
}

export interface FreightCharge {
  /** Paise, so it lines up with every other money column. */
  paise: number;
  zone: string | null;
  chargedWeightGrams: number | null;
  /** Their whole breakdown, as given. */
  detail: Record<string, unknown>;
}

/**
 * Price one parcel.
 *
 * `status` is which journey to price: a delivered parcel and one that came
 * back cost different amounts, and asking for the wrong one understates the
 * bill on every RTO.
 */
export async function freightFor(
  {
    destinationPin,
    grams,
    status = "Delivered",
  }: { destinationPin: string; grams: number; status?: "Delivered" | "RTO" | "DTO" },
  settings: DelhiverySettings
): Promise<FreightCharge | null> {
  const dPin = (destinationPin ?? "").replace(/\D/g, "");
  const oPin = String(COURIER_DEFAULTS.returnPin);
  if (!/^\d{6}$/.test(dPin)) return null;

  const rows = await delhiveryRequest<ChargeRow[]>({
    settings,
    path: "/api/kinko/v1/invoice/charges/.json",
    query: {
      md: MODE[settings.shippingMode] ?? "S",
      ss: status,
      d_pin: dPin,
      o_pin: oPin,
      cgm: String(Math.max(1, Math.round(grams))),
      pt: "Pre-paid",
    },
    // A read, and a pure one — it prices a hypothetical parcel and creates
    // nothing, so repeating it is free.
    retryOnNetworkError: true,
  });

  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row || typeof row.total_amount !== "number") return null;

  return {
    // Their figure is rupees with paise after the point; round to whole paise
    // rather than truncating, or a batch of parcels drifts a rupee low.
    paise: Math.round(row.total_amount * 100),
    zone: row.zone ?? null,
    chargedWeightGrams: typeof row.charged_weight === "number" ? row.charged_weight : null,
    detail: row as Record<string, unknown>,
  };
}

/** What a parcel of this many books weighs, by the same rule the sheet uses. */
export const parcelGrams = (quantity: number, isGift = false) =>
  parcelSize(quantity, isGift).weightGrams;

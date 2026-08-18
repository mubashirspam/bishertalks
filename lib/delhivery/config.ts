/**
 * Delhivery credentials and settings.
 *
 * What is actually mandatory, from Delhivery's own Postman collection rather
 * than the prose docs — which overstate it badly:
 *
 *   Per shipment:  add, phone, payment_mode, name, pin, order
 *   Per payload:   pickup_location.name
 *
 * `seller_gst_tin`, `hsn_code`, `client_gst_tin` and friends are marked
 * "for ewaybill" — an e-waybill is only required when a single shipment is
 * worth ₹50,000 or more. A ₹699 book needs none of them, so requiring them up
 * front (as this module first did) blocked every send for no reason. They are
 * now sent when we have them and when the value crosses the threshold.
 *
 * `client` is documented as optional too.
 */

export type DelhiveryEnv = "staging" | "production";

const BASES: Record<DelhiveryEnv, string> = {
  staging: "https://staging-express.delhivery.com",
  production: "https://track.delhivery.com",
};

/**
 * The value above which Delhivery wants an e-waybill, in paise.
 *
 * Nothing we sell comes close — a hundred books would not — but the check is
 * cheap and the failure mode without it is a rejected shipment nobody can
 * explain.
 */
export const EWAYBILL_THRESHOLD_PAISE = 50_000_00;

/**
 * Which Delhivery we are talking to.
 *
 * Defaults to staging so that untested payload code cannot create real
 * shipments by accident. Note that a staging token is a *separate* token —
 * a production one returns 401 against the staging host, which is exactly what
 * "Login or API Key Required" means when it appears in the logs.
 */
export function delhiveryEnv(): DelhiveryEnv {
  return process.env.DELHIVERY_ENV === "production" ? "production" : "staging";
}

export function delhiveryBaseUrl(): string {
  return BASES[delhiveryEnv()];
}

export interface DelhiverySettings {
  token: string;
  env: DelhiveryEnv;
  baseUrl: string;
  /** Must match a warehouse Delhivery has registered, exactly. */
  pickupLocation: string;
  /** The rest of the warehouse, which their working examples all send. */
  pickupCity?: string;
  pickupPin?: string;
  pickupPhone?: string;
  pickupAddress?: string;
  /** Optional: their registered name for our account. */
  clientName?: string;
  /** Optional: only reaches the payload on an e-waybill-sized shipment. */
  sellerGstTin?: string;
  hsnCode?: string;
  /** "Surface" or "Express". */
  shippingMode: string;
}

export interface CourierConfigShape {
  pickup_location?: string;
  pickup_city?: string;
  pickup_pin?: string;
  pickup_phone?: string;
  pickup_address?: string;
  client_name?: string;
  mode?: string;
}

/**
 * What is still missing before a send could possibly work.
 *
 * Two things, and only two. Anything else Delhivery can fill in or do without,
 * and a gate that asks for more than the API does is a gate that stops work for
 * no reason.
 */
export function delhiveryReadiness(courierConfig: CourierConfigShape): {
  ready: boolean;
  missing: string[];
  settings: DelhiverySettings | null;
} {
  const missing: string[] = [];

  const token = process.env.DELHIVERY_API_TOKEN ?? "";
  const pickupLocation = courierConfig.pickup_location ?? "";

  if (!token) missing.push("The API token (DELHIVERY_API_TOKEN)");
  if (!pickupLocation) {
    missing.push(
      "The pickup location, spelled exactly as Delhivery has it registered — set it on the courier"
    );
  }

  if (missing.length) return { ready: false, missing, settings: null };

  return {
    ready: true,
    missing: [],
    settings: {
      token,
      env: delhiveryEnv(),
      baseUrl: delhiveryBaseUrl(),
      pickupLocation,
      pickupCity: courierConfig.pickup_city || undefined,
      pickupPin: courierConfig.pickup_pin || undefined,
      pickupPhone: courierConfig.pickup_phone || undefined,
      pickupAddress: courierConfig.pickup_address || undefined,
      clientName: courierConfig.client_name || process.env.DELHIVERY_CLIENT_NAME || undefined,
      sellerGstTin: process.env.DELHIVERY_SELLER_GST || undefined,
      hsnCode: process.env.DELHIVERY_HSN_CODE || undefined,
      shippingMode: courierConfig.mode === "express" ? "Express" : "Surface",
    },
  };
}

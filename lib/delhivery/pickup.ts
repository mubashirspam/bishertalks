import { delhiveryRequest } from "./client";
import type { DelhiverySettings } from "./config";

/**
 * Asking Delhivery to come and collect.
 *
 * Manifesting a parcel creates the waybill; it does not summon a van. For a
 * franchise pickup that happens on a standing arrangement, but where it
 * doesn't, this is the call that books one — and its absence is the difference
 * between "the label exists" and "the parcel left the building".
 *
 * Separate from the send route on purpose: a pickup is booked once for a day's
 * parcels, not once per parcel, and Delhivery counts repeat requests for the
 * same slot against you.
 */

interface PickupResponse {
  pickup_id?: number | string;
  pr_exist?: boolean;
  /** Their wording on refusal — slot full, location unknown, too late. */
  error?: string[] | string;
  message?: string;
}

export interface PickupResult {
  ok: boolean;
  pickupId: string | null;
  message: string;
}

/**
 * Book a collection.
 *
 * `date` is YYYY-MM-DD and `time` is HH:MM:SS, both in IST — their scheduler
 * works in local time and silently misreads anything else.
 */
export async function requestPickup(
  {
    date,
    time,
    packageCount,
  }: { date: string; time: string; packageCount: number },
  settings: DelhiverySettings
): Promise<PickupResult> {
  const response = await delhiveryRequest<PickupResponse>({
    settings,
    path: "/fm/request/new/",
    method: "POST",
    json: {
      pickup_time: time,
      pickup_date: date,
      pickup_location: settings.pickupLocation,
      expected_package_count: Math.max(1, Math.round(packageCount)),
    },
    // Books a slot on their side. A silent repeat would double-book a van.
    retryOnNetworkError: false,
  });

  const error = Array.isArray(response.error)
    ? response.error.filter(Boolean).join("; ")
    : (response.error ?? "");

  const ok = !!response.pickup_id && !error;

  return {
    ok,
    pickupId: response.pickup_id ? String(response.pickup_id) : null,
    message:
      error ||
      response.message ||
      (ok ? `Pickup booked for ${date} at ${time}.` : "Delhivery would not book that pickup."),
  };
}

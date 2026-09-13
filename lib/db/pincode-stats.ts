import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Which pincodes KKR's Delhivery service has actually earned, versus which
 * ones haven't proven themselves (or have been refused) yet.
 *
 * The table itself — `pincode_delivery_stats` — is maintained by triggers in
 * migration 0078, not by anything here: a delivery, a return, or a fresh
 * "not serviceable" answer recomputes its own pincode's row the moment it
 * happens. This module only reads it.
 */

export interface PincodeStat {
  pincode: string;
  state: string | null;
  district: string | null;
  deliveredCount: number;
  fastDeliveredCount: number;
  returnedCount: number;
  delhiveryEligible: boolean;
  computedAt: string;
}

function toStat(row: {
  pincode: string;
  state: string | null;
  district: string | null;
  delivered_count: number;
  fast_delivered_count: number;
  returned_count: number;
  delhivery_eligible: boolean;
  computed_at: string;
}): PincodeStat {
  return {
    pincode: row.pincode,
    state: row.state,
    district: row.district,
    deliveredCount: row.delivered_count,
    fastDeliveredCount: row.fast_delivered_count,
    returnedCount: row.returned_count,
    delhiveryEligible: row.delhivery_eligible,
    computedAt: row.computed_at,
  };
}

/**
 * Every pincode on the eligible or not-eligible side of the line — for the
 * /admin/delivery "Courier fit" filter, which narrows the queue to exactly
 * this list via `.in("pincode", …)` rather than joining the table directly
 * (portal_orders is a hand-applied view; adding a join to it risks the same
 * staleness problem documented on fetchPortalPage).
 */
export async function pincodesByFit(
  eligible: boolean
): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from("pincode_delivery_stats")
    .select("pincode")
    .eq("delhivery_eligible", eligible);

  if (error) {
    console.error("[Pincode stats] fit lookup failed:", error.message);
    return [];
  }
  return (data ?? []).map((r) => (r as { pincode: string }).pincode);
}

/** One pincode's record, or null if nothing has ever routed there yet. */
export async function pincodeStat(pincode: string): Promise<PincodeStat | null> {
  if (!pincode) return null;
  const { data, error } = await supabaseAdmin
    .from("pincode_delivery_stats")
    .select("pincode,state,district,delivered_count,fast_delivered_count,returned_count,delhivery_eligible,computed_at")
    .eq("pincode", pincode)
    .maybeSingle();

  if (error) {
    console.error("[Pincode stats] lookup failed:", pincode, error.message);
    return null;
  }
  return data ? toStat(data as Parameters<typeof toStat>[0]) : null;
}

/** Several pincodes at once — for badging a page of delivery-queue rows. */
export async function pincodeStats(pincodes: string[]): Promise<Map<string, PincodeStat>> {
  const wanted = [...new Set(pincodes.filter(Boolean))];
  const out = new Map<string, PincodeStat>();
  if (!wanted.length) return out;

  const { data, error } = await supabaseAdmin
    .from("pincode_delivery_stats")
    .select("pincode,state,district,delivered_count,fast_delivered_count,returned_count,delhivery_eligible,computed_at")
    .in("pincode", wanted);

  if (error) {
    console.error("[Pincode stats] batch lookup failed:", error.message);
    return out;
  }
  for (const row of (data ?? []) as Parameters<typeof toStat>[0][]) {
    out.set(row.pincode, toStat(row));
  }
  return out;
}

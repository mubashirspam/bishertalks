import { supabaseAdmin } from "@/lib/supabase/admin";
import { checkPincodes } from "@/lib/delhivery/serviceability";
import { delhiveryReadiness } from "@/lib/delhivery/config";
import { canTrack, type Courier } from "@/lib/couriers";

/**
 * Can this courier reach this pincode?
 *
 * Answered from a cache first (migration 0034), because a day's parcels
 * cluster on a handful of towns — Kozhikode alone is hundreds — and asking
 * the courier once per parcel would spend the 750-request budget re-answering
 * the same question. The cache is keyed on the pair, since serviceability
 * belongs to the pair: Delhivery reaching a village says nothing about India
 * Post.
 *
 * Deliberately fails open. A courier we cannot ask is not a courier that
 * cannot deliver, so an unreachable API leaves the answer unknown and lets the
 * parcel through. Blocking a day's dispatch because a secondary lookup was
 * down would be a worse outcome than the problem it prevents.
 */

/** How long an answer is trusted. Coverage changes, but not hourly. */
const CACHE_DAYS = 30;

export interface ServiceabilityAnswer {
  pincode: string;
  /** undefined = we could not find out. Never treated as "no". */
  serviceable: boolean | undefined;
}

/**
 * Look up a set of pincodes, using the cache and topping it up.
 *
 * Returns a map keyed by pincode. Codes that are not six digits are absent —
 * a malformed address is a different problem, and answering "unserviceable"
 * for it would send someone to fix the wrong thing.
 */
export async function serviceabilityFor(
  courier: Courier,
  pincodes: string[]
): Promise<Map<string, ServiceabilityAnswer>> {
  const out = new Map<string, ServiceabilityAnswer>();
  const wanted = [...new Set(pincodes.map((p) => (p ?? "").replace(/\D/g, "")))].filter(
    (p) => /^\d{6}$/.test(p)
  );
  if (!wanted.length) return out;

  // Only a courier with an integration can be asked at all. For everyone else
  // the honest answer is "we have no way to know", not "no".
  if (!canTrack(courier)) {
    for (const p of wanted) out.set(p, { pincode: p, serviceable: undefined });
    return out;
  }

  const fresh = new Date(Date.now() - CACHE_DAYS * 864e5).toISOString();
  const { data: cached } = await supabaseAdmin
    .from("courier_serviceability")
    .select("pincode,serviceable")
    .eq("courier_id", courier.id)
    .in("pincode", wanted)
    .gte("checked_at", fresh);

  for (const row of (cached ?? []) as { pincode: string; serviceable: boolean }[]) {
    out.set(row.pincode, { pincode: row.pincode, serviceable: row.serviceable });
  }

  const missing = wanted.filter((p) => !out.has(p));
  if (!missing.length) return out;

  const { ready, settings } = delhiveryReadiness(courier.config);
  if (!ready || !settings) {
    for (const p of missing) out.set(p, { pincode: p, serviceable: undefined });
    return out;
  }

  let answers: Map<string, { serviceable: boolean | undefined }>;
  try {
    answers = await checkPincodes(missing, settings);
  } catch (e) {
    console.warn("[Serviceability] lookup failed, leaving unknown:", e);
    for (const p of missing) out.set(p, { pincode: p, serviceable: undefined });
    return out;
  }

  const rows: { courier_id: string; pincode: string; serviceable: boolean }[] = [];
  for (const p of missing) {
    const serviceable = answers.get(p)?.serviceable;
    out.set(p, { pincode: p, serviceable });
    // Only a definite answer is cached. Caching "we could not reach them"
    // would turn one outage into thirty days of wrong refusals.
    if (serviceable !== undefined) {
      rows.push({ courier_id: courier.id, pincode: p, serviceable });
    }
  }

  if (rows.length) {
    const { error } = await supabaseAdmin
      .from("courier_serviceability")
      .upsert(
        rows.map((r) => ({ ...r, checked_at: new Date().toISOString() })),
        { onConflict: "courier_id,pincode" }
      );
    if (error) console.error("[Serviceability] cache write failed:", error.message);
  }

  return out;
}

/**
 * Record the answer against the orders themselves.
 *
 * Stored per order as well as cached per pincode so the state derivation can
 * read it without a join, and so a parcel keeps the answer that was true when
 * it was routed.
 */
export async function recordServiceability(
  orderNumbers: string[],
  serviceable: boolean
): Promise<void> {
  if (!orderNumbers.length) return;

  const { error } = await supabaseAdmin
    .from("orders")
    .update({
      pincode_serviceable: serviceable,
      pincode_checked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .in("order_number", orderNumbers);

  if (error) console.error("[Serviceability] order write failed:", error.message);
}

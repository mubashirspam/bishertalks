import { supabaseAdmin } from "@/lib/supabase/admin";
import type { CurrentStaff } from "@/lib/admin-auth";
import { audit } from "@/lib/audit";

/**
 * Which pincodes KKR's Delhivery service has actually earned, versus which
 * ones haven't proven themselves (or have been refused) yet.
 *
 * The table itself — `pincode_delivery_stats` — is maintained by triggers in
 * migration 0078/0079, not by anything here: a delivery, a return, or a
 * fresh "not serviceable" answer recomputes its own pincode's row the moment
 * it happens. `delhivery_eligible` is the one column everything else reads
 * (the filter, the queue badge); since 0080 it is
 * COALESCE(manual_override, computed_eligible) rather than the rule alone,
 * so an owner's correction survives the next recompute instead of being
 * overwritten by it.
 */

const SELECT_COLUMNS =
  "pincode,state,district,delivered_count,fast_delivered_count,returned_count," +
  "computed_eligible,delhivery_eligible,manual_override,override_reason,override_by,override_at,computed_at";

interface Row {
  pincode: string;
  state: string | null;
  district: string | null;
  delivered_count: number;
  fast_delivered_count: number;
  returned_count: number;
  computed_eligible: boolean | null;
  delhivery_eligible: boolean;
  manual_override: boolean | null;
  override_reason: string | null;
  override_by: string | null;
  override_at: string | null;
  computed_at: string;
}

export interface PincodeStat {
  pincode: string;
  state: string | null;
  district: string | null;
  deliveredCount: number;
  fastDeliveredCount: number;
  returnedCount: number;
  /** The rule's own answer, ignoring any override — see recompute_pincode_delivery_stats. */
  computedEligible: boolean;
  /** COALESCE(manualOverride, computedEligible) — what the filter and badge actually use. */
  delhiveryEligible: boolean;
  /** null = nobody has pinned this pincode; true/false = an owner has, and it wins. */
  manualOverride: boolean | null;
  overrideReason: string | null;
  overrideBy: string | null;
  overrideAt: string | null;
  computedAt: string;
}

function toStat(row: Row): PincodeStat {
  return {
    pincode: row.pincode,
    state: row.state,
    district: row.district,
    deliveredCount: row.delivered_count,
    fastDeliveredCount: row.fast_delivered_count,
    returnedCount: row.returned_count,
    computedEligible: row.computed_eligible ?? row.delhivery_eligible,
    delhiveryEligible: row.delhivery_eligible,
    manualOverride: row.manual_override,
    overrideReason: row.override_reason,
    overrideBy: row.override_by,
    overrideAt: row.override_at,
    computedAt: row.computed_at,
  };
}

/**
 * Every pincode on the eligible or not-eligible side of the line — for the
 * /admin/delivery "Courier fit" filter, which narrows the queue to exactly
 * this list via `.in("pincode", …)` rather than joining the table directly
 * (portal_orders is a hand-applied view; adding a join to it risks the same
 * staleness problem documented on fetchPortalPage).
 *
 * Paginated in 1000s: PostgREST caps a single response at 1000 rows, and the
 * "not eligible" side alone is over 1400 — an unpaginated read here silently
 * dropped the tail of that list and quietly excluded real, valid pincodes
 * from the filter.
 */
export async function pincodesByFit(eligible: boolean): Promise<string[]> {
  const out: string[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from("pincode_delivery_stats")
      .select("pincode")
      .eq("delhivery_eligible", eligible)
      .range(from, from + 999);

    if (error) {
      console.error("[Pincode stats] fit lookup failed:", error.message);
      break;
    }
    out.push(...(data ?? []).map((r) => (r as { pincode: string }).pincode));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** One pincode's record, or null if nothing has ever routed there yet. */
export async function pincodeStat(pincode: string): Promise<PincodeStat | null> {
  if (!pincode) return null;
  const { data, error } = await supabaseAdmin
    .from("pincode_delivery_stats")
    .select(SELECT_COLUMNS)
    .eq("pincode", pincode)
    .maybeSingle();

  if (error) {
    console.error("[Pincode stats] lookup failed:", pincode, error.message);
    return null;
  }
  return data ? toStat(data as unknown as Row) : null;
}

/** Several pincodes at once — for badging a page of delivery-queue rows. */
export async function pincodeStats(pincodes: string[]): Promise<Map<string, PincodeStat>> {
  const wanted = [...new Set(pincodes.filter(Boolean))];
  const out = new Map<string, PincodeStat>();
  if (!wanted.length) return out;

  const { data, error } = await supabaseAdmin
    .from("pincode_delivery_stats")
    .select(SELECT_COLUMNS)
    .in("pincode", wanted);

  if (error) {
    console.error("[Pincode stats] batch lookup failed:", error.message);
    return out;
  }
  for (const row of (data ?? []) as unknown as Row[]) {
    out.set(row.pincode, toStat(row));
  }
  return out;
}

export type PincodeFilter = "all" | "eligible" | "not_eligible" | "overridden";

/**
 * One page of the pincode table, for the browse-and-override screen.
 *
 * `search` matches the pincode itself or its district/state, so "malappuram"
 * finds every pincode in it without anyone needing to know the six digits.
 */
export async function listPincodeStats(opts: {
  search?: string;
  filter?: PincodeFilter;
  pageNum?: number;
  perPage?: number;
}): Promise<{ rows: PincodeStat[]; count: number }> {
  const pageNum = opts.pageNum ?? 0;
  const perPage = opts.perPage ?? 50;

  let query = supabaseAdmin
    .from("pincode_delivery_stats")
    .select(SELECT_COLUMNS, { count: "exact" });

  if (opts.search?.trim()) {
    const term = opts.search.trim().replace(/[%,()]/g, "");
    query = query.or(`pincode.ilike.%${term}%,district.ilike.%${term}%,state.ilike.%${term}%`);
  }

  if (opts.filter === "eligible") query = query.eq("delhivery_eligible", true);
  else if (opts.filter === "not_eligible") query = query.eq("delhivery_eligible", false);
  else if (opts.filter === "overridden") query = query.not("manual_override", "is", null);

  const { data, count, error } = await query
    .order("delivered_count", { ascending: false })
    .range(pageNum * perPage, (pageNum + 1) * perPage - 1);

  if (error) {
    console.error("[Pincode stats] list failed:", error.message);
    return { rows: [], count: 0 };
  }
  return { rows: (data as unknown as Row[]).map(toStat), count: count ?? 0 };
}

/**
 * Pin a pincode's eligibility by hand, overriding whatever the rule says —
 * or clear a pin (`override: null`) to let the rule decide again.
 *
 * Upserts rather than requiring the row to already exist: a brand-new
 * pincode with zero history has computed_eligible = false by default, and an
 * owner who already knows better (a new local hub, a courier's own promise)
 * shouldn't have to wait for three deliveries to prove it before being able
 * to say so.
 */
export async function setPincodeOverride(
  pincode: string,
  override: boolean | null,
  staff: CurrentStaff,
  reason: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  const clean = pincode.trim();
  if (!/^\d{6}$/.test(clean)) {
    return { ok: false, error: "Pincode must be 6 digits." };
  }

  const { data: existing } = await supabaseAdmin
    .from("pincode_delivery_stats")
    .select("computed_eligible,delhivery_eligible")
    .eq("pincode", clean)
    .maybeSingle();

  const computed = existing?.computed_eligible ?? existing?.delhivery_eligible ?? false;
  const effective = override ?? computed;

  const { error } = await supabaseAdmin.from("pincode_delivery_stats").upsert(
    {
      pincode: clean,
      computed_eligible: computed,
      delhivery_eligible: effective,
      manual_override: override,
      override_reason: override === null ? null : reason?.trim() || null,
      override_by: override === null ? null : staff.id,
      override_at: override === null ? null : new Date().toISOString(),
      computed_at: existing ? undefined : new Date().toISOString(),
    },
    { onConflict: "pincode" }
  );

  if (error) {
    console.error("[Pincode stats] override write failed:", clean, error.message);
    return { ok: false, error: "Could not save that." };
  }

  await audit({
    actor: staff,
    action: "pincode.override",
    entity: "pincode",
    entityId: clean,
    meta: { override, reason: reason?.trim() || null },
  });

  return { ok: true };
}

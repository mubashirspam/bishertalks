import { supabaseAdmin } from "@/lib/supabase/admin";
import { normalizePhone } from "@/lib/db/users";
import {
  normalizeCode,
  isValidCodeFormat,
  generateCode,
  commissionPaise,
  refereeDiscountPaise,
} from "@/lib/referral";

export interface Referrer {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  email: string | null;
  upi_id: string | null;
  type: "customer" | "affiliate" | "staff";
  commission_type: "percent" | "flat";
  commission_value: number;
  is_active: boolean;
  clicks: number;
  user_id: string | null;
  notes: string | null;
  created_at: string;
}

export interface ReferralSettings {
  is_enabled: boolean;
  customer_commission_rupees: number;
  affiliate_commission_percent: number;
  referee_discount_rupees: number;
}

const REFERRER_COLUMNS =
  "id,code,name,phone,email,upi_id,type,commission_type,commission_value," +
  "is_active,clicks,user_id,notes,created_at";

/** Falls back to the migration defaults if the settings row is ever missing. */
const DEFAULT_SETTINGS: ReferralSettings = {
  is_enabled: true,
  customer_commission_rupees: 75,
  affiliate_commission_percent: 15,
  referee_discount_rupees: 50,
};

export async function getReferralSettings(): Promise<ReferralSettings> {
  const { data } = await supabaseAdmin
    .from("referral_settings")
    .select("is_enabled,customer_commission_rupees,affiliate_commission_percent,referee_discount_rupees")
    .eq("id", true)
    .maybeSingle();
  return (data as ReferralSettings) ?? DEFAULT_SETTINGS;
}

export async function updateReferralSettings(
  patch: Partial<ReferralSettings>
): Promise<ReferralSettings | null> {
  const { data, error } = await supabaseAdmin
    .from("referral_settings")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", true)
    .select("is_enabled,customer_commission_rupees,affiliate_commission_percent,referee_discount_rupees")
    .single();

  if (error) {
    console.error("[Referrals] settings update failed:", error.message);
    return null;
  }
  return data as ReferralSettings;
}

export async function getReferrerByCode(rawCode: string): Promise<Referrer | null> {
  const code = normalizeCode(rawCode);
  if (!isValidCodeFormat(code)) return null;

  const { data } = await supabaseAdmin
    .from("referrers")
    .select(REFERRER_COLUMNS)
    .ilike("code", code)
    .maybeSingle();
  return (data as unknown as Referrer) ?? null;
}

export async function getReferrerByPhone(rawPhone: string): Promise<Referrer | null> {
  const phone = normalizePhone(rawPhone);
  if (!phone) return null;

  const { data } = await supabaseAdmin
    .from("referrers")
    .select(REFERRER_COLUMNS)
    .eq("phone", phone)
    .maybeSingle();
  return (data as unknown as Referrer) ?? null;
}

export async function listReferrers(): Promise<Referrer[]> {
  const { data } = await supabaseAdmin
    .from("referrers")
    .select(REFERRER_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(500);
  return (data as unknown as Referrer[]) ?? [];
}

/** Share link opened. Fire and forget — a lost click must not break the redirect. */
export async function recordClick(code: string): Promise<void> {
  try {
    await supabaseAdmin.rpc("bump_referrer_clicks", { p_code: normalizeCode(code) });
  } catch (e) {
    console.error("[Referrals] click count failed:", e);
  }
}

// ── Applying a code at checkout ─────────────────────────────────────────────

export interface AppliedReferral {
  referrerId: string;
  code: string;
  /** What the buyer saves, in paise. */
  discountPaise: number;
  /** What the referrer earns, in paise, computed on the discounted amount. */
  commissionPaise: number;
}

/**
 * Validate a code against a specific buyer and work out both sides of the deal.
 *
 * Returns null — silently, not as an error — whenever the code can't be used.
 * A checkout must never fail because of a referral: the worst outcome of a
 * stale or mistyped code is that the order goes through at full price.
 */
export async function applyReferral(params: {
  rawCode: string | null | undefined;
  buyerPhone: string | null;
  amountPaise: number;
}): Promise<AppliedReferral | null> {
  const { rawCode, buyerPhone, amountPaise } = params;
  if (!rawCode) return null;

  try {
    const settings = await getReferralSettings();
    if (!settings.is_enabled) return null;

    const referrer = await getReferrerByCode(rawCode);
    if (!referrer || !referrer.is_active) return null;

    // Self-referral. Everyone tries it, and it's a straight discount plus a
    // commission paid to yourself.
    if (
      buyerPhone &&
      referrer.phone &&
      normalizePhone(buyerPhone) === normalizePhone(referrer.phone)
    ) {
      return null;
    }

    const discountPaise = refereeDiscountPaise(
      amountPaise,
      settings.referee_discount_rupees
    );

    return {
      referrerId: referrer.id,
      code: referrer.code,
      discountPaise,
      // Commission on what's actually paid, after the discount this same code
      // just granted — never on money that never arrived.
      commissionPaise: commissionPaise({
        orderPaise: amountPaise - discountPaise,
        commissionType: referrer.commission_type,
        commissionValue: referrer.commission_value,
      }),
    };
  } catch (e) {
    console.error("[Referrals] applyReferral failed:", e);
    return null;
  }
}

// ── Creating referrers ──────────────────────────────────────────────────────

/**
 * Give a buyer their own code once their payment lands.
 *
 * Idempotent by phone: a repeat customer keeps the code they've already
 * shared. Never throws — a confirmed payment must not be jeopardised by a
 * referral code.
 */
export async function ensureReferrerForOrder(orderNumber: string): Promise<Referrer | null> {
  try {
    const settings = await getReferralSettings();
    if (!settings.is_enabled) return null;

    const { data: order } = await supabaseAdmin
      .from("orders")
      .select("buyer_name,buyer_phone,user_id,payment_status")
      .eq("order_number", orderNumber)
      .maybeSingle();

    if (!order || order.payment_status !== "paid" || !order.buyer_phone) return null;

    const phone = normalizePhone(order.buyer_phone);
    const existing = await getReferrerByPhone(phone);
    if (existing) return existing;

    // Retry on the unique-code constraint rather than pre-checking: the check
    // would be racy anyway, and the database is the only real arbiter.
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateCode(order.buyer_name);
      const { data, error } = await supabaseAdmin
        .from("referrers")
        .insert({
          code,
          name: order.buyer_name || "Customer",
          phone,
          type: "customer",
          commission_type: "flat",
          commission_value: settings.customer_commission_rupees,
          user_id: order.user_id ?? null,
        })
        .select(REFERRER_COLUMNS)
        .single();

      if (!error) return data as unknown as Referrer;
      // 23505 = unique violation. Anything else is a real failure.
      if (error.code !== "23505") {
        console.error("[Referrals] create failed:", error.message);
        return null;
      }
      // Another request created this buyer's code between our check and insert.
      const raced = await getReferrerByPhone(phone);
      if (raced) return raced;
    }

    console.error("[Referrals] could not find a free code for", orderNumber);
    return null;
  } catch (e) {
    console.error("[Referrals] ensureReferrerForOrder failed:", orderNumber, e);
    return null;
  }
}

// ── Commission lifecycle ────────────────────────────────────────────────────

async function rpc(fn: string, args: Record<string, unknown>): Promise<string[]> {
  const { data, error } = await supabaseAdmin.rpc(fn, args);
  if (error) {
    console.error(`[Referrals] ${fn} failed:`, error.message);
    return [];
  }
  return (data ?? []) as string[];
}

/** Delivered — the parcel stayed delivered, so the commission is real. */
export function approveCommissions(orderNumbers: string[]): Promise<string[]> {
  if (!orderNumbers.length) return Promise.resolve([]);
  return rpc("approve_referral_commissions", { p_order_numbers: orderNumbers });
}

/** Cancelled or refunded — nothing owed. Never touches already-paid rows. */
export function voidCommissions(orderNumbers: string[]): Promise<string[]> {
  if (!orderNumbers.length) return Promise.resolve([]);
  return rpc("void_referral_commissions", { p_order_numbers: orderNumbers });
}

export interface ReferrerStats {
  referrerId: string;
  orders: number;
  paidOrders: number;
  pendingPaise: number;
  approvedPaise: number;
  paidPaise: number;
}

/**
 * Earnings per referrer, in one pass.
 *
 * Aggregated in memory rather than SQL for the same reason as the insights
 * page: the row count is small, and a view per breakdown is more machinery
 * than the numbers justify.
 */
export async function getReferrerStats(): Promise<Map<string, ReferrerStats>> {
  const { data } = await supabaseAdmin
    .from("orders")
    .select("referrer_id,referral_status,referral_commission_paise,payment_status")
    .not("referrer_id", "is", null)
    .limit(20000);

  const stats = new Map<string, ReferrerStats>();

  for (const row of (data ?? []) as {
    referrer_id: string;
    referral_status: string | null;
    referral_commission_paise: number | null;
    payment_status: string;
  }[]) {
    const s = stats.get(row.referrer_id) ?? {
      referrerId: row.referrer_id,
      orders: 0,
      paidOrders: 0,
      pendingPaise: 0,
      approvedPaise: 0,
      paidPaise: 0,
    };

    s.orders += 1;
    if (row.payment_status === "paid") s.paidOrders += 1;

    const amount = row.referral_commission_paise ?? 0;
    if (row.referral_status === "pending") s.pendingPaise += amount;
    else if (row.referral_status === "approved") s.approvedPaise += amount;
    else if (row.referral_status === "paid") s.paidPaise += amount;

    stats.set(row.referrer_id, s);
  }

  return stats;
}

/**
 * Settle everything approved for one referrer.
 *
 * The payout row is written first so that, if settling the orders fails, the
 * result is a payout with no orders attached — visible and fixable — rather
 * than orders marked paid against a transfer that was never recorded.
 */
export async function payoutReferrer(params: {
  referrerId: string;
  amountPaise: number;
  orderCount: number;
  reference?: string | null;
  note?: string | null;
  paidBy: string | null;
}): Promise<{ payoutId: string; settled: string[] } | null> {
  const { data: payout, error } = await supabaseAdmin
    .from("referral_payouts")
    .insert({
      referrer_id: params.referrerId,
      amount_paise: params.amountPaise,
      order_count: params.orderCount,
      reference: params.reference || null,
      note: params.note || null,
      paid_by: params.paidBy,
    })
    .select("id")
    .single();

  if (error || !payout) {
    console.error("[Referrals] payout insert failed:", error?.message);
    return null;
  }

  const settled = await rpc("settle_referral_payout", {
    p_referrer_id: params.referrerId,
    p_payout_id: payout.id,
  });

  return { payoutId: payout.id as string, settled };
}

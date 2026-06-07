import { supabaseAdmin } from "@/lib/supabase/admin";
import type { PromoCode, PromoDiscountType } from "@/lib/types/db";

/** Minimum chargeable amount (Razorpay requires ≥ ₹1). */
const MIN_PAYABLE_PAISE = 100;

export function normalizeCode(raw: string): string {
  return (raw || "").trim().toUpperCase().replace(/\s+/g, "");
}

export interface PromoValidation {
  valid: boolean;
  error?: string;
  code?: string;
  discountPaise: number;
  finalPaise: number;
}

/**
 * Validate a promo code against an amount (in paise) and compute the discount.
 * Pure read — does NOT consume a redemption. Re-run server-side at order time.
 */
export async function validatePromo(
  rawCode: string,
  amountPaise: number
): Promise<PromoValidation> {
  const code = normalizeCode(rawCode);
  if (!code) {
    return { valid: false, error: "Enter a code.", discountPaise: 0, finalPaise: amountPaise };
  }

  const { data } = await supabaseAdmin
    .from("promo_codes")
    .select("*")
    .eq("code", code)
    .maybeSingle();
  const promo = data as PromoCode | null;

  if (!promo || !promo.is_active) {
    return { valid: false, error: "Invalid promo code.", discountPaise: 0, finalPaise: amountPaise };
  }
  if (promo.expires_at && new Date(promo.expires_at).getTime() <= Date.now()) {
    return { valid: false, error: "This code has expired.", discountPaise: 0, finalPaise: amountPaise };
  }
  if (promo.usage_limit != null && promo.used_count >= promo.usage_limit) {
    return { valid: false, error: "This code has reached its limit.", discountPaise: 0, finalPaise: amountPaise };
  }

  let discountPaise =
    promo.discount_type === "percent"
      ? Math.floor((amountPaise * promo.discount_value) / 100)
      : promo.discount_value * 100;

  // Never discount below the minimum chargeable amount.
  const maxDiscount = Math.max(0, amountPaise - MIN_PAYABLE_PAISE);
  discountPaise = Math.min(discountPaise, maxDiscount);

  return {
    valid: true,
    code: promo.code,
    discountPaise,
    finalPaise: amountPaise - discountPaise,
  };
}

/** Atomically consume one redemption (respects usage_limit). Returns success. */
export async function redeemPromo(code: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc("redeem_promo_code", {
    p_code: normalizeCode(code),
  });
  if (error) {
    console.error("redeemPromo failed:", error.message);
    return false;
  }
  return data === true;
}

// ── Admin CRUD ──────────────────────────────────────────────────────────────

export async function listPromoCodes(): Promise<PromoCode[]> {
  const { data } = await supabaseAdmin
    .from("promo_codes")
    .select("*")
    .order("created_at", { ascending: false });
  return (data as PromoCode[]) ?? [];
}

export async function createPromoCode(input: {
  code: string;
  discount_type: PromoDiscountType;
  discount_value: number;
  expires_at?: string | null;
  usage_limit?: number | null;
}): Promise<PromoCode> {
  const code = normalizeCode(input.code);
  const { data, error } = await supabaseAdmin
    .from("promo_codes")
    .insert({
      code,
      discount_type: input.discount_type,
      discount_value: input.discount_value,
      expires_at: input.expires_at || null,
      usage_limit: input.usage_limit ?? null,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as PromoCode;
}

export async function setPromoActive(id: string, isActive: boolean): Promise<void> {
  const { error } = await supabaseAdmin
    .from("promo_codes")
    .update({ is_active: isActive })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deletePromoCode(id: string): Promise<void> {
  const { error } = await supabaseAdmin.from("promo_codes").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

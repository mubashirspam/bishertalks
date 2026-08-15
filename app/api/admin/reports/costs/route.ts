export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";

/**
 * The cost figures behind /admin/reports.
 *
 * Every number on that screen is derived from these, so a bad value here does
 * not produce an error — it produces a confident, wrong forecast. Hence the
 * clamping below rather than trusting the form: the client sends rupees typed
 * into text boxes, and "-50" or "1e9" are both things a keyboard can produce.
 */

/** Rupees from the form to paise for the column, floored at zero. */
function paise(value: unknown, max = 100_000_000): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.round(n * 100), max);
}

function percent(value: unknown, fallback: number, max = 100): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(n, max);
}

export async function POST(request: NextRequest) {
  const auth = await requirePermission("reports.view");
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({}));

  const row = {
    id: true,
    printing_paise: paise(body.printing),
    packaging_paise: paise(body.packaging),
    delivery_paise: paise(body.delivery),
    marketing_paise: paise(body.marketing),
    other_variable_paise: paise(body.otherVariable),
    // 2.36% is Razorpay's standard 2% plus GST on the fee — the right default
    // for this account, not a neutral zero.
    payment_fee_percent: percent(body.paymentFeePercent, 2.36),
    // Monthly figures, so the ceiling is far higher than a per-book one.
    salary_monthly_paise: paise(body.salaryMonthly, 10_000_000_000),
    tech_monthly_paise: paise(body.techMonthly, 10_000_000_000),
    other_fixed_monthly_paise: paise(body.otherFixedMonthly, 10_000_000_000),
    rto_percent: percent(body.rtoPercent, 0),
    rto_cost_paise: paise(body.rtoCost),
    price_elasticity: percent(body.priceElasticity, 12),
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabaseAdmin
    .from("business_costs")
    .upsert(row, { onConflict: "id" });

  if (error) {
    console.error("[Reports] cost save failed:", error);
    return NextResponse.json({ error: "Could not save" }, { status: 500 });
  }

  // Worth a trail: these decide what every projection says, and "the numbers
  // changed" is a question someone will ask.
  await audit({
    actor: auth.staff,
    action: "reports.costs.update",
    entity: "business_costs",
    meta: row,
  });

  revalidatePath("/admin/reports");

  return NextResponse.json({ ok: true });
}

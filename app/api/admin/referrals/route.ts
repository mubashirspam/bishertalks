export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  getReferralSettings,
  updateReferralSettings,
  getReferrerByCode,
  payoutReferrer,
} from "@/lib/db/referrals";
import { normalizeCode, isValidCodeFormat, generateCode } from "@/lib/referral";
import { normalizePhone } from "@/lib/db/users";
import { audit } from "@/lib/audit";

/**
 * Create a referrer by hand.
 *
 * The only way a code comes into existence. Buyers used to get one
 * automatically on payment, which produced a row for every customer and
 * buried the few worth tracking; now someone decides.
 */
export async function POST(request: NextRequest) {
  const auth = await requirePermission("referrals.view");
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({}));
  const name = String(body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "Enter a name." }, { status: 400 });

  // A chosen code is nicer to share than a generated one ("BISHER10").
  let code = normalizeCode(body.code);
  if (code && !isValidCodeFormat(code)) {
    return NextResponse.json(
      { error: "Codes are 4–20 letters and numbers." },
      { status: 400 }
    );
  }
  if (!code) code = generateCode(name);

  if (await getReferrerByCode(code)) {
    return NextResponse.json({ error: "That code is already taken." }, { status: 400 });
  }

  const settings = await getReferralSettings();

  // Customers get a flat rupee amount, affiliates a percentage — but the form
  // can override either, so the type is recorded and the rate taken as given.
  const type = body.type === "affiliate" ? "affiliate" : "customer";
  const commissionType = body.commission_type === "percent" ? "percent" : "flat";
  const commissionValue = Number.isFinite(Number(body.commission_value))
    ? Math.max(0, Math.floor(Number(body.commission_value)))
    : type === "affiliate"
      ? settings.affiliate_commission_percent
      : settings.customer_commission_rupees;

  if (commissionType === "percent" && commissionValue > 100) {
    return NextResponse.json({ error: "A percentage can't exceed 100." }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("referrers")
    .insert({
      code,
      name,
      phone: body.phone ? normalizePhone(String(body.phone)) : null,
      email: body.email ? String(body.email).trim().toLowerCase() : null,
      upi_id: body.upi_id ? String(body.upi_id).trim() : null,
      type,
      commission_type: commissionType,
      commission_value: commissionValue,
      notes: body.notes ? String(body.notes).trim() : null,
    })
    .select("id,code")
    .single();

  if (error) {
    console.error("[Referrals] referrer create failed:", error.message);
    return NextResponse.json({ error: "Could not create" }, { status: 500 });
  }

  await audit({
    actor: auth.staff,
    action: "referrer.created",
    entity: "referrer",
    entityId: (data as { id: string }).id,
    meta: { code, name, type, commissionType, commissionValue },
  });

  return NextResponse.json({ referrer: data });
}

/** Edit a referrer, or edit the program-wide settings. */
export async function PATCH(request: NextRequest) {
  const auth = await requirePermission("referrals.view");
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({}));

  if (body.scope === "settings") {
    const patch: Record<string, unknown> = {};
    const num = (v: unknown) => Math.max(0, Math.floor(Number(v)));

    if (typeof body.is_enabled === "boolean") patch.is_enabled = body.is_enabled;
    if (body.customer_commission_rupees !== undefined)
      patch.customer_commission_rupees = num(body.customer_commission_rupees);
    if (body.affiliate_commission_percent !== undefined)
      patch.affiliate_commission_percent = Math.min(100, num(body.affiliate_commission_percent));
    if (body.referee_discount_rupees !== undefined)
      patch.referee_discount_rupees = num(body.referee_discount_rupees);

    const settings = await updateReferralSettings(patch);
    if (!settings) return NextResponse.json({ error: "Could not save" }, { status: 500 });

    await audit({
      actor: auth.staff,
      action: "referral.settings",
      entity: "referral_settings",
      meta: patch,
    });
    return NextResponse.json({ settings });
  }

  const id = String(body.id ?? "");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (typeof body.is_active === "boolean") patch.is_active = body.is_active;
  if (typeof body.upi_id === "string") patch.upi_id = body.upi_id.trim() || null;
  if (typeof body.notes === "string") patch.notes = body.notes.trim() || null;
  if (body.commission_value !== undefined) {
    patch.commission_value = Math.max(0, Math.floor(Number(body.commission_value)));
  }
  if (body.commission_type === "flat" || body.commission_type === "percent") {
    patch.commission_type = body.commission_type;
  }

  const { error } = await supabaseAdmin.from("referrers").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await audit({
    actor: auth.staff,
    action: "referrer.updated",
    entity: "referrer",
    entityId: id,
    meta: patch,
  });

  return NextResponse.json({ ok: true });
}

/**
 * Settle what's approved for one referrer.
 *
 * Behind its own permission: a manager should be able to see what's owed
 * without being able to mark money as sent.
 */
export async function PUT(request: NextRequest) {
  const auth = await requirePermission("referrals.payout");
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({}));
  const referrerId = String(body.referrer_id ?? "");
  if (!referrerId) {
    return NextResponse.json({ error: "Missing referrer" }, { status: 400 });
  }

  // The amount is recomputed here from approved rows, never taken from the
  // browser — this is the one endpoint where a forged number would be money.
  const { data: owing } = await supabaseAdmin
    .from("orders")
    .select("referral_commission_paise")
    .eq("referrer_id", referrerId)
    .eq("referral_status", "approved");

  const rows = (owing ?? []) as { referral_commission_paise: number | null }[];
  const amountPaise = rows.reduce((sum, r) => sum + (r.referral_commission_paise ?? 0), 0);

  if (!rows.length || amountPaise <= 0) {
    return NextResponse.json({ error: "Nothing approved to pay." }, { status: 400 });
  }

  const result = await payoutReferrer({
    referrerId,
    amountPaise,
    orderCount: rows.length,
    reference: typeof body.reference === "string" ? body.reference : null,
    note: typeof body.note === "string" ? body.note : null,
    paidBy: auth.staff.id,
  });

  if (!result) return NextResponse.json({ error: "Payout failed" }, { status: 500 });

  await audit({
    actor: auth.staff,
    action: "referral.payout",
    entity: "referrer",
    entityId: referrerId,
    meta: { amountPaise, orders: result.settled.length, reference: body.reference ?? null },
  });

  return NextResponse.json({
    paid: result.settled.length,
    amountPaise,
    payoutId: result.payoutId,
  });
}

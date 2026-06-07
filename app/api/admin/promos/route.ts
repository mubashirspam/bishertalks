export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import {
  createPromoCode,
  setPromoActive,
  deletePromoCode,
  normalizeCode,
} from "@/lib/db/promo";

// POST — create a promo code.
export async function POST(request: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const code = normalizeCode(body.code || "");
  const discountType = body.discount_type;
  const discountValue = Math.round(Number(body.discount_value));

  if (!code) {
    return NextResponse.json({ error: "Enter a code." }, { status: 400 });
  }
  if (!["percent", "flat"].includes(discountType)) {
    return NextResponse.json({ error: "Invalid discount type." }, { status: 400 });
  }
  if (!Number.isFinite(discountValue) || discountValue <= 0) {
    return NextResponse.json({ error: "Enter a valid discount value." }, { status: 400 });
  }
  if (discountType === "percent" && discountValue > 100) {
    return NextResponse.json({ error: "Percent must be 1–100." }, { status: 400 });
  }

  const usageLimit =
    body.usage_limit === "" || body.usage_limit == null
      ? null
      : Math.round(Number(body.usage_limit));
  if (usageLimit != null && (!Number.isFinite(usageLimit) || usageLimit <= 0)) {
    return NextResponse.json({ error: "Invalid usage limit." }, { status: 400 });
  }

  try {
    const promo = await createPromoCode({
      code,
      discount_type: discountType,
      discount_value: discountValue,
      expires_at: body.expires_at || null,
      usage_limit: usageLimit,
    });
    return NextResponse.json({ success: true, promo });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create code.";
    const friendly = /duplicate key/i.test(msg) ? "That code already exists." : msg;
    return NextResponse.json({ error: friendly }, { status: 400 });
  }
}

// PATCH { id, is_active } — toggle a promo on/off.
export async function PATCH(request: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id, is_active } = await request.json();
  if (!id || typeof is_active !== "boolean") {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  try {
    await setPromoActive(id, is_active);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Failed to update." }, { status: 500 });
  }
}

// DELETE { id } — remove a promo code.
export async function DELETE(request: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await request.json();
  if (!id) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  try {
    await deletePromoCode(id);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Failed to delete." }, { status: 500 });
  }
}

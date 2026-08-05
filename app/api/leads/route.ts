export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getProductPricing } from "@/lib/db/courses";
import { normalizePhone, isValidPhone } from "@/lib/db/users";

function generateOrderNumber(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const code = Array.from(
    { length: 6 },
    () => chars[Math.floor(Math.random() * chars.length)]
  ).join("");
  return `ORD-${code}`;
}

/** Trim to a value or null. Blank fields must not clobber saved ones. */
const val = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s || null;
};

/**
 * Progressive checkout capture.
 *
 * Called as the customer fills in the form, keyed on their mobile number, so
 * whatever they typed is saved even if they never reach the payment step. An
 * abandoned checkout then leaves a name and an address you can act on rather
 * than an anonymous row.
 *
 * Deliberately permissive: only the phone number is validated, because it's the
 * key. Everything else is stored as-is — a half-typed address is still worth
 * more than nothing, and blocking the save on validation would defeat the point.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const phone = normalizePhone(String(body?.phone ?? ""));

    if (!isValidPhone(phone)) {
      return NextResponse.json({ error: "Invalid phone" }, { status: 400 });
    }

    // Only fields that were actually filled in.
    const fields: Record<string, string> = {};
    const put = (col: string, v: unknown) => {
      const s = val(v);
      if (s) fields[col] = s;
    };
    put("buyer_name", body.name);
    put("buyer_email", body.email);
    put("address_line1", body.address1);
    put("address_line2", body.address2);
    put("city", body.city);
    put("district", body.district);
    put("state", body.state);
    put("pincode", body.pincode);

    // Reuse this customer's unpaid row rather than creating one per keystroke.
    const { data: existing } = await supabaseAdmin
      .from("orders")
      .select("order_number")
      .eq("buyer_phone", phone)
      .eq("payment_status", "pending")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      if (Object.keys(fields).length) {
        await supabaseAdmin
          .from("orders")
          .update(fields)
          .eq("order_number", existing.order_number);
      }
      return NextResponse.json({ order_number: existing.order_number });
    }

    const { payablePaise } = await getProductPricing();
    const orderNumber = generateOrderNumber();

    const { error } = await supabaseAdmin.from("orders").insert({
      order_number: orderNumber,
      buyer_phone: phone,
      amount_paise: payablePaise,
      payment_status: "pending",
      status: "confirmed",
      checkout_type: "standard",
      ...fields,
    });

    if (error) {
      console.error("[Leads] insert failed:", error.message);
      return NextResponse.json({ error: "Could not save" }, { status: 500 });
    }

    return NextResponse.json({ order_number: orderNumber });
  } catch (err) {
    console.error("[Leads] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

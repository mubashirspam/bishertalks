export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyOrderToken } from "@/lib/order-token";
import { notifyAfterResponse } from "@/lib/notify";
import { cleanName, isUsableName, NAME_MIN } from "@/lib/clean-name";
import { addressType } from "@/lib/address";

const str = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s || null;
};

/**
 * Save the delivery address collected after payment.
 *
 * Authorised by the HMAC token in the link, not by a login — order numbers are
 * short enough to enumerate, and without the token anyone could read or
 * overwrite another customer's delivery address.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const orderNumber = String(body?.order_number ?? "");
    const token = String(body?.token ?? "");

    if (!orderNumber || !verifyOrderToken(orderNumber, token)) {
      return NextResponse.json({ error: "Invalid link" }, { status: 403 });
    }

    // Cleaned, not validated: emoji stripped and spacing normalised without
    // telling the customer, because every one of those is something we can fix
    // ourselves and they have already paid. See lib/clean-name.ts.
    const name = cleanName(body.name);
    const address1 = str(body.address1);
    const pincode = str(body.pincode);
    const city = str(body.city);
    const state = str(body.state);

    // 0064. The house by name is required on every new address; the door
    // number is not, because most Kerala addresses do not have one.
    const houseName = str(body.house_name);
    const doorNo = str(body.door_no);
    const type = addressType(body.address_type);

    if (!name || !address1 || !pincode || !city || !state || !houseName) {
      return NextResponse.json(
        { error: "Please fill in all required fields." },
        { status: 400 }
      );
    }
    // The one name rule worth a message: too short to be a name at all.
    // "Please fill in all required fields" above already caught the empty case.
    if (!isUsableName(name)) {
      return NextResponse.json(
        { error: `Please enter your full name — at least ${NAME_MIN} letters.` },
        { status: 400 }
      );
    }
    if (!/^\d{6}$/.test(pincode)) {
      return NextResponse.json({ error: "Invalid pincode" }, { status: 400 });
    }

    const { data: order } = await supabaseAdmin
      .from("orders")
      .select("order_number, payment_status")
      .eq("order_number", orderNumber)
      .maybeSingle();

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const { error } = await supabaseAdmin
      .from("orders")
      .update({
        buyer_name: name,
        house_name: houseName,
        door_no: doorNo || null,
        address_type: type,
        address_line1: address1,
        address_line2: str(body.address2),
        city,
        district: str(body.district),
        state,
        pincode,
        address_submitted_at: new Date().toISOString(),
      })
      .eq("order_number", orderNumber);

    if (error) {
      console.error("[Address] update failed:", error.message);
      return NextResponse.json({ error: "Could not save address" }, { status: 500 });
    }

    // Now that we know where it's going, send the real order confirmation.
    // Only for paid orders — an unpaid one isn't confirmed yet.
    if (order.payment_status === "paid") {
      notifyAfterResponse(orderNumber, "confirmed");
    }

    return NextResponse.json({ success: true, order_number: orderNumber });
  } catch (err) {
    console.error("[Address] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

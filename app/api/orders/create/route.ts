export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getRazorpay } from "@/lib/razorpay";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getProductPricing } from "@/lib/db/courses";
import { validatePromo } from "@/lib/db/promo";
import { upsertUserByPhone, normalizePhone } from "@/lib/db/users";
import { MAGIC_CHECKOUT_ENABLED } from "@/lib/magic-checkout";

function generateOrderNumber(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const code = Array.from(
    { length: 6 },
    () => chars[Math.floor(Math.random() * chars.length)]
  ).join("");
  return `ORD-${code}`;
}

/**
 * Create a Magic Checkout order.
 *
 * Magic Checkout collects the customer's contact details and shipping address
 * itself, so this route takes no buyer input — the order row is created bare
 * and backfilled from Razorpay once payment is confirmed (see
 * `backfillOrderFromRazorpay`). Requires migration 0003.
 */
export async function POST(request: NextRequest) {
  try {
    let body: Record<string, unknown> = {};
    try {
      body = (await request.json()) ?? {};
    } catch {
      // No body is fine — a plain "Buy now" with no promo.
    }

    // Only the promo code may come from the client, and it is re-validated
    // server-side. The amount is never trusted from the browser.
    const promoCode =
      typeof body.promoCode === "string" ? body.promoCode : null;

    // Standard Checkout still collects the address up front. Validate it here;
    // under Magic Checkout these fields don't exist and are backfilled later.
    const {
      name, phone, email, address1, address2, city, state, pincode,
    } = body as Record<string, string | undefined>;

    if (!MAGIC_CHECKOUT_ENABLED) {
      if (!name || !phone || !address1 || !city || !state || !pincode) {
        return NextResponse.json(
          { error: "Required fields missing" },
          { status: 400 }
        );
      }
      if (!/^[6-9]\d{9}$/.test(phone)) {
        return NextResponse.json({ error: "Invalid phone number" }, { status: 400 });
      }
      if (!/^\d{6}$/.test(pincode)) {
        return NextResponse.json({ error: "Invalid pincode" }, { status: 400 });
      }
    }

    const { payablePaise } = await getProductPricing();
    let amountPaise = payablePaise;
    let discountPaise = 0;
    let appliedPromo: string | null = null;

    // Validate only. Redemption happens in /api/orders/verify once payment
    // actually succeeds, so abandoned checkouts no longer burn a redemption.
    if (promoCode) {
      const promo = await validatePromo(promoCode, payablePaise);
      if (promo.valid && promo.discountPaise > 0) {
        amountPaise = promo.finalPaise;
        discountPaise = promo.discountPaise;
        appliedPromo = promo.code!;
      }
    }

    const orderNumber = generateOrderNumber();
    const normalizedPhone = phone ? normalizePhone(phone) : null;

    // Magic Checkout fields are only accepted once Razorpay has provisioned the
    // feature. Sending them to an unprovisioned account fails the whole order
    // with "one_click_checkout is/are not required and should not be sent".
    const magicFields = MAGIC_CHECKOUT_ENABLED
      ? {
          one_click_checkout: true,
          // line_items_total must equal the sum of line item prices after
          // discount, in paise, post-tax.
          line_items_total: amountPaise,
          line_items: [
            {
              type: "e-commerce",
              sku: "neuro-code-book",
              price: amountPaise,
              offer_price: amountPaise,
              tax_amount: 0,
              quantity: 1,
              name: "Neuro Code",
              description: "Book by Bisher KC",
              image_url: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/images/book_front.png`,
            },
          ],
        }
      : {};

    const razorpayOrder = await getRazorpay().orders.create({
      amount: amountPaise,
      currency: "INR",
      receipt: orderNumber,
      ...magicFields,
      notes: MAGIC_CHECKOUT_ENABLED
        ? { order_number: orderNumber }
        : { order_number: orderNumber, buyer_name: name!, buyer_phone: normalizedPhone! },
      // The Node SDK's Orders.create types predate Magic Checkout, so the
      // one_click_checkout / line_items fields aren't in its signature.
    } as unknown as Parameters<ReturnType<typeof getRazorpay>["orders"]["create"]>[0]);

    // Standard Checkout knows the buyer up front, so link the user immediately.
    // Under Magic Checkout this happens after payment, in the backfill.
    let userId: string | null = null;
    if (!MAGIC_CHECKOUT_ENABLED && normalizedPhone) {
      try {
        const user = await upsertUserByPhone({
          phone: normalizedPhone,
          name,
          email,
          city,
          state,
        });
        userId = user.id;
      } catch (e) {
        console.error("User upsert failed (continuing):", e);
      }
    }

    const { error: dbError } = await supabaseAdmin.from("orders").insert({
      order_number: orderNumber,
      razorpay_order_id: razorpayOrder.id,
      amount_paise: amountPaise,
      promo_code: appliedPromo,
      discount_paise: discountPaise,
      payment_status: "pending",
      status: "confirmed",
      checkout_type: MAGIC_CHECKOUT_ENABLED ? "magic" : "standard",
      // Null under Magic Checkout — Razorpay collects these and we backfill
      // them once the payment is confirmed.
      user_id: userId,
      buyer_name: name ?? null,
      buyer_phone: normalizedPhone,
      buyer_email: email || null,
      address_line1: address1 ?? null,
      address_line2: address2 || null,
      city: city ?? null,
      state: state ?? null,
      pincode: pincode ?? null,
    });

    if (dbError) {
      console.error("DB insert error:", dbError);
      return NextResponse.json(
        { error: "Failed to create order" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      razorpay_order_id: razorpayOrder.id,
      order_number: orderNumber,
      amount: amountPaise,
      key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
    });
  } catch (err) {
    console.error("Order creation error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

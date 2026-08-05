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

    // The checkout page only collects a mobile number; the address is collected
    // after payment. `existingOrderNumber` is the lead row created when the
    // number was typed, so payment attaches to that row instead of forking a
    // second one and losing the drop-off trail.
    const { name, phone, email } = body as Record<string, string | undefined>;
    const existingOrderNumber =
      typeof body.order_number === "string" ? body.order_number : null;

    if (!MAGIC_CHECKOUT_ENABLED && !phone && !existingOrderNumber) {
      return NextResponse.json(
        { error: "Mobile number is required" },
        { status: 400 }
      );
    }
    if (phone && !/^[6-9]\d{9}$/.test(normalizePhone(phone))) {
      return NextResponse.json({ error: "Invalid phone number" }, { status: 400 });
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

    // Attach to the lead row if we already captured this visitor, so one
    // customer stays one row from first keystroke to delivery.
    let orderNumber: string;
    let reusingLead = false;
    let leadPhone: string | null = null;

    if (existingOrderNumber) {
      const { data: lead } = await supabaseAdmin
        .from("orders")
        .select("order_number, buyer_phone, payment_status")
        .eq("order_number", existingOrderNumber)
        .maybeSingle();
      // Never reattach to an order that's already been paid for.
      if (lead && lead.payment_status !== "paid") {
        orderNumber = lead.order_number;
        leadPhone = lead.buyer_phone;
        reusingLead = true;
      } else {
        orderNumber = generateOrderNumber();
      }
    } else {
      orderNumber = generateOrderNumber();
    }

    const normalizedPhone = phone ? normalizePhone(phone) : leadPhone;

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
      notes: { order_number: orderNumber, buyer_phone: normalizedPhone ?? "" },
      // The Node SDK's Orders.create types predate Magic Checkout, so the
      // one_click_checkout / line_items fields aren't in its signature.
    } as unknown as Parameters<ReturnType<typeof getRazorpay>["orders"]["create"]>[0]);

    // We know the buyer's number up front, so link the user record now. The
    // address arrives later, from the post-payment form.
    let userId: string | null = null;
    if (normalizedPhone) {
      try {
        const user = await upsertUserByPhone({
          phone: normalizedPhone,
          name,
          email,
        });
        userId = user.id;
      } catch (e) {
        console.error("User upsert failed (continuing):", e);
      }
    }

    const row = {
      razorpay_order_id: razorpayOrder.id,
      amount_paise: amountPaise,
      promo_code: appliedPromo,
      discount_paise: discountPaise,
      payment_status: "pending",
      status: "confirmed",
      checkout_type: MAGIC_CHECKOUT_ENABLED ? "magic" : "standard",
      user_id: userId,
      buyer_phone: normalizedPhone,
      ...(name ? { buyer_name: name } : {}),
      ...(email ? { buyer_email: email } : {}),
    };

    const { error: dbError } = reusingLead
      ? await supabaseAdmin
          .from("orders")
          .update(row)
          .eq("order_number", orderNumber)
      : await supabaseAdmin
          .from("orders")
          .insert({ order_number: orderNumber, ...row });

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

    // Razorpay rejects one_click_checkout unless Magic Checkout is provisioned
    // on the account. Without this branch it surfaces as a generic 500 and
    // looks like a code bug — it isn't, it's the flag being on too early.
    const desc =
      (err as { error?: { description?: string } })?.error?.description ?? "";
    if (/one_click_checkout/i.test(desc)) {
      console.error(
        "\n*** Magic Checkout is NOT enabled on this Razorpay account. ***\n" +
          "Set NEXT_PUBLIC_MAGIC_CHECKOUT=false and restart, or ask Razorpay\n" +
          "to enable Magic Checkout. See MAGIC_CHECKOUT.md.\n"
      );
      return NextResponse.json(
        {
          error:
            "Checkout is misconfigured (Magic Checkout is not enabled on this Razorpay account). Please contact support.",
        },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

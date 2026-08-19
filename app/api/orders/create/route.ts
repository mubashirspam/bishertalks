export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getRazorpay } from "@/lib/razorpay";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getProductPricing } from "@/lib/db/courses";
import { validatePromo } from "@/lib/db/promo";
import { upsertUserByPhone, normalizePhone } from "@/lib/db/users";
import { MAGIC_CHECKOUT_ENABLED } from "@/lib/magic-checkout";
import {
  attributionFromRequest,
  firstWriteOnly,
  refCodeFromRequest,
  ATTRIBUTION_COLUMNS,
} from "@/lib/db/attribution";
import { applyReferral, type AppliedReferral } from "@/lib/db/referrals";
import { clampQuantity } from "@/lib/quantity";
import {
  giftChargePaise,
  isGiftOrder,
  isSignedOrder,
  sanitizeGiftMessage,
} from "@/lib/gift";
import { getGiftSettings } from "@/lib/db/gift";
import { getCheckoutSettings } from "@/lib/db/checkout-settings";
import { promoCodeAllowed } from "@/lib/checkout-settings";
import { claimPaidTransition } from "@/lib/payment-claim";

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

    // Checkout collects contact + delivery address before payment.
    // `existingOrderNumber` is the lead row created when the number was typed,
    // so payment attaches to that row instead of forking a second one and
    // losing the drop-off trail.
    const {
      name, phone, email, address1, address2, city, district, state, pincode,
    } = body as Record<string, string | undefined>;
    const existingOrderNumber =
      typeof body.order_number === "string" ? body.order_number : null;

    // Under Magic Checkout, Razorpay collects these and we backfill after
    // payment — so only validate them on the standard flow.
    if (!MAGIC_CHECKOUT_ENABLED) {
      if (!name || !phone || !address1 || !city || !state || !pincode) {
        return NextResponse.json(
          { error: "Please fill in all required fields." },
          { status: 400 }
        );
      }
      if (!/^\d{6}$/.test(pincode)) {
        return NextResponse.json({ error: "Invalid pincode" }, { status: 400 });
      }
    }
    if (phone && !/^[6-9]\d{9}$/.test(normalizePhone(phone))) {
      return NextResponse.json({ error: "Invalid phone number" }, { status: 400 });
    }

    // How many copies. Clamped here rather than taken as sent: the browser
    // chooses the number of books, never the price of them, and a request
    // asking for 0 or 10,000 copies must not become an order row.
    const quantity = clampQuantity(body.quantity ?? 1);

    // Gift wrapping. The browser sends a boolean and a message; the price and
    // whether wrapping is on offer at all come from the settings read here. A
    // request naming its own gift charge — or a message on an order that isn't
    // a gift, which is a card nobody was paid to write — gets neither.
    //
    // Read live rather than from a cache: a page open since before wrapping was
    // switched off still sends is_gift, and this is what refuses it. All three
    // values go through the settings together, so an order can never end up
    // flagged as a gift with nothing charged for it.
    const giftSettings = await getGiftSettings();
    const isGift = isGiftOrder(body.is_gift, giftSettings);
    const giftPaise = giftChargePaise(body.is_gift, giftSettings);
    const giftMessage = isGift ? sanitizeGiftMessage(body.gift_message) : null;

    // Signed copies — free (0041), so there is nothing to price, only a flag
    // to get right. Same rules as wrapping, one step stricter: signing is only
    // offered inside the gift option, so this reads `body.is_gift` as well as
    // `body.is_signed`. A request asking for signing without wrapping is stored
    // as nothing, which is what orders_signed_needs_gift_check (0040) would
    // insist on if it got that far.
    const isSigned = isSignedOrder(body.is_signed, body.is_gift, giftSettings);

    const { payablePaise } = await getProductPricing();
    // The course is not multiplied — one login per customer, however many
    // books they buy. Only the book has a quantity.
    const subtotalPaise = payablePaise * quantity;
    let amountPaise = subtotalPaise;
    let discountPaise = 0;
    let appliedPromo: string | null = null;

    // Validate only. Redemption happens in /api/orders/verify once payment
    // actually succeeds, so abandoned checkouts no longer burn a redemption.
    //
    // Gated on the promo field being on offer at all (0042), read live for the
    // same reason the gift settings are: a page left open since before the
    // field was hidden still posts a `promoCode`, and hiding a box in the
    // browser is not what stops a discount — this is. Silent rather than an
    // error, matching how an invalid code already behaves: the order proceeds
    // at full price instead of failing at the payment step.
    if (promoCode && promoCodeAllowed(await getCheckoutSettings())) {
      const promo = await validatePromo(promoCode, subtotalPaise);
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

    // Where this visitor came from. On the Magic Checkout path there may be no
    // lead row at all, so this route has to be able to attribute on its own.
    let attribution = attributionFromRequest(request);

    if (existingOrderNumber) {
      const { data: lead } = await supabaseAdmin
        .from("orders")
        .select(
          `order_number, buyer_phone, payment_status, razorpay_order_id, ${ATTRIBUTION_COLUMNS}`
        )
        .eq("order_number", existingOrderNumber)
        .maybeSingle();

      // "Not marked paid" is not the same as "not paid". A UPI customer who
      // app-switches to pay never comes back to fire the verify handler, so the
      // row can still read pending minutes after the money was captured. If we
      // reuse it here we mint a second Razorpay order, overwrite
      // razorpay_order_id below, and orphan the captured payment — no row
      // points at it any more, so even a webhook replay can't find it. Ask
      // Razorpay what actually happened before touching the row.
      if (lead && lead.payment_status !== "paid" && lead.razorpay_order_id) {
        try {
          const { items } = await getRazorpay()
            .orders.fetchPayments(lead.razorpay_order_id);
          const settled = items?.find(
            (p) => p.status === "captured" || p.status === "authorized"
          );
          if (settled) {
            console.error(
              "[Create] Re-checkout blocked — prior attempt already settled:",
              { order_number: lead.order_number, payment_id: settled.id, status: settled.status }
            );
            // Marks it paid and runs the side effects the missed verify owed
            // the customer: receipt, course grant, WhatsApp. Idempotent.
            await claimPaidTransition(
              { razorpayOrderId: lead.razorpay_order_id },
              settled.id
            );
            return NextResponse.json({
              already_paid: true,
              order_number: lead.order_number,
            });
          }
        } catch (e) {
          // Razorpay unreachable. Falling through re-opens the orphaning race,
          // so refuse rather than risk taking a second payment.
          console.error("[Create] Could not check prior attempt:", e);
          return NextResponse.json(
            {
              error:
                "We're still confirming your last payment attempt. Please wait a moment and refresh before trying again.",
            },
            { status: 503 }
          );
        }
      }

      // Never reattach to an order that's already been paid for.
      if (lead && lead.payment_status !== "paid") {
        orderNumber = lead.order_number;
        leadPhone = lead.buyer_phone;
        reusingLead = true;
        // The lead row was attributed when it was created; don't overwrite it.
        attribution = firstWriteOnly(attribution, lead);
      } else {
        orderNumber = generateOrderNumber();
      }
    } else {
      orderNumber = generateOrderNumber();
    }

    const normalizedPhone = phone ? normalizePhone(phone) : leadPhone;

    // ── Referral ────────────────────────────────────────────────────────────
    // Only when no promo was applied: a referral code and a promo code are
    // mutually exclusive, or a ₹699 book quietly sells for ₹400. The promo
    // wins because the customer typed it deliberately.
    //
    // The code comes from the attribution cookie, never from the request body,
    // so it can't be forged by editing what the browser posts. Everything —
    // validity, the buyer's discount, the referrer's commission — is decided
    // here on the server.
    let referral: AppliedReferral | null = null;

    if (!appliedPromo) {
      referral = await applyReferral({
        rawCode: refCodeFromRequest(request),
        buyerPhone: normalizedPhone,
        amountPaise,
      });

      if (referral && referral.discountPaise > 0) {
        amountPaise -= referral.discountPaise;
        discountPaise = referral.discountPaise;
      }
    }

    // Wrapping goes on last, after every discount has been taken off the book.
    //
    // Order matters twice over. A percentage promo applied to a basket that
    // already included the fee would discount the paper as well as the book,
    // and `applyReferral` above priced its commission off the amount as it
    // stood — a referrer earning a cut of the wrapping charge is money paid out
    // against a cost, not a sale.
    amountPaise += giftPaise;

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
              // One line for the whole basket, priced at the final amount.
              // Razorpay validates that line_items_total equals the sum of the
              // lines, and a promo or referral discount doesn't divide evenly
              // across copies — so the count is carried in the description
              // rather than in `quantity`, where rounding could make the sum
              // disagree with the amount actually being charged.
              price: amountPaise,
              offer_price: amountPaise,
              tax_amount: 0,
              quantity: 1,
              name: quantity > 1 ? `Neuro Code × ${quantity}` : "Neuro Code",
              // The gift add-ons ride in the description for the same reason
              // the copy count does: they are inside `price` already, and a
              // second line item would have to be reconciled against
              // line_items_total on an amount a discount doesn't divide evenly.
              description:
                `Book by Bisher KC${quantity > 1 ? ` — ${quantity} copies` : ""}` +
                (isGift ? " — gift wrapped" : "") +
                (isSigned ? " — signed" : ""),
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

    // We know the buyer up front on the standard flow, so link the user now.
    let userId: string | null = null;
    if (normalizedPhone) {
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

    const row = {
      razorpay_order_id: razorpayOrder.id,
      amount_paise: amountPaise,
      quantity,
      // Written unconditionally, unlike the optional fields below. This row may
      // be an update to a lead that was gift-wrapped on a previous attempt, and
      // a spread that skipped `false` would leave the old flag standing —
      // wrapping an order the customer just unticked and wasn't charged for.
      is_gift: isGift,
      gift_message: giftMessage,
      // Snapshotted, so raising the fee later can't rewrite this order.
      gift_charge_paise: giftPaise,
      // Written unconditionally for the same reason as is_gift above: a lead
      // row that asked for signing on a previous attempt must not keep the flag
      // when the customer changed their mind before paying.
      is_signed: isSigned,
      promo_code: appliedPromo,
      discount_paise: discountPaise,
      payment_status: "pending",
      status: "confirmed",
      checkout_type: MAGIC_CHECKOUT_ENABLED ? "magic" : "standard",
      user_id: userId,
      buyer_phone: normalizedPhone,
      ...attribution,
      // Snapshotted now: changing a referrer's rate later must not rewrite
      // what they were owed on orders already placed.
      ...(referral
        ? {
            referral_code: referral.code,
            referrer_id: referral.referrerId,
            referral_commission_paise: referral.commissionPaise,
            // Nothing is owed until the parcel is delivered.
            referral_status: "pending",
          }
        : {}),
      ...(name ? { buyer_name: name } : {}),
      ...(email ? { buyer_email: email } : {}),
      // Present on the standard flow; null under Magic Checkout, where they're
      // backfilled from Razorpay after payment.
      ...(address1 ? { address_line1: address1 } : {}),
      ...(address2 ? { address_line2: address2 } : {}),
      ...(city ? { city } : {}),
      ...(district ? { district } : {}),
      ...(state ? { state } : {}),
      ...(pincode ? { pincode } : {}),
      ...(address1 ? { address_submitted_at: new Date().toISOString() } : {}),
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

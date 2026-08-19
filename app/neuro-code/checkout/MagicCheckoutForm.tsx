"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Lock, ShoppingBag, Tag, Check, Truck } from "lucide-react";
import type { ProductPricing } from "@/lib/db/courses";
import { clampQuantity } from "@/lib/quantity";
import type { CheckoutSettings } from "@/lib/checkout-settings";
import {
  giftChargePaise,
  isGiftOrder,
  isSignedOrder,
  sanitizeGiftMessage,
  type GiftSettings,
} from "@/lib/gift";
import {
  PackageItems,
  GiftOption,
  OrderTotals,
  PaymentTrust,
  type AppliedPromo,
} from "./OrderSummary";

declare global {
  interface Window { Razorpay: new (options: object) => { open: () => void }; }
}

const rupees = (paise: number) => Math.round(paise / 100);

/**
 * Magic Checkout order page.
 *
 * Razorpay collects the customer's contact details and shipping address inside
 * Magic Checkout, so this page deliberately has no address form — it only
 * confirms the product, takes an optional promo code, and opens checkout.
 * The address is written back to the order after payment.
 */
export default function CheckoutForm({
  pricing,
  gift,
  checkout,
}: {
  pricing: ProductPricing;
  /** What the gift add-ons cost today, and whether each is offered. */
  gift: GiftSettings;
  /** What the checkout shows — currently just the promo field's switch. */
  checkout: CheckoutSettings;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [scriptReady, setScriptReady] = useState(false);
  const [error, setError] = useState("");

  // Promo state — applied server-side to the order amount before Magic Checkout
  // opens, so the discounted total is what the customer sees and pays.
  const [promoInput, setPromoInput] = useState("");
  const [promo, setPromo] = useState<AppliedPromo | null>(null);
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoError, setPromoError] = useState("");

  const [quantity, setQuantity] = useState(1);

  const [isGift, setIsGift] = useState(false);
  const [giftMessage, setGiftMessage] = useState("");
  const [isSigned, setIsSigned] = useState(false);

  // Display only. /api/orders/create multiplies the price by its own clamped
  // copy of the quantity and adds its own copies of the two gift fees, so
  // nothing here can talk the charge down.
  //
  // Wrapping is added after the promo, not before: a discount code is for the
  // book, and letting it eat into the wrapping fee would sell the paper at a
  // loss on every code that happens to be a percentage.
  //
  // Signing adds nothing to the total — it is free — so it appears here only as
  // a flag. Unticking the gift box clears it without clearing the checkbox
  // state: `isSignedOrder` refuses a signed order that isn't a gift, so the
  // sub-option comes back as it was left if the box is ticked again.
  const basePaise = pricing.payablePaise * quantity;
  const giftOrder = isGiftOrder(isGift, gift);
  const giftPaise = giftChargePaise(isGift, gift);
  const signedOrder = isSignedOrder(isSigned, isGift, gift);
  const totalPaise = (promo ? promo.finalPaise : basePaise) + giftPaise;

  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => setScriptReady(true);
    document.body.appendChild(script);
    return () => { if (document.body.contains(script)) document.body.removeChild(script); };
  }, []);

  const applyPromo = async (code = promoInput, qty = quantity) => {
    if (!code.trim()) return;
    setPromoError("");
    setPromoLoading(true);
    try {
      const res = await fetch("/api/promo/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, quantity: qty }),
      });
      const data = await res.json();
      if (data.success) {
        setPromo({ code: data.code, discountPaise: data.discountPaise, finalPaise: data.finalPaise });
        setPromoError("");
      } else {
        setPromo(null);
        setPromoError(data.error || "Invalid code.");
      }
    } catch {
      setPromoError("Could not validate code.");
    } finally {
      setPromoLoading(false);
    }
  };

  const removePromo = () => {
    setPromo(null);
    setPromoInput("");
    setPromoError("");
  };

  /**
   * Change the book count. A promo priced the old basket, so re-check it
   * rather than show a discount the payment sheet will disagree with.
   */
  const changeQuantity = (next: number) => {
    const q = clampQuantity(next);
    if (q === quantity) return;
    setQuantity(q);
    if (promo) void applyPromo(promo.code, q);
  };

  const handleBuy = async () => {
    if (!scriptReady || loading) return;
    setError("");
    setLoading(true);
    try {
      const createRes = await fetch("/api/orders/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          promoCode: promo?.code ?? null,
          quantity,
          is_gift: giftOrder,
          // Only when it's actually a gift — a message left behind after
          // unticking the box must not be stored, or someone packs a card for
          // an order the customer didn't pay wrapping on.
          gift_message: giftOrder ? sanitizeGiftMessage(giftMessage) : null,
          is_signed: signedOrder,
        }),
      });
      const createData = await createRes.json();
      if (createData.error) throw new Error(createData.error);

      const { razorpay_order_id, order_number, amount, key_id } = createData;

      const rzp = new window.Razorpay({
        key: key_id,
        amount,
        currency: "INR",
        order_id: razorpay_order_id,
        // Renders Magic Checkout rather than the Standard Checkout UI. The
        // matching one_click_checkout flag is set on the order server-side.
        one_click_checkout: true,
        show_coupons: false,
        name: "Neuro Code",
        description: "Book by Bisher KC",
        image: "/images/book_front.png",
        theme: { color: "#f97316" },
        handler: async (response: {
          razorpay_payment_id: string;
          razorpay_order_id: string;
          razorpay_signature: string;
        }) => {
          try {
            const verifyRes = await fetch("/api/orders/verify", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ...response, order_number }),
            });
            const { success } = await verifyRes.json();
            if (success) {
              router.push(`/neuro-code/thank-you?id=${order_number}`);
            } else {
              // Payment succeeded but our confirmation failed — the webhook is
              // the backstop, so never tell the customer the payment failed.
              router.push(`/neuro-code/thank-you?id=${order_number}`);
            }
          } catch (err) {
            console.error("Verification error:", err);
            router.push(`/neuro-code/thank-you?id=${order_number}`);
          }
        },
        modal: {
          ondismiss: () => setLoading(false),
          escape: true,
          animation: true,
          confirm_close: true,
        },
      });
      rzp.open();
    } catch (err) {
      console.error(err);
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white dark:bg-neutral-950 text-neutral-900 dark:text-white">
      <nav className="border-b border-neutral-200 dark:border-white/8 px-6 py-4 flex items-center justify-between sticky top-0 bg-white/90 dark:bg-neutral-950/90 backdrop-blur-sm z-10">
        <Link href="/neuro-code" className="flex items-center gap-2 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white text-sm transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back
        </Link>
        <span className="font-bold text-sm">Neuro <span className="text-primary-500 dark:text-primary-400">Code</span></span>
      </nav>

      <div className="max-w-md mx-auto px-4 py-12">
        <h1 className="text-2xl font-black mb-6 text-center">Complete Your Order</h1>

        <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-white/8 rounded-2xl p-6 shadow-sm dark:shadow-none">
          <h2 className="font-semibold text-sm flex items-center gap-2 text-neutral-700 dark:text-neutral-300 mb-5">
            <ShoppingBag className="w-4 h-4 text-primary-500 dark:text-primary-400" /> Order Summary
          </h2>

          <PackageItems
            pricing={pricing}
            quantity={quantity}
            onQuantity={changeQuantity}
            disabled={loading}
          />

          {/* Promo code. The whole block, not just the input: with the field
              switched off there is no way to have applied a code, so the
              "applied" state below it cannot arise either. */}
          {checkout.promoFieldIsEnabled && (
          <div className="mb-5 pb-5 border-b border-neutral-200 dark:border-white/8">
            {promo ? (
              <div className="flex items-center justify-between gap-2 bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/20 rounded-xl px-3 py-2.5">
                <span className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400 font-medium">
                  <Check className="w-4 h-4" />
                  <span className="font-mono">{promo.code}</span> applied
                </span>
                <button onClick={removePromo} className="text-xs text-neutral-500 hover:text-neutral-900 dark:hover:text-white">
                  Remove
                </button>
              </div>
            ) : (
              <>
                <label className="text-xs font-semibold text-neutral-500 uppercase tracking-wider flex items-center gap-1.5 mb-2">
                  <Tag className="w-3.5 h-3.5" /> Promo code
                </label>
                <div className="flex gap-2">
                  <input
                    value={promoInput}
                    onChange={(e) => { setPromoInput(e.target.value.toUpperCase().replace(/\s/g, "")); if (promoError) setPromoError(""); }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyPromo(); } }}
                    placeholder="Enter code"
                    className="flex-1 bg-neutral-50 dark:bg-neutral-800 border border-neutral-300 dark:border-white/10 rounded-xl px-3 py-2 text-sm text-neutral-900 dark:text-white placeholder-neutral-400 dark:placeholder-neutral-500 font-mono tracking-wider focus:outline-none focus:border-primary-500 transition-colors"
                  />
                  <button
                    onClick={() => applyPromo()}
                    disabled={promoLoading || !promoInput.trim()}
                    className="px-4 py-2 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity"
                  >
                    {promoLoading ? "…" : "Apply"}
                  </button>
                </div>
                {promoError && <p className="text-red-500 text-xs mt-1.5">{promoError}</p>}
              </>
            )}
          </div>
          )}

          <GiftOption
            settings={gift}
            checked={isGift}
            onChange={setIsGift}
            message={giftMessage}
            onMessage={setGiftMessage}
            signed={isSigned}
            onSigned={setIsSigned}
            quantity={quantity}
            disabled={loading}
          />

          <OrderTotals
            pricing={pricing}
            promo={promo}
            totalPaise={totalPaise}
            quantity={quantity}
            giftPaise={giftPaise}
          />

          <button
            onClick={handleBuy}
            disabled={loading || !scriptReady}
            className="mt-6 w-full py-4 rounded-full bg-primary-500 hover:bg-primary-600 disabled:opacity-60 disabled:cursor-not-allowed font-bold text-white flex items-center justify-center gap-2 transition-all shadow-lg shadow-primary-500/20"
          >
            <Lock className="w-4 h-4" />
            {loading ? "Opening checkout…" : `Buy Now ₹${rupees(totalPaise)}`}
          </button>
          {error && <p className="text-red-500 text-xs mt-2 text-center">{error}</p>}

          <p className="mt-3 text-center text-neutral-500 text-xs flex items-center justify-center gap-1.5">
            <Truck className="w-3.5 h-3.5" />
            Enter your delivery address in the next step
          </p>
          <PaymentTrust />

          {/* Time, not price — the ₹0 for delivery is a line in the package
              above; this is the "when will it arrive" answer. */}
          <div className="mt-2.5 group relative flex items-center gap-3 overflow-hidden rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-neutral-800/60 px-3.5 py-3 text-xs text-neutral-600 dark:text-neutral-400">
            <span className="pointer-events-none absolute inset-y-0 left-0 w-1/4 bg-gradient-to-r from-transparent via-white/60 dark:via-white/10 to-transparent skew-x-12 animate-shimmer" />
            <span className="relative flex-shrink-0 flex items-center justify-center w-7 h-7 rounded-full bg-neutral-200 dark:bg-white/10">
              <Truck className="w-3.5 h-3.5 text-neutral-600 dark:text-neutral-300" />
            </span>
            <span className="relative">
              Delivery in <strong className="text-neutral-900 dark:text-white font-semibold">5–7 business days</strong>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

import Image from "next/image";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Lock, ShoppingBag, Tag, Check, Truck } from "lucide-react";
import type { ProductPricing } from "@/lib/db/courses";

type AppliedPromo = { code: string; discountPaise: number; finalPaise: number };

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
export default function CheckoutForm({ pricing }: { pricing: ProductPricing }) {
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

  const basePaise = pricing.payablePaise;
  const totalPaise = promo ? promo.finalPaise : basePaise;

  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => setScriptReady(true);
    document.body.appendChild(script);
    return () => { if (document.body.contains(script)) document.body.removeChild(script); };
  }, []);

  const applyPromo = async () => {
    if (!promoInput.trim()) return;
    setPromoError("");
    setPromoLoading(true);
    try {
      const res = await fetch("/api/promo/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: promoInput }),
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

  const handleBuy = async () => {
    if (!scriptReady || loading) return;
    setError("");
    setLoading(true);
    try {
      const createRes = await fetch("/api/orders/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promoCode: promo?.code ?? null }),
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

          <div className="flex gap-4 mb-5 pb-5 border-b border-neutral-200 dark:border-white/8">
            <div className="relative w-14 h-18 rounded-lg overflow-hidden flex-shrink-0 bg-neutral-100 dark:bg-neutral-800">
              <Image src="/images/book_front.png" alt="Neuro Code" fill sizes="56px" className="object-cover" />
            </div>
            <div>
              <p className="font-semibold text-neutral-900 dark:text-white">Neuro Code</p>
              <p className="text-neutral-500 dark:text-neutral-400 text-xs mt-0.5">by Bisher KC</p>
              <p className="mt-2 flex items-baseline gap-2">
                <span className="text-primary-600 dark:text-primary-400 font-bold">₹{pricing.payable}</span>
                {pricing.offerPrice != null && (
                  <span className="text-neutral-400 line-through text-xs">₹{pricing.price}</span>
                )}
              </p>
            </div>
          </div>

          {/* Promo code */}
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
                    onClick={applyPromo}
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

          <div className="space-y-2 text-sm">
            <div className="flex justify-between text-neutral-500 dark:text-neutral-400">
              <span>Subtotal</span><span className="text-neutral-900 dark:text-white">₹{pricing.payable}</span>
            </div>
            {promo && (
              <div className="flex justify-between text-green-600 dark:text-green-400">
                <span>Discount ({promo.code})</span><span>−₹{rupees(promo.discountPaise)}</span>
              </div>
            )}
            <div className="flex justify-between text-neutral-500 dark:text-neutral-400">
              <span>Shipping</span><span className="text-green-600 dark:text-green-400 font-medium">FREE</span>
            </div>
            <div className="flex justify-between font-bold text-base pt-2 border-t border-neutral-200 dark:border-white/8 mt-2">
              <span>Total</span><span className="text-primary-600 dark:text-primary-400">₹{rupees(totalPaise)}</span>
            </div>
          </div>

          <button
            onClick={handleBuy}
            disabled={loading || !scriptReady}
            className="mt-6 w-full py-4 rounded-full bg-primary-500 hover:bg-primary-600 disabled:opacity-60 disabled:cursor-not-allowed font-bold text-white flex items-center justify-center gap-2 transition-all shadow-lg shadow-primary-500/20"
          >
            <Lock className="w-4 h-4" />
            {loading ? "Opening checkout…" : `Buy Now — ₹${rupees(totalPaise)}`}
          </button>
          {error && <p className="text-red-500 text-xs mt-2 text-center">{error}</p>}

          <p className="mt-3 text-center text-neutral-500 text-xs flex items-center justify-center gap-1.5">
            <Truck className="w-3.5 h-3.5" />
            Enter your delivery address in the next step
          </p>
          <p className="text-center text-neutral-500 text-xs mt-1">
            🔒 Powered by Razorpay · UPI · Cards · Netbanking · Wallets
          </p>

          <div className="mt-5 bg-neutral-100 dark:bg-neutral-800/60 rounded-xl p-3 text-xs text-neutral-500 dark:text-neutral-400 flex items-center gap-2">
            <span>📅</span>
            <span>Delivery in <strong className="text-neutral-900 dark:text-white">5–7 business days</strong></span>
          </div>
          <div className="mt-3 bg-neutral-100 dark:bg-neutral-800/60 rounded-xl p-3 text-xs text-neutral-500 dark:text-neutral-400 flex items-center gap-2">
            <span>📱</span>
            <span>WhatsApp updates to your number</span>
          </div>
        </div>
      </div>
    </div>
  );
}

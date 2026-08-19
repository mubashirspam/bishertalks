"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Lock, ShoppingBag, Tag, Check, User, MapPin, Loader2, Truck,
} from "lucide-react";
import type { ProductPricing } from "@/lib/db/courses";
import { clampQuantity } from "@/lib/quantity";
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
 * Checkout — details first, then payment.
 *
 * The mobile number is saved as soon as it's valid, before the customer clicks
 * Pay, so anyone who abandons here is still visible in the admin rather than
 * disappearing. District and state come from the pincode and are never typed.
 */
export default function StandardCheckoutForm({
  pricing,
  gift,
}: {
  pricing: ProductPricing;
  /** What the gift add-ons cost today, and whether each is offered. */
  gift: GiftSettings;
}) {
  const router = useRouter();

  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [address1, setAddress1] = useState("");
  const [address2, setAddress2] = useState("");
  const [pincode, setPincode] = useState("");
  const [city, setCity] = useState("");
  const [district, setDistrict] = useState("");
  const [state, setState] = useState("");

  const [localities, setLocalities] = useState<string[]>([]);
  const [pinLoading, setPinLoading] = useState(false);
  const [pinError, setPinError] = useState("");
  const [manualMode, setManualMode] = useState(false);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [scriptReady, setScriptReady] = useState(false);
  const [error, setError] = useState("");

  const orderNumberRef = useRef<string | null>(null);
  const capturedFor = useRef("");

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
  const giftOrder = isGiftOrder(isGift, gift);
  const giftPaise = giftChargePaise(isGift, gift);
  const signedOrder = isSignedOrder(isSigned, isGift, gift);
  const totalPaise =
    (promo ? promo.finalPaise : pricing.payablePaise * quantity) + giftPaise;
  const phoneValid = /^[6-9]\d{9}$/.test(phone);

  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => setScriptReady(true);
    document.body.appendChild(script);
    return () => { if (document.body.contains(script)) document.body.removeChild(script); };
  }, []);

  // Progressively save whatever has been typed, keyed on the mobile number, so
  // an abandoned checkout still leaves a name and address to follow up on.
  // Debounced, and skipped when nothing has actually changed.
  useEffect(() => {
    if (!phoneValid) return;

    const snapshot = JSON.stringify({
      phone, name, email, address1, address2, city, district, state, pincode,
    });
    if (capturedFor.current === snapshot) return;

    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/leads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: snapshot,
        });
        const data = await res.json();
        if (data.order_number) {
          orderNumberRef.current = data.order_number;
          capturedFor.current = snapshot;
        }
      } catch {
        // Silent — capture is for our benefit, never the customer's problem.
      }
    }, 900);

    return () => clearTimeout(t);
  }, [phone, phoneValid, name, email, address1, address2, city, district, state, pincode]);

  // Pincode drives district / state / locality.
  useEffect(() => {
    if (!/^\d{6}$/.test(pincode)) { setLocalities([]); return; }
    let cancelled = false;
    setPinLoading(true);
    setPinError("");

    (async () => {
      try {
        const res = await fetch(`/api/pincode/${pincode}`);
        const data = await res.json();
        if (cancelled) return;
        if (data.found) {
          setDistrict(data.district);
          setState(data.state);
          setLocalities(data.localities ?? []);
          setManualMode(false);
          if (data.localities?.length === 1) setCity(data.localities[0]);
        } else {
          setPinError(
            res.status === 404
              ? "We couldn't find that pincode — please check it."
              : "Lookup unavailable — please type your district and state."
          );
          setManualMode(true);
          setLocalities([]);
        }
      } catch {
        if (!cancelled) {
          setPinError("Lookup unavailable — please type your district and state.");
          setManualMode(true);
        }
      } finally {
        if (!cancelled) setPinLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [pincode]);

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

  /**
   * Change the book count.
   *
   * A promo was validated against the basket as it stood, so its discount is
   * stale the moment the basket changes — re-check it rather than leave a
   * number on screen that the payment sheet will disagree with.
   */
  const changeQuantity = (next: number) => {
    const q = clampQuantity(next);
    if (q === quantity) return;
    setQuantity(q);
    if (promo) void applyPromo(promo.code, q);
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = "Name is required";
    if (!phoneValid) e.phone = "Enter a valid 10-digit mobile number";
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) e.email = "Enter a valid email";
    if (!address1.trim()) e.address1 = "Address is required";
    if (!/^\d{6}$/.test(pincode)) e.pincode = "Enter a valid 6-digit pincode";
    if (!city.trim()) e.city = "Select or enter your area";
    if (!state.trim()) e.state = "State is required";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handlePay = async () => {
    if (!validate()) {
      document.querySelector("[data-error='true']")?.scrollIntoView({
        behavior: "smooth", block: "center",
      });
      return;
    }
    if (!scriptReady || loading) return;
    setError("");
    setLoading(true);

    try {
      const createRes = await fetch("/api/orders/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, phone, email,
          address1, address2, city, district, state, pincode,
          order_number: orderNumberRef.current,
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

      // A previous attempt on this order had already gone through — the server
      // just confirmed it. Don't open checkout again and charge them twice.
      if (createData.already_paid) {
        router.push(`/neuro-code/thank-you?id=${createData.order_number}`);
        return;
      }

      const { razorpay_order_id, order_number, amount, key_id } = createData;

      const rzp = new window.Razorpay({
        key: key_id,
        amount,
        currency: "INR",
        order_id: razorpay_order_id,
        name: "Neuro Code",
        description: "Book by Bisher KC",
        image: "/images/book_front.png",
        prefill: { name, email, contact: phone },
        theme: { color: "#f97316" },
        handler: async (response: {
          razorpay_payment_id: string;
          razorpay_order_id: string;
          razorpay_signature: string;
        }) => {
          try {
            await fetch("/api/orders/verify", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ...response, order_number }),
            });
          } catch {
            // The webhook is the backstop — never show the customer a failure
            // for a payment that actually succeeded.
          }
          router.push(`/neuro-code/thank-you?id=${order_number}`);
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
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setLoading(false);
    }
  };

  const inputCls = (f: string) =>
    `w-full bg-neutral-50 dark:bg-neutral-800 border rounded-xl px-4 py-3 text-neutral-900 dark:text-white placeholder-neutral-400 focus:outline-none focus:border-primary-500 transition-colors text-sm ${
      errors[f] ? "border-red-500" : "border-neutral-300 dark:border-white/10"
    }`;
  const readOnlyCls =
    "w-full bg-neutral-100 dark:bg-neutral-800/60 border border-neutral-200 dark:border-white/5 rounded-xl px-4 py-3 text-neutral-500 dark:text-neutral-400 text-sm cursor-not-allowed";

  const Err = ({ f }: { f: string }) =>
    errors[f] ? <p data-error="true" className="text-red-500 text-xs mt-1">{errors[f]}</p> : null;

  return (
    <div className="min-h-screen bg-white dark:bg-neutral-950 text-neutral-900 dark:text-white">
      <nav className="border-b border-neutral-200 dark:border-white/8 px-6 py-4 flex items-center justify-between sticky top-0 bg-white/90 dark:bg-neutral-950/90 backdrop-blur-sm z-10">
        <Link href="/neuro-code" className="flex items-center gap-2 text-neutral-500 hover:text-neutral-900 dark:hover:text-white text-sm transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back
        </Link>
        <span className="font-bold text-sm">Neuro <span className="text-primary-500">Code</span></span>
      </nav>

      <div className="max-w-5xl mx-auto px-4 py-10 grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-8 items-start">
        <div className="space-y-5">
          <h1 className="text-2xl font-black">Complete Your Order</h1>

          {/* Contact */}
          <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-white/8 rounded-2xl p-6 space-y-4 shadow-sm dark:shadow-none">
            <h2 className="font-semibold text-sm flex items-center gap-2 text-neutral-700 dark:text-neutral-300">
              <User className="w-4 h-4 text-primary-500" /> Your Details
            </h2>

            <div>
              <input
                className={inputCls("name")}
                placeholder="Full name *"
                value={name}
                onChange={(e) => { setName(e.target.value); setErrors((p) => ({ ...p, name: "" })); }}
              />
              <Err f="name" />
            </div>

            <div>
              <div className="flex">
                <span className="bg-neutral-100 dark:bg-neutral-700 border border-neutral-300 dark:border-white/10 border-r-0 rounded-l-xl px-3 flex items-center text-neutral-500 text-sm select-none">
                  +91
                </span>
                <input
                  className={`${inputCls("phone")} rounded-l-none`}
                  placeholder="WhatsApp number *"
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value.replace(/\D/g, "").slice(0, 10));
                    setErrors((p) => ({ ...p, phone: "" }));
                  }}
                  maxLength={10}
                  inputMode="numeric"
                />
              </div>
              <Err f="phone" />
              <p className="text-neutral-500 text-xs mt-1.5">
                Order updates and your free course access are sent here.
              </p>
            </div>

            <div>
              <input
                className={inputCls("email")}
                placeholder="Email (optional)"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setErrors((p) => ({ ...p, email: "" })); }}
                type="email"
              />
              <Err f="email" />
            </div>
          </div>

          {/* Address */}
          <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-white/8 rounded-2xl p-6 space-y-4 shadow-sm dark:shadow-none">
            <h2 className="font-semibold text-sm flex items-center gap-2 text-neutral-700 dark:text-neutral-300">
              <MapPin className="w-4 h-4 text-primary-500" /> Delivery Address
            </h2>

            <div>
              <input
                className={inputCls("address1")}
                placeholder="House / street / area *"
                value={address1}
                onChange={(e) => { setAddress1(e.target.value); setErrors((p) => ({ ...p, address1: "" })); }}
              />
              <Err f="address1" />
            </div>

            <input
              className={inputCls("address2")}
              placeholder="Landmark (optional)"
              value={address2}
              onChange={(e) => setAddress2(e.target.value)}
            />

            <div>
              <div className="relative">
                <input
                  className={inputCls("pincode")}
                  placeholder="Pincode *"
                  value={pincode}
                  onChange={(e) => {
                    setPincode(e.target.value.replace(/\D/g, "").slice(0, 6));
                    setErrors((p) => ({ ...p, pincode: "" }));
                  }}
                  maxLength={6}
                  inputMode="numeric"
                />
                {pinLoading && (
                  <Loader2 className="w-4 h-4 text-primary-500 animate-spin absolute right-4 top-1/2 -translate-y-1/2" />
                )}
              </div>
              <Err f="pincode" />
              {pinError && <p className="text-amber-600 text-xs mt-1">{pinError}</p>}
            </div>

            <div>
              {localities.length > 1 ? (
                <select
                  className={`${inputCls("city")} appearance-none cursor-pointer`}
                  value={city}
                  onChange={(e) => { setCity(e.target.value); setErrors((p) => ({ ...p, city: "" })); }}
                >
                  <option value="">Select your area *</option>
                  {localities.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              ) : (
                <input
                  className={inputCls("city")}
                  placeholder="Area / locality *"
                  value={city}
                  onChange={(e) => { setCity(e.target.value); setErrors((p) => ({ ...p, city: "" })); }}
                />
              )}
              <Err f="city" />
            </div>

            {/* Filled from the pincode — not typed */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-neutral-500 text-xs mb-1.5 block">District</label>
                <input
                  className={manualMode ? inputCls("district") : readOnlyCls}
                  value={district}
                  readOnly={!manualMode}
                  placeholder="From pincode"
                  onChange={(e) => setDistrict(e.target.value)}
                />
              </div>
              <div>
                <label className="text-neutral-500 text-xs mb-1.5 block">State</label>
                <input
                  className={manualMode ? inputCls("state") : readOnlyCls}
                  value={state}
                  readOnly={!manualMode}
                  placeholder="From pincode"
                  onChange={(e) => { setState(e.target.value); setErrors((p) => ({ ...p, state: "" })); }}
                />
                <Err f="state" />
              </div>
            </div>
            <p className="text-neutral-500 text-xs flex items-center gap-1.5">
              <Check className="w-3 h-3 text-green-500" />
              District and state fill in automatically from your pincode.
            </p>
          </div>
        </div>

        {/* Summary */}
        <div className="lg:sticky lg:top-24">
          <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-white/8 rounded-2xl p-6 shadow-sm dark:shadow-none">
            <h2 className="font-semibold text-sm flex items-center gap-2 text-neutral-700 dark:text-neutral-300 mb-5">
              <ShoppingBag className="w-4 h-4 text-primary-500" /> Order Summary
            </h2>

            <PackageItems
              pricing={pricing}
              quantity={quantity}
              onQuantity={changeQuantity}
              disabled={loading}
            />

            <div className="mb-5 pb-5 border-b border-neutral-200 dark:border-white/8">
              {promo ? (
                <div className="flex items-center justify-between gap-2 bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/20 rounded-xl px-3 py-2.5">
                  <span className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400 font-medium">
                    <Check className="w-4 h-4" /><span className="font-mono">{promo.code}</span> applied
                  </span>
                  <button
                    onClick={() => { setPromo(null); setPromoInput(""); setPromoError(""); }}
                    className="text-xs text-neutral-500 hover:text-neutral-900 dark:hover:text-white"
                  >
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
                      className="flex-1 bg-neutral-50 dark:bg-neutral-800 border border-neutral-300 dark:border-white/10 rounded-xl px-3 py-2 text-sm font-mono tracking-wider focus:outline-none focus:border-primary-500 transition-colors"
                    />
                    <button
                      onClick={() => applyPromo()}
                      disabled={promoLoading || !promoInput.trim()}
                      className="px-4 py-2 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 text-sm font-semibold hover:opacity-90 disabled:opacity-50"
                    >
                      {promoLoading ? "…" : "Apply"}
                    </button>
                  </div>
                  {promoError && <p className="text-red-500 text-xs mt-1.5">{promoError}</p>}
                </>
              )}
            </div>

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
              onClick={handlePay}
              disabled={loading || !scriptReady}
              className="mt-6 w-full py-4 rounded-full bg-primary-500 hover:bg-primary-600 disabled:opacity-60 disabled:cursor-not-allowed font-bold text-white flex items-center justify-center gap-2 transition-all shadow-lg shadow-primary-500/20"
            >
              <Lock className="w-4 h-4" />
              {loading ? "Opening payment…" : `Pay ₹${rupees(totalPaise)}`}
            </button>
            {error && <p className="text-red-500 text-xs mt-2 text-center">{error}</p>}

            <PaymentTrust />

            {/* The delivery promise stays a separate, animated line rather than
                joining the itemised list above: there it is a price (₹0), here
                it is a reassurance about time. */}
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
    </div>
  );
}

"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Lock, ShoppingBag, Tag, Check, User, MapPin, Loader2,
} from "lucide-react";
import type { AddressType } from "@/lib/address";
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
  DeliveryPromise,
  type AppliedPromo,
} from "./OrderSummary";
import type { PreorderFacts } from "@/lib/preorder";
import {
  FormCard,
  Field,
  inputClass,
  PhoneInput,
  AddressTypeToggle,
  AutoFillNote,
  usePincodeLookup,
  areaFor,
} from "../FormFields";

declare global {
  interface Window { Razorpay: new (options: object) => { open: () => void }; }
}

const rupees = (paise: number) => Math.round(paise / 100);
const MOBILE = /^[6-9]\d{9}$/;

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
  checkout,
  preorder,
}: {
  pricing: ProductPricing;
  /** What the gift add-ons cost today, and whether each is offered. */
  gift: GiftSettings;
  /** What the checkout shows — currently just the promo field's switch. */
  checkout: CheckoutSettings;
  preorder: PreorderFacts;
}) {
  const router = useRouter();

  const [phone, setPhone] = useState("");
  // 0085. A second number for the courier to try — optional.
  const [altPhone, setAltPhone] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  // 0064. Home by default — it is what nearly every order is, and a required
  // choice with an obvious answer is a tap taken from the customer.
  const [addressType, setAddressType] = useState<AddressType>("home");
  const [houseName, setHouseName] = useState("");
  // "Place" on the form.
  const [address1, setAddress1] = useState("");
  // "Landmark" on the form.
  const [address2, setAddress2] = useState("");
  const [pincode, setPincode] = useState("");
  // "Area / locality" on the form — a dropdown when the pincode has several.
  const [city, setCity] = useState("");
  const [district, setDistrict] = useState("");
  const [state, setState] = useState("");

  const {
    localities,
    loading: pinLoading,
    error: pinError,
    manual: manualMode,
    lookup: lookupPincode,
  } = usePincodeLookup({
    onFound: ({ district: d, state: s, localities: list }) => {
      setDistrict(d);
      setState(s);
      setCity((c) => areaFor(c, list));
      setErrors((p) => ({ ...p, pincode: "", state: "", city: "" }));
    },
    onClear: () => {
      setDistrict("");
      setState("");
    },
  });

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
  const phoneValid = MOBILE.test(phone);

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
      phone, name, email, houseName, addressType,
      address1, address2, city, district, state, pincode,
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
  }, [phone, phoneValid, name, email, houseName, addressType,
      address1, address2, city, district, state, pincode]);

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

  /** Set a field and clear its error in one go. */
  const edit = (f: string, set: (v: string) => void) => (v: string) => {
    set(v);
    if (errors[f]) setErrors((p) => ({ ...p, [f]: "" }));
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = "Please enter your full name.";
    if (!phoneValid) e.phone = "Please enter a valid 10-digit mobile number.";
    if (altPhone && !MOBILE.test(altPhone)) e.alt_phone = "Please enter a valid 10-digit number.";
    else if (altPhone && altPhone === phone) e.alt_phone = "Use a different number from your contact number.";
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) e.email = "Please enter a valid email.";
    if (!houseName.trim()) e.house_name = "Please enter your house or building name.";
    if (!address1.trim()) e.address1 = "Please enter your place.";
    if (!address2.trim()) e.address2 = "Please enter a landmark.";
    if (!/^\d{6}$/.test(pincode)) e.pincode = "Please enter a 6-digit pincode.";
    if (!city.trim()) e.city = "Please select or enter your area / locality.";
    if (!state.trim()) e.state = "State is required.";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handlePay = async () => {
    if (!validate()) {
      // After the error paragraphs render, not before.
      requestAnimationFrame(() =>
        document.querySelector("[data-error='true']")?.scrollIntoView({
          behavior: "smooth", block: "center",
        })
      );
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
          alt_phone: altPhone || null,
          address1, address2, city, district, state, pincode,
          house_name: houseName, address_type: addressType,
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

  return (
    <div className="min-h-screen bg-neutral-100 dark:bg-neutral-950 text-neutral-900 dark:text-white">
      <nav className="border-b border-neutral-200 dark:border-white/8 px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between sticky top-0 bg-white/90 dark:bg-neutral-950/90 backdrop-blur-sm z-10">
        <Link href="/neuro-code" className="flex items-center gap-2 text-neutral-500 hover:text-neutral-900 dark:hover:text-white text-sm transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back
        </Link>
        <span className="font-bold text-sm">Neuro <span className="text-primary-500">Code</span></span>
      </nav>

      <div className="max-w-5xl mx-auto px-3 sm:px-4 py-4 sm:py-8 grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-3 sm:gap-6 items-start">
        <div className="space-y-3 sm:space-y-4">
          <h1 className="text-xl sm:text-2xl font-black px-1 sm:px-0">Complete Your Order</h1>

          {/* Your details */}
          <FormCard icon={<User />} title="Your Details">
            <Field htmlFor="co-name" label="Full Name" ml="മുഴുവൻ പേര്" required error={errors.name}>
              <input
                id="co-name"
                autoComplete="name"
                className={inputClass(errors.name)}
                placeholder="Enter your full name"
                value={name}
                onChange={(e) => edit("name", setName)(e.target.value)}
              />
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field
                htmlFor="co-phone"
                label="Contact Number"
                ml="കോൺടാക്ട് നമ്പർ"
                required
                error={errors.phone}
              >
                <PhoneInput
                  id="co-phone"
                  value={phone}
                  onChange={edit("phone", setPhone)}
                  placeholder="WhatsApp number"
                  error={errors.phone}
                />
              </Field>

              <Field
                htmlFor="co-alt-phone"
                label="Alternative Number"
                ml="മറ്റൊരു നമ്പർ"
                error={errors.alt_phone}
              >
                {/* "(optional)" lives in the placeholder, not the label: in
                    the label it wrapped to a second line and pushed this
                    input below the contact number beside it. */}
                <PhoneInput
                  id="co-alt-phone"
                  autoComplete="off"
                  value={altPhone}
                  onChange={edit("alt_phone", setAltPhone)}
                  placeholder="Alternative number (optional)"
                  error={errors.alt_phone}
                />
              </Field>
            </div>

            <Field htmlFor="co-email" label="Email" ml="ഇമെയിൽ" optional error={errors.email}>
              <input
                id="co-email"
                type="email"
                autoComplete="email"
                className={inputClass(errors.email)}
                placeholder="Enter your email"
                value={email}
                onChange={(e) => edit("email", setEmail)(e.target.value)}
              />
            </Field>
          </FormCard>

          {/* Delivery address */}
          <FormCard icon={<MapPin />} title="Delivery Address">
            <AddressTypeToggle value={addressType} onChange={setAddressType} />

            {/* The field this whole shape exists for: a named house is
                findable when a street name is not. */}
            <Field
              htmlFor="co-house"
              label={addressType === "office" ? "Office / Building Name" : "House / Building Name"}
              ml="വീടിന്റെ അല്ലെങ്കിൽ കെട്ടിടത്തിന്റെ പേര്"
              required
              error={errors.house_name}
            >
              <input
                id="co-house" autoComplete="address-line1"
                className={inputClass(errors.house_name)}
                placeholder={addressType === "office" ? "Enter office or building name" : "Enter house or building name"}
                value={houseName}
                onChange={(e) => edit("house_name", setHouseName)(e.target.value)}
              />
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field htmlFor="co-place" label="Place" ml="സ്ഥലം" required error={errors.address1}>
                <input
                  id="co-place"
                  autoComplete="address-line2"
                  className={inputClass(errors.address1)}
                  placeholder="Enter place"
                  value={address1}
                  onChange={(e) => edit("address1", setAddress1)(e.target.value)}
                />
              </Field>

              <Field htmlFor="co-landmark" label="Landmark / Nearby" ml="ലാൻഡ്മാർക്ക്" required error={errors.address2}>
                <input
                  id="co-landmark" autoComplete="off"
                  className={inputClass(errors.address2)}
                  placeholder="Enter landmark"
                  value={address2}
                  onChange={(e) => edit("address2", setAddress2)(e.target.value)}
                />
              </Field>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field
                htmlFor="co-pincode"
                label="Pincode"
                ml="പിൻകോഡ്"
                required
                error={errors.pincode || undefined}
                hint={pinError ? <span className="text-amber-600">{pinError}</span> : undefined}
              >
                <div className="relative">
                  <input
                    id="co-pincode"
                    autoComplete="postal-code"
                    inputMode="numeric"
                    maxLength={6}
                    className={inputClass(errors.pincode)}
                    placeholder="Enter pincode"
                    value={pincode}
                    onChange={(e) => {
                      // District, state and area follow the pincode — looked up
                      // here, the moment it changes (typed, pasted or autofilled).
                      const v = e.target.value.replace(/\D/g, "").slice(0, 6);
                      edit("pincode", setPincode)(v);
                      if (v !== pincode) void lookupPincode(v);
                    }}
                  />
                  {pinLoading && (
                    <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 text-primary-500 animate-spin absolute right-3 sm:right-4 top-1/2 -translate-y-1/2" />
                  )}
                </div>
              </Field>

              <Field htmlFor="co-area" label="Area / Locality" ml="പ്രദേശം" required error={errors.city}>
                {localities.length > 1 ? (
                  <select
                    id="co-area"
                    className={`${inputClass(errors.city)} appearance-none cursor-pointer`}
                    value={city}
                    onChange={(e) => edit("city", setCity)(e.target.value)}
                  >
                    <option value="">Select your area</option>
                    {localities.map((l) => <option key={l} value={l}>{l}</option>)}
                  </select>
                ) : (
                  <input
                    id="co-area"
                    className={inputClass(errors.city)}
                    placeholder="Enter area / locality" autoComplete="address-level3"
                    value={city}
                    onChange={(e) => edit("city", setCity)(e.target.value)}
                  />
                )}
              </Field>
            </div>

            {/* Filled from the pincode — not typed, unless the lookup is down */}
            <div className="grid grid-cols-2 gap-3">
              <Field htmlFor="co-district" label="District" ml="ജില്ല">
                <input
                  id="co-district"
                  className={inputClass(undefined, !manualMode)}
                  value={district}
                  readOnly={!manualMode}
                  placeholder="From pincode"
                  onChange={(e) => setDistrict(e.target.value)}
                />
              </Field>
              <Field htmlFor="co-state" label="State" ml="സംസ്ഥാനം" error={errors.state}>
                <input
                  id="co-state"
                  className={manualMode ? inputClass(errors.state) : inputClass(undefined, true)}
                  value={state}
                  readOnly={!manualMode}
                  placeholder="From pincode"
                  onChange={(e) => edit("state", setState)(e.target.value)}
                />
              </Field>
            </div>

            <AutoFillNote />
          </FormCard>
        </div>

        {/* Summary */}
        <div className="lg:sticky lg:top-24">
          <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-white/8 rounded-2xl p-3.5 sm:p-5 shadow-sm dark:shadow-none">
            <h2 className="font-semibold text-sm flex items-center gap-2 text-neutral-700 dark:text-neutral-300 mb-4">
              <ShoppingBag className="w-4 h-4 text-primary-500" /> Order Summary
            </h2>

            <PackageItems
              pricing={pricing}
              quantity={quantity}
              onQuantity={changeQuantity}
              disabled={loading}
            />

            {/* The whole block, not just the input: with the field switched
                off there is no way to have applied a code, so the "applied"
                state below it cannot arise either. */}
            {checkout.promoFieldIsEnabled && (
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
                      className="flex-1 min-w-0 bg-neutral-50 dark:bg-neutral-800 border border-neutral-300 dark:border-white/10 rounded-xl px-3 py-2 text-base sm:text-sm font-mono tracking-wider focus:outline-none focus:border-primary-500 transition-colors"
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
              onClick={handlePay}
              disabled={loading || !scriptReady}
              className="mt-6 w-full py-3.5 sm:py-4 rounded-xl bg-primary-500 hover:bg-primary-600 active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed font-bold text-white text-base sm:text-lg flex items-center justify-center gap-2 transition-all shadow-lg shadow-primary-500/20"
            >
              <Lock className="w-4 h-4" />
              {loading ? "Opening payment…" : `Pay ₹${rupees(totalPaise)}`}
            </button>
            {error && <p className="text-red-500 text-xs mt-2 text-center">{error}</p>}

            <PaymentTrust />

            <DeliveryPromise preorder={preorder} />
          </div>
        </div>
      </div>
    </div>
  );
}

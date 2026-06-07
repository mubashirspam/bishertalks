"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Lock, ShoppingBag, MapPin, User, Tag, Check } from "lucide-react";
import type { ProductPricing } from "@/lib/db/courses";

const INDIAN_STATES = [
  "Andhra Pradesh","Arunachal Pradesh","Assam","Bihar","Chhattisgarh",
  "Goa","Gujarat","Haryana","Himachal Pradesh","Jharkhand","Karnataka",
  "Kerala","Madhya Pradesh","Maharashtra","Manipur","Meghalaya","Mizoram",
  "Nagaland","Odisha","Punjab","Rajasthan","Sikkim","Tamil Nadu","Telangana",
  "Tripura","Uttar Pradesh","Uttarakhand","West Bengal","Delhi",
  "Jammu & Kashmir","Ladakh","Puducherry","Chandigarh",
  "Andaman & Nicobar","Dadra & Nagar Haveli","Daman & Diu","Lakshadweep",
];

type FormData = {
  name: string; phone: string; email: string;
  address1: string; address2: string;
  city: string; state: string; pincode: string;
};
type FormErrors = Partial<Record<keyof FormData, string>>;

type AppliedPromo = { code: string; discountPaise: number; finalPaise: number };

declare global {
  interface Window { Razorpay: new (options: object) => { open: () => void }; }
}

const rupees = (paise: number) => Math.round(paise / 100);

export default function CheckoutForm({ pricing }: { pricing: ProductPricing }) {
  const router = useRouter();
  const [form, setForm] = useState<FormData>({
    name: "", phone: "", email: "", address1: "",
    address2: "", city: "", state: "", pincode: "",
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [loading, setLoading] = useState(false);
  const [scriptReady, setScriptReady] = useState(false);

  // Promo state
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

  const validate = (): boolean => {
    const e: FormErrors = {};
    if (!form.name.trim()) e.name = "Name is required";
    if (!/^[6-9]\d{9}$/.test(form.phone)) e.phone = "Enter a valid 10-digit mobile number";
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = "Enter a valid email";
    if (!form.address1.trim()) e.address1 = "Address is required";
    if (!form.city.trim()) e.city = "City is required";
    if (!form.state) e.state = "State is required";
    if (!/^\d{6}$/.test(form.pincode)) e.pincode = "Enter a valid 6-digit pincode";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate() || !scriptReady) return;
    setLoading(true);
    try {
      const createRes = await fetch("/api/orders/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, promoCode: promo?.code ?? null }),
      });
      const createData = await createRes.json();
      if (createData.error) throw new Error(createData.error);

      const { razorpay_order_id, order_number, amount, key_id } = createData;

      const rzp = new window.Razorpay({
        key: key_id,
        amount,
        currency: "INR",
        order_id: razorpay_order_id,
        name: "Neuro Code",
        description: "Book by Bisher KC",
        image: "/images/book_front.png",
        prefill: { name: form.name, email: form.email, contact: form.phone },
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
              alert("Payment verification failed. Please contact support with your order number: " + order_number);
              setLoading(false);
            }
          } catch (error) {
            console.error("Verification error:", error);
            alert("Payment verification failed. Please contact support with your order number: " + order_number);
            setLoading(false);
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
      alert("Something went wrong. Please try again.");
      setLoading(false);
    }
  };

  const set = (field: keyof FormData) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setForm(prev => ({ ...prev, [field]: e.target.value }));
      if (errors[field]) setErrors(prev => ({ ...prev, [field]: undefined }));
    };

  const inputCls = (field: keyof FormData) =>
    `w-full bg-neutral-50 dark:bg-neutral-800 border ${
      errors[field] ? "border-red-500" : "border-neutral-300 dark:border-white/10"
    } rounded-xl px-4 py-3 text-neutral-900 dark:text-white placeholder-neutral-400 dark:placeholder-neutral-500 focus:outline-none focus:border-primary-500 transition-colors text-sm`;

  return (
    <div className="min-h-screen bg-white dark:bg-neutral-950 text-neutral-900 dark:text-white">
      <nav className="border-b border-neutral-200 dark:border-white/8 px-6 py-4 flex items-center justify-between sticky top-0 bg-white/90 dark:bg-neutral-950/90 backdrop-blur-sm z-10">
        <Link href="/neuro-code" className="flex items-center gap-2 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white text-sm transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back
        </Link>
        <span className="font-bold text-sm">Neuro <span className="text-primary-500 dark:text-primary-400">Code</span></span>
      </nav>

      <div className="max-w-5xl mx-auto px-4 py-10 grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-8 items-start">
        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-5">
          <h1 className="text-2xl font-black">Complete Your Order</h1>

          {/* Personal */}
          <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-white/8 rounded-2xl p-6 space-y-4 shadow-sm dark:shadow-none">
            <h2 className="font-semibold text-sm flex items-center gap-2 text-neutral-700 dark:text-neutral-300">
              <User className="w-4 h-4 text-primary-500 dark:text-primary-400" /> Personal Details
            </h2>
            <div>
              <input className={inputCls("name")} placeholder="Full Name *" value={form.name} onChange={set("name")} />
              {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name}</p>}
            </div>
            <div>
              <div className="flex">
                <span className="bg-neutral-100 dark:bg-neutral-700 border border-neutral-300 dark:border-white/10 border-r-0 rounded-l-xl px-3 flex items-center text-neutral-500 dark:text-neutral-400 text-sm select-none">+91</span>
                <input
                  className={`${inputCls("phone")} rounded-l-none border-l-0`}
                  placeholder="WhatsApp Number *"
                  value={form.phone}
                  onChange={set("phone")}
                  maxLength={10}
                  inputMode="numeric"
                />
              </div>
              {errors.phone && <p className="text-red-500 text-xs mt-1">{errors.phone}</p>}
            </div>
            <div>
              <input className={inputCls("email")} placeholder="Email (optional, for receipt)" value={form.email} onChange={set("email")} type="email" />
              {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email}</p>}
            </div>
          </div>

          {/* Address */}
          <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-white/8 rounded-2xl p-6 space-y-4 shadow-sm dark:shadow-none">
            <h2 className="font-semibold text-sm flex items-center gap-2 text-neutral-700 dark:text-neutral-300">
              <MapPin className="w-4 h-4 text-primary-500 dark:text-primary-400" /> Shipping Address
            </h2>
            <div>
              <input className={inputCls("address1")} placeholder="Address Line 1 *" value={form.address1} onChange={set("address1")} />
              {errors.address1 && <p className="text-red-500 text-xs mt-1">{errors.address1}</p>}
            </div>
            <input className={inputCls("address2")} placeholder="Address Line 2 (optional)" value={form.address2} onChange={set("address2")} />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <input className={inputCls("city")} placeholder="City *" value={form.city} onChange={set("city")} />
                {errors.city && <p className="text-red-500 text-xs mt-1">{errors.city}</p>}
              </div>
              <div>
                <input className={inputCls("pincode")} placeholder="Pincode *" value={form.pincode} onChange={set("pincode")} maxLength={6} inputMode="numeric" />
                {errors.pincode && <p className="text-red-500 text-xs mt-1">{errors.pincode}</p>}
              </div>
            </div>
            <div>
              <select className={`${inputCls("state")} appearance-none cursor-pointer`} value={form.state} onChange={set("state")}>
                <option value="">Select State *</option>
                {INDIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              {errors.state && <p className="text-red-500 text-xs mt-1">{errors.state}</p>}
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || !scriptReady}
            className="w-full py-4 rounded-full bg-primary-500 hover:bg-primary-600 disabled:opacity-60 disabled:cursor-not-allowed font-bold text-white flex items-center justify-center gap-2 transition-all shadow-lg shadow-primary-500/20"
          >
            <Lock className="w-4 h-4" />
            {loading ? "Processing…" : `Pay ₹${rupees(totalPaise)} — Secure Checkout`}
          </button>
          <p className="text-center text-neutral-500 text-xs">
            🔒 Powered by Razorpay · UPI · Cards · Netbanking · Wallets
          </p>
        </form>

        {/* Order summary */}
        <div className="lg:sticky lg:top-20">
          <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-white/8 rounded-2xl p-6 shadow-sm dark:shadow-none">
            <h2 className="font-semibold text-sm flex items-center gap-2 text-neutral-700 dark:text-neutral-300 mb-5">
              <ShoppingBag className="w-4 h-4 text-primary-500 dark:text-primary-400" /> Order Summary
            </h2>
            <div className="flex gap-4 mb-5 pb-5 border-b border-neutral-200 dark:border-white/8">
              <div className="w-14 h-18 rounded-lg overflow-hidden flex-shrink-0 bg-neutral-100 dark:bg-neutral-800">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/images/book_front.png" alt="Neuro Code" className="w-full h-full object-cover" />
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

            <div className="mt-4 bg-neutral-100 dark:bg-neutral-800/60 rounded-xl p-3 text-xs text-neutral-500 dark:text-neutral-400 flex items-center gap-2">
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
    </div>
  );
}

"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { MapPin, Loader2, Check, Package } from "lucide-react";

interface Props {
  orderNumber: string;
  token: string;
  initial: {
    name: string | null;
    address1: string | null;
    address2: string | null;
    city: string | null;
    district: string | null;
    state: string | null;
    pincode: string | null;
  };
}

/**
 * Delivery address, collected after payment.
 *
 * Pincode drives district and state — they're looked up, shown read-only, and
 * never typed. Locality comes from the post offices in that pincode. If the
 * lookup is unavailable the fields unlock so a customer is never blocked by a
 * third-party API being down.
 */
export default function AddressForm({ orderNumber, token, initial }: Props) {
  const router = useRouter();

  const [name, setName] = useState(initial.name ?? "");
  const [address1, setAddress1] = useState(initial.address1 ?? "");
  const [address2, setAddress2] = useState(initial.address2 ?? "");
  const [pincode, setPincode] = useState(initial.pincode ?? "");
  const [city, setCity] = useState(initial.city ?? "");
  const [district, setDistrict] = useState(initial.district ?? "");
  const [state, setState] = useState(initial.state ?? "");

  const [localities, setLocalities] = useState<string[]>([]);
  const [pinLoading, setPinLoading] = useState(false);
  const [pinError, setPinError] = useState("");
  const [manualMode, setManualMode] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Look up district/state/localities whenever a full pincode is entered.
  useEffect(() => {
    if (!/^\d{6}$/.test(pincode)) {
      setLocalities([]);
      return;
    }
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
          // Auto-pick when the pincode maps to a single locality.
          if (data.localities?.length === 1) setCity(data.localities[0]);
        } else {
          setPinError(
            res.status === 404
              ? "We couldn't find that pincode — please check it."
              : "Lookup unavailable. Please enter your district and state."
          );
          setManualMode(true);
          setLocalities([]);
        }
      } catch {
        if (!cancelled) {
          setPinError("Lookup unavailable. Please enter your district and state.");
          setManualMode(true);
        }
      } finally {
        if (!cancelled) setPinLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [pincode]);

  const submit = async () => {
    setError("");
    if (!name.trim()) return setError("Please enter your name.");
    if (!address1.trim()) return setError("Please enter your address.");
    if (!/^\d{6}$/.test(pincode)) return setError("Please enter a valid 6-digit pincode.");
    if (!city.trim()) return setError("Please select or enter your area.");
    if (!state.trim()) return setError("Please enter your state.");

    setSaving(true);
    try {
      const res = await fetch("/api/orders/address", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_number: orderNumber,
          token,
          name, address1, address2, pincode, city, district, state,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Could not save");
      router.push(`/neuro-code/thank-you?id=${orderNumber}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save your address.");
      setSaving(false);
    }
  };

  const inputCls =
    "w-full bg-neutral-900 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-neutral-500 focus:outline-none focus:border-primary-500 transition-colors text-sm";
  const readOnlyCls =
    "w-full bg-neutral-800/60 border border-white/5 rounded-xl px-4 py-3 text-neutral-300 text-sm cursor-not-allowed";

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <div className="max-w-md mx-auto px-4 py-12">
        {/* Payment already succeeded — lead with that so nobody worries. */}
        <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/20 rounded-xl px-4 py-3 mb-6">
          <Check className="w-4 h-4 text-green-400 flex-shrink-0" />
          <p className="text-sm text-green-300">
            Payment received — order <span className="font-mono">{orderNumber}</span>
          </p>
        </div>

        <h1 className="text-2xl font-black mb-1 flex items-center gap-2">
          <Package className="w-5 h-5 text-primary-400" /> Where should we send it?
        </h1>
        <p className="text-neutral-400 text-sm mb-6">
          One last step and your book is on its way.
        </p>

        <div className="space-y-4">
          <input
            className={inputCls}
            placeholder="Full name *"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className={inputCls}
            placeholder="House / street / area *"
            value={address1}
            onChange={(e) => setAddress1(e.target.value)}
          />
          <input
            className={inputCls}
            placeholder="Landmark (optional)"
            value={address2}
            onChange={(e) => setAddress2(e.target.value)}
          />

          {/* Pincode drives everything below it */}
          <div>
            <div className="relative">
              <input
                className={inputCls}
                placeholder="Pincode *"
                value={pincode}
                onChange={(e) => setPincode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                maxLength={6}
                inputMode="numeric"
              />
              {pinLoading && (
                <Loader2 className="w-4 h-4 text-primary-400 animate-spin absolute right-4 top-1/2 -translate-y-1/2" />
              )}
            </div>
            {pinError && <p className="text-amber-400 text-xs mt-1.5">{pinError}</p>}
          </div>

          {/* Locality: a dropdown when we know the options, free text otherwise */}
          {localities.length > 1 ? (
            <select
              className={`${inputCls} appearance-none cursor-pointer`}
              value={city}
              onChange={(e) => setCity(e.target.value)}
            >
              <option value="">Select your area *</option>
              {localities.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          ) : (
            <input
              className={inputCls}
              placeholder="Area / locality *"
              value={city}
              onChange={(e) => setCity(e.target.value)}
            />
          )}

          {/* District + state: filled from the pincode, not asked for */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-neutral-500 text-xs mb-1.5 block">District</label>
              <input
                className={manualMode ? inputCls : readOnlyCls}
                value={district}
                readOnly={!manualMode}
                placeholder="From pincode"
                onChange={(e) => setDistrict(e.target.value)}
              />
            </div>
            <div>
              <label className="text-neutral-500 text-xs mb-1.5 block">State</label>
              <input
                className={manualMode ? inputCls : readOnlyCls}
                value={state}
                readOnly={!manualMode}
                placeholder="From pincode"
                onChange={(e) => setState(e.target.value)}
              />
            </div>
          </div>

          <button
            onClick={submit}
            disabled={saving}
            className="w-full py-4 rounded-full bg-primary-500 hover:bg-primary-600 disabled:opacity-60 font-bold text-white transition-all shadow-lg shadow-primary-500/20"
          >
            {saving ? "Saving…" : "Confirm delivery address"}
          </button>
          {error && <p className="text-red-400 text-sm text-center">{error}</p>}

          <p className="text-neutral-500 text-xs text-center">
            District and state fill in automatically from your pincode.
          </p>
        </div>
      </div>
    </div>
  );
}

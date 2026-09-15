"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { MapPin, Loader2, Check, Package, User, ArrowRight } from "lucide-react";
import type { AddressType } from "@/lib/address";
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

interface Props {
  orderNumber: string;
  token: string;
  initial: {
    name: string | null;
    houseName: string | null;
    doorNo: string | null;
    address1: string | null;
    address2: string | null;
    city: string | null;
    district: string | null;
    state: string | null;
    pincode: string | null;
  };
}

const MOBILE = /^[6-9]\d{9}$/;

/**
 * Delivery address, collected after payment.
 *
 * Same fields and the same look as the checkout (see ../FormFields), so a
 * customer who has seen one knows the other. Pincode drives district and
 * state — they're looked up, shown read-only, and never typed. Locality comes
 * from the post offices in that pincode. If the lookup is unavailable the
 * fields unlock so a customer is never blocked by a third-party API being down.
 */
export default function AddressForm({ orderNumber, token, initial }: Props) {
  const router = useRouter();

  const [name, setName] = useState(initial.name ?? "");
  // 0085. Optional — the contact number is already on the order.
  const [altPhone, setAltPhone] = useState("");
  // 0064. The house by name is the field this shop added because "which house"
  // is the question a delivery agent cannot answer from a street name.
  const [addressType, setAddressType] = useState<AddressType>("home");
  const [houseName, setHouseName] = useState(initial.houseName ?? "");
  // No longer asked for on this form; a door number already on the order
  // is sent back unchanged rather than wiped.
  const [doorNo] = useState(initial.doorNo ?? "");
  // "Place" on the form.
  const [address1, setAddress1] = useState(initial.address1 ?? "");
  // "Landmark" on the form.
  const [address2, setAddress2] = useState(initial.address2 ?? "");
  const [pincode, setPincode] = useState(initial.pincode ?? "");
  // "Area / locality" on the form.
  const [city, setCity] = useState(initial.city ?? "");
  const [district, setDistrict] = useState(initial.district ?? "");
  const [state, setState] = useState(initial.state ?? "");

  const {
    localities,
    loading: pinLoading,
    error: pinError,
    manual: manualMode,
    lookup: lookupPincode,
  } = usePincodeLookup({
    onFound: ({ district: d, state: s, localities: list, initial: onLoad }) => {
      setDistrict(d);
      setState(s);
      // On load, the area already saved on the order stands even if it isn't
      // one of India Post's names — it is shown as an extra option below.
      setCity((c) => (onLoad && c ? c : areaFor(c, list)));
      setErrors((p) => ({ ...p, pincode: "", state: "", city: "" }));
    },
    onClear: () => {
      setDistrict("");
      setState("");
    },
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // A pincode already on the order is looked up once when the page opens, so
  // the locality list is there without retyping it. Deferred a tick so the
  // lookup's state updates land from a callback, not the effect body.
  useEffect(() => {
    const saved = initial.pincode ?? "";
    if (!/^\d{6}$/.test(saved)) return;
    const t = setTimeout(() => void lookupPincode(saved, { initial: true }), 0);
    return () => clearTimeout(t);
    // Once, on mount: later changes go through the pincode input's onChange.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Set a field and clear its error in one go. */
  const edit = (f: string, set: (v: string) => void) => (v: string) => {
    set(v);
    if (errors[f]) setErrors((p) => ({ ...p, [f]: "" }));
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = "Please enter your full name.";
    if (altPhone && !MOBILE.test(altPhone)) e.alt_phone = "Please enter a valid 10-digit number.";
    if (!houseName.trim()) e.house_name = "Please enter your house or building name.";
    if (!address1.trim()) e.address1 = "Please enter your place.";
    if (!address2.trim()) e.address2 = "Please enter a landmark.";
    if (!/^\d{6}$/.test(pincode)) e.pincode = "Please enter a 6-digit pincode.";
    if (!city.trim()) e.city = "Please select or enter your area / locality.";
    if (!state.trim()) e.state = "State is required.";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async () => {
    setError("");
    if (!validate()) {
      requestAnimationFrame(() =>
        document.querySelector("[data-error='true']")?.scrollIntoView({
          behavior: "smooth", block: "center",
        })
      );
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/orders/address", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_number: orderNumber,
          token,
          name, address1, address2, pincode, city, district, state,
          house_name: houseName, door_no: doorNo, address_type: addressType,
          alt_phone: altPhone || null,
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

  return (
    <div className="min-h-screen bg-neutral-100 dark:bg-neutral-950 text-neutral-900 dark:text-white">
      <div className="max-w-2xl mx-auto px-3 sm:px-4 py-4 sm:py-8 space-y-3 sm:space-y-4">
        {/* Payment already succeeded — lead with that so nobody worries. */}
        <div className="flex items-center gap-2 bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/20 rounded-xl px-3 sm:px-4 py-2.5 sm:py-3">
          <Check className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0" />
          <p className="text-sm text-green-800 dark:text-green-300">
            Payment received — order <span className="font-mono">{orderNumber}</span>
          </p>
        </div>

        <div className="px-1 sm:px-0">
          <h1 className="text-xl sm:text-2xl font-black flex items-center gap-2">
            <Package className="w-5 h-5 text-primary-500" /> Where should we send it?
          </h1>
          <p className="text-neutral-500 dark:text-neutral-400 text-sm mt-1">
            One last step and your book is on its way.
          </p>
        </div>

        <FormCard icon={<User />} title="Your Details">
          <Field htmlFor="ad-name" label="Full Name" ml="മുഴുവൻ പേര്" required error={errors.name}>
            <input
              id="ad-name"
              autoComplete="name"
              className={inputClass(errors.name)}
              placeholder="Enter your full name"
              value={name}
              onChange={(e) => edit("name", setName)(e.target.value)}
            />
          </Field>

          <Field
            htmlFor="ad-alt-phone"
            label="Alternative Number"
            ml="മറ്റൊരു നമ്പർ"
            error={errors.alt_phone}
          >
            <PhoneInput
              id="ad-alt-phone"
              autoComplete="off"
              value={altPhone}
              onChange={edit("alt_phone", setAltPhone)}
              placeholder="Alternative number (optional)"
              error={errors.alt_phone}
            />
          </Field>
        </FormCard>

        <FormCard icon={<MapPin />} title="Delivery Address">
          <AddressTypeToggle value={addressType} onChange={setAddressType} />

          <Field
            htmlFor="ad-house"
            label={addressType === "office" ? "Office / Building Name" : "House / Building Name"}
            ml="വീടിന്റെ അല്ലെങ്കിൽ കെട്ടിടത്തിന്റെ പേര്"
            required
            error={errors.house_name}
          >
            <input
              id="ad-house" autoComplete="address-line1"
              className={inputClass(errors.house_name)}
              placeholder={addressType === "office" ? "Enter office or building name" : "Enter house or building name"}
              value={houseName}
              onChange={(e) => edit("house_name", setHouseName)(e.target.value)}
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field htmlFor="ad-place" label="Place" ml="സ്ഥലം" required error={errors.address1}>
              <input
                id="ad-place"
                autoComplete="address-line2"
                className={inputClass(errors.address1)}
                placeholder="Enter place"
                value={address1}
                onChange={(e) => edit("address1", setAddress1)(e.target.value)}
              />
            </Field>

            <Field htmlFor="ad-landmark" label="Landmark / Nearby" ml="ലാൻഡ്മാർക്ക്" required error={errors.address2}>
              <input
                id="ad-landmark" autoComplete="off"
                className={inputClass(errors.address2)}
                placeholder="Enter landmark"
                value={address2}
                onChange={(e) => edit("address2", setAddress2)(e.target.value)}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field
              htmlFor="ad-pincode"
              label="Pincode"
              ml="പിൻകോഡ്"
              required
              error={errors.pincode || undefined}
              hint={pinError ? <span className="text-amber-600">{pinError}</span> : undefined}
            >
              <div className="relative">
                <input
                  id="ad-pincode"
                  autoComplete="postal-code"
                  inputMode="numeric"
                  maxLength={6}
                  className={inputClass(errors.pincode)}
                  placeholder="Enter pincode"
                  value={pincode}
                  onChange={(e) => {
                    // Looked up the moment the pincode changes — typed, pasted
                    // or filled in by the browser.
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

            <Field htmlFor="ad-area" label="Area / Locality" ml="പ്രദേശം" required error={errors.city}>
              {localities.length > 1 ? (
                <select
                  id="ad-area"
                  className={`${inputClass(errors.city)} appearance-none cursor-pointer`}
                  value={city}
                  onChange={(e) => edit("city", setCity)(e.target.value)}
                >
                  <option value="">Select your area</option>
                  {/* The area saved on the order, when India Post names it differently. */}
                  {city && !localities.includes(city) && <option value={city}>{city}</option>}
                  {localities.map((l) => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
              ) : (
                <input
                  id="ad-area"
                  className={inputClass(errors.city)}
                  placeholder="Enter area / locality" autoComplete="address-level3"
                  value={city}
                  onChange={(e) => edit("city", setCity)(e.target.value)}
                />
              )}
            </Field>
          </div>

          {/* District + state: filled from the pincode, not asked for */}
          <div className="grid grid-cols-2 gap-3">
            <Field htmlFor="ad-district" label="District" ml="ജില്ല">
              <input
                id="ad-district"
                className={inputClass(undefined, !manualMode)}
                value={district}
                readOnly={!manualMode}
                placeholder="From pincode"
                onChange={(e) => setDistrict(e.target.value)}
              />
            </Field>
            <Field htmlFor="ad-state" label="State" ml="സംസ്ഥാനം" error={errors.state}>
              <input
                id="ad-state"
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

        <button
          onClick={submit}
          disabled={saving}
          className="w-full py-3.5 sm:py-4 rounded-xl bg-primary-500 hover:bg-primary-600 active:scale-[0.99] disabled:opacity-60 font-bold text-white text-base sm:text-lg flex items-center justify-center gap-2 transition-all shadow-lg shadow-primary-500/20"
        >
          {saving ? "Saving…" : "Confirm delivery address"}
          {!saving && <ArrowRight className="w-5 h-5" />}
        </button>
        {error && <p className="text-red-500 text-sm text-center">{error}</p>}
      </div>
    </div>
  );
}

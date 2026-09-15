"use client";

import { useRef, useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import { ADDRESS_TYPES, ADDRESS_TYPE_LABELS, type AddressType } from "@/lib/address";

/**
 * The pieces the checkout and the post-payment address form are built from,
 * so the two ask for an address in exactly the same way.
 *
 * Compact on a phone — nearly every one of these is filled in on one — and
 * roomier from `sm` up. Inputs stay at 16px text below `sm` on purpose: iOS
 * Safari zooms the whole page into any input smaller than that the moment it
 * is tapped, which on a form is worse than a slightly larger font.
 */

export function FormCard({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-white/10 rounded-2xl p-3.5 sm:p-5 shadow-sm dark:shadow-none space-y-3">
      <h2 className="flex items-center gap-2 font-bold text-base sm:text-lg text-neutral-900 dark:text-white">
        <span className="text-primary-500 [&>svg]:w-4 [&>svg]:h-4 sm:[&>svg]:w-5 sm:[&>svg]:h-5">{icon}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

/** A labelled field: English, then Malayalam, then the input, hint and error. */
export function Field({
  htmlFor,
  label,
  ml,
  required = false,
  optional = false,
  error,
  hint,
  className = "",
  children,
}: {
  htmlFor: string;
  label: string;
  /** The Malayalam label, shown after the English one. */
  ml?: string;
  required?: boolean;
  optional?: boolean;
  error?: string;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <label
        htmlFor={htmlFor}
        className="block text-[13px] sm:text-sm font-semibold leading-snug text-neutral-700 dark:text-neutral-300 mb-1"
      >
        {label}
        {optional && <span className="font-normal text-neutral-400"> (optional)</span>}
        {ml && <span className="font-normal text-neutral-500 dark:text-neutral-400"> / {ml}</span>}
        {required && <span className="text-red-500"> *</span>}
      </label>
      {children}
      {hint && !error && (
        <p className="text-[11px] sm:text-xs text-neutral-500 dark:text-neutral-400 mt-1">{hint}</p>
      )}
      {error && (
        <p data-error="true" className="text-[11px] sm:text-xs text-red-500 mt-1">
          {error}
        </p>
      )}
    </div>
  );
}

/** The one input style — editable, or the read-only "from pincode" look. */
export function inputClass(error?: string | boolean, readOnly = false): string {
  const base =
    "w-full rounded-lg sm:rounded-xl px-3 py-2 sm:py-2.5 text-base sm:text-sm transition-shadow focus:outline-none";
  if (readOnly) {
    return `${base} bg-neutral-100 dark:bg-neutral-800/60 border border-neutral-200 dark:border-white/5 text-neutral-500 dark:text-neutral-400 cursor-not-allowed`;
  }
  return `${base} bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white placeholder-neutral-400 border focus:border-primary-500 focus:ring-4 focus:ring-primary-500/15 ${
    error ? "border-red-500" : "border-neutral-300 dark:border-white/10"
  }`;
}

/** +91 and ten digits. Anything that isn't a digit never reaches the value. */
export function PhoneInput({
  id,
  value,
  onChange,
  placeholder,
  error,
  autoComplete = "tel-national",
}: {
  id: string;
  value: string;
  onChange: (digits: string) => void;
  placeholder: string;
  error?: string;
  /**
   * The browser-autofill hint. "off" for a second number: two inputs both
   * marked tel-national get the same saved number, which the form then
   * refuses as a duplicate.
   */
  autoComplete?: string;
}) {
  return (
    <div
      className={`flex rounded-lg sm:rounded-xl overflow-hidden border bg-white dark:bg-neutral-800 transition-shadow focus-within:border-primary-500 focus-within:ring-4 focus-within:ring-primary-500/15 ${
        error ? "border-red-500" : "border-neutral-300 dark:border-white/10"
      }`}
    >
      <span className="inline-flex items-center px-3 border-r border-neutral-300 dark:border-white/10 bg-neutral-50 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300 text-sm font-medium select-none">
        +91
      </span>
      <input
        id={id}
        type="tel"
        inputMode="numeric"
        autoComplete={autoComplete}
        maxLength={10}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 10))}
        className="flex-1 min-w-0 bg-transparent px-3 py-2 sm:py-2.5 text-base sm:text-sm text-neutral-900 dark:text-white placeholder-neutral-400 focus:outline-none"
      />
    </div>
  );
}

/**
 * Home or office. Two buttons, not a dropdown: there are two answers, and on
 * a phone a dropdown for two answers is a tap wasted.
 */
export function AddressTypeToggle({
  value,
  onChange,
}: {
  value: AddressType;
  onChange: (t: AddressType) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-1 p-1 bg-neutral-100 dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-white/10">
      {ADDRESS_TYPES.map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => onChange(t)}
          aria-pressed={value === t}
          className={`py-1.5 sm:py-2 px-4 text-sm rounded-lg transition-all duration-200 ${
            value === t
              ? "bg-primary-500 text-white font-bold shadow-sm"
              : "font-medium text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-200 dark:hover:bg-neutral-700"
          }`}
        >
          {ADDRESS_TYPE_LABELS[t]}
        </button>
      ))}
    </div>
  );
}

export interface PincodeFound {
  district: string;
  state: string;
  localities: string[];
  /** True for the lookup of a pincode already on the order when the page opened. */
  initial: boolean;
}

/**
 * Pincode → district, state and the locality list, for both address forms.
 *
 * Called from the pincode input's onChange (and once on load for a saved
 * pincode) rather than from an effect watching the value, so a lookup
 * happens exactly when the pincode changes. Every request carries a sequence
 * number and only the latest one may touch state — typing 67357 → 673573 →
 * 673574 quickly can't let a slower earlier answer overwrite a later one.
 *
 * The form owns district/state/city; this reports through `onFound` and
 * `onClear` so a stale district never survives a pincode that changed, went
 * incomplete, or wasn't found.
 */
export function usePincodeLookup({
  onFound,
  onClear,
}: {
  onFound: (r: PincodeFound) => void;
  onClear: () => void;
}) {
  const [localities, setLocalities] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // Lookup down or pincode unknown — district and state become typeable.
  const [manual, setManual] = useState(false);
  const seq = useRef(0);

  const lookup = async (pin: string, opts: { initial?: boolean } = {}) => {
    const id = ++seq.current;

    if (!/^\d{6}$/.test(pin)) {
      setLocalities([]);
      setLoading(false);
      setError("");
      setManual(false);
      onClear();
      return;
    }

    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/pincode/${pin}`);
      const data = await res.json().catch(() => ({}));
      if (id !== seq.current) return;

      if (data.found) {
        const list: string[] = Array.isArray(data.localities) ? data.localities : [];
        setLocalities(list);
        setManual(false);
        onFound({
          district: data.district ?? "",
          state: data.state ?? "",
          localities: list,
          initial: !!opts.initial,
        });
      } else {
        setLocalities([]);
        setManual(true);
        setError(
          res.status === 404
            ? "We couldn't find that pincode — please check it."
            : "Lookup unavailable — please type your district and state."
        );
        // A saved address keeps what it had; a newly typed unknown pincode
        // must not keep the previous pincode's district.
        if (!opts.initial) onClear();
      }
    } catch {
      if (id !== seq.current) return;
      setLocalities([]);
      setManual(true);
      setError("Lookup unavailable — please type your district and state.");
    } finally {
      if (id === seq.current) setLoading(false);
    }
  };

  return { localities, loading, error, manual, lookup };
}

/**
 * Which area to keep once a pincode's localities are known: the only one if
 * there is just one, the current one if it's on the list, otherwise none —
 * an area picked for the previous pincode is not an area in this one.
 */
export function areaFor(current: string, localities: string[]): string {
  if (localities.length === 1) return localities[0];
  if (localities.length === 0 || localities.includes(current)) return current;
  return "";
}

export function AutoFillNote() {
  return (
    <p className="flex items-center gap-1.5 text-xs sm:text-sm text-neutral-600 dark:text-neutral-400">
      <Check className="w-4 h-4 text-green-500 shrink-0" strokeWidth={2.5} />
      District and state fill in automatically from your pincode.
    </p>
  );
}

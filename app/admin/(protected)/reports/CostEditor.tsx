"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Save, RotateCcw, Info } from "lucide-react";
import type { BusinessCosts } from "@/lib/db/economics";

/**
 * The cost figures every number on this page is built from.
 *
 * Typed in rupees because that is how the owner thinks about them; converted to
 * paise at the route. Nothing is validated here beyond the input type — the
 * server clamps, because a form is a suggestion and this one decides what the
 * forecasts say.
 *
 * Split into variable and fixed on screen, not just in the table, because the
 * distinction is the point of the whole report: the top group is what one more
 * book costs, the bottom group is what the month costs regardless.
 */

interface Field {
  key: keyof FormState;
  label: string;
  hint: string;
  suffix?: string;
}

interface FormState {
  printing: string;
  packaging: string;
  delivery: string;
  marketing: string;
  otherVariable: string;
  paymentFeePercent: string;
  salaryMonthly: string;
  techMonthly: string;
  otherFixedMonthly: string;
  rtoPercent: string;
  rtoCost: string;
  priceElasticity: string;
}

const PER_BOOK: Field[] = [
  { key: "printing", label: "Printing", hint: "Per copy from the press" },
  { key: "packaging", label: "Packaging", hint: "Envelope, filler, label" },
  { key: "delivery", label: "Delivery", hint: "Courier charge per parcel" },
  { key: "marketing", label: "Marketing (CAC)", hint: "Ad spend ÷ orders" },
  { key: "otherVariable", label: "Other per book", hint: "Anything else that scales" },
];

const MONTHLY: Field[] = [
  { key: "salaryMonthly", label: "Salaries", hint: "Everyone, per month" },
  { key: "techMonthly", label: "Tech & tools", hint: "Hosting, Supabase, ImageKit" },
  { key: "otherFixedMonthly", label: "Other fixed", hint: "Rent, accounting, subscriptions" },
];

const rupeesFromPaise = (p: number) => String(Math.round(p) / 100);

export default function CostEditor({ costs }: { costs: BusinessCosts }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const initial: FormState = {
    printing: rupeesFromPaise(costs.printingPaise),
    packaging: rupeesFromPaise(costs.packagingPaise),
    delivery: rupeesFromPaise(costs.deliveryPaise),
    marketing: rupeesFromPaise(costs.marketingPaise),
    otherVariable: rupeesFromPaise(costs.otherVariablePaise),
    paymentFeePercent: String(costs.paymentFeePercent),
    salaryMonthly: rupeesFromPaise(costs.salaryMonthlyPaise),
    techMonthly: rupeesFromPaise(costs.techMonthlyPaise),
    otherFixedMonthly: rupeesFromPaise(costs.otherFixedMonthlyPaise),
    rtoPercent: String(costs.rtoPercent),
    rtoCost: rupeesFromPaise(costs.rtoCostPaise),
    priceElasticity: String(costs.priceElasticity),
  };

  const [form, setForm] = useState<FormState>(initial);

  const set = (key: keyof FormState, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/admin/reports/costs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSaved(true);
      // Every figure below this form is server-computed, so the page has to be
      // re-rendered rather than patched in place.
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  const input = (f: Field, prefix: string) => (
    <label key={f.key} className="block">
      <span className="block text-xs font-semibold text-neutral-700">{f.label}</span>
      <span className="mt-1 flex items-center rounded-xl border border-neutral-300 bg-white focus-within:border-primary-500 transition-colors">
        <span className="pl-3 text-neutral-400 text-sm">{prefix}</span>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step="any"
          value={form[f.key]}
          onChange={(e) => set(f.key, e.target.value)}
          className="w-full bg-transparent px-2 py-2 text-sm font-semibold text-neutral-900 focus:outline-none"
        />
        {f.suffix && <span className="pr-3 text-neutral-400 text-sm">{f.suffix}</span>}
      </span>
      <span className="block text-[11px] text-neutral-400 mt-1">{f.hint}</span>
    </label>
  );

  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  return (
    <div className="bg-white border border-neutral-200 rounded-2xl shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-neutral-100">
        <h2 className="font-bold text-sm text-neutral-800">What a book costs</h2>
        <p className="text-xs text-neutral-500 mt-0.5">
          Every figure below the fold is calculated from these. Change one and
          the whole report moves.
        </p>
      </div>

      <div className="p-5 space-y-6">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-neutral-400 mb-3">
            Per book — scales with every copy
          </p>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            {PER_BOOK.map((f) => input(f, "₹"))}
            {input(
              {
                key: "paymentFeePercent",
                label: "Gateway fee",
                hint: "Razorpay 2% + GST = 2.36",
                suffix: "%",
              },
              ""
            )}
          </div>
        </div>

        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-neutral-400 mb-3">
            Per month — the same whether you sell 500 or 5,000
          </p>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            {MONTHLY.map((f) => input(f, "₹"))}
          </div>
          <p className="flex items-start gap-1.5 text-[11px] text-neutral-500 mt-3">
            <Info className="w-3.5 h-3.5 flex-shrink-0 mt-px text-neutral-400" />
            Enter salaries as a monthly total, not as a per-book share. Per book
            it is not a cost but a quotient — it falls as volume rises, and the
            report shows it doing so.
          </p>
        </div>

        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-neutral-400 mb-3">
            Assumptions
          </p>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            {input(
              {
                key: "rtoPercent",
                label: "Return rate",
                hint: "Parcels that come back. Prepaid ≈ 0; COD 20–35%",
                suffix: "%",
              },
              ""
            )}
            {input({
              key: "rtoCost",
              label: "Cost per return",
              hint: "Freight both ways plus repacking",
            }, "₹")}
            {input(
              {
                key: "priceElasticity",
                label: "Price sensitivity",
                hint: "% of buyers lost per 10% price rise",
                suffix: "%",
              },
              ""
            )}
          </div>
        </div>
      </div>

      <div className="px-5 py-3 border-t border-neutral-100 bg-neutral-50 flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving || !dirty}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary-500 text-white text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary-600 transition-colors"
        >
          <Save className="w-4 h-4" />
          {saving ? "Saving…" : "Save costs"}
        </button>
        {dirty && (
          <button
            onClick={() => {
              setForm(initial);
              setError("");
            }}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-500 hover:text-neutral-800"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Reset
          </button>
        )}
        {saved && !dirty && (
          <span className="text-xs font-semibold text-green-600">Saved</span>
        )}
        {error && <span className="text-xs font-semibold text-red-600">{error}</span>}
      </div>
    </div>
  );
}

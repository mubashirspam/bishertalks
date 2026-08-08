"use client";

import { useSearchParams } from "next/navigation";
import { useNavigation } from "@/components/admin/Revalidating";
import { X } from "lucide-react";
import { istToday, istDaysAgo } from "@/lib/format-date";

const PRESETS = [
  { label: "Today", days: 0 },
  { label: "7 days", days: 6 },
  { label: "30 days", days: 29 },
  { label: "90 days", days: 89 },
];

/** Same IST date semantics as the orders and delivery screens. */
export default function DateRange() {
  const params = useSearchParams();
  const { pending, navigate } = useNavigation();

  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";

  const push = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    navigate(`/admin/insights?${next}`);
  };

  const field =
    "bg-white border border-neutral-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-primary-500 transition-colors";

  return (
    <div className="bg-white border border-neutral-200 rounded-2xl p-4 shadow-sm mb-5 flex flex-wrap items-end gap-3">
      <div>
        <label className="text-xs font-medium text-neutral-500 mb-1.5 block">From</label>
        <input
          type="date"
          value={from}
          max={to || istToday()}
          onChange={(e) => push({ from: e.target.value || null })}
          className={`${field} cursor-pointer`}
        />
      </div>
      <div>
        <label className="text-xs font-medium text-neutral-500 mb-1.5 block">To</label>
        <input
          type="date"
          value={to}
          min={from || undefined}
          max={istToday()}
          onChange={(e) => push({ to: e.target.value || null })}
          className={`${field} cursor-pointer`}
        />
      </div>

      <div className="flex gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            onClick={() => push({ from: istDaysAgo(p.days), to: istToday() })}
            className="px-2.5 py-2 rounded-lg border border-neutral-200 text-xs text-neutral-600 hover:border-neutral-400 hover:text-neutral-900 transition-all"
          >
            {p.label}
          </button>
        ))}
      </div>

      <p className="text-xs text-neutral-500 ml-auto">
        {pending ? "Loading…" : from || to ? "Filtered" : "All time"}
      </p>

      {(from || to) && (
        <button
          onClick={() => push({ from: null, to: null })}
          className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-900 transition-colors"
        >
          <X className="w-3 h-3" /> Clear
        </button>
      )}
    </div>
  );
}

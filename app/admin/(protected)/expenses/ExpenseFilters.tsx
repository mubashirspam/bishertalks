"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { useNavigation } from "@/components/admin/Revalidating";
import { Search, X } from "lucide-react";
import { EXPENSE_KINDS, EXPENSE_KIND_LABELS } from "@/lib/db/expenses";

/**
 * The controls over the ledger.
 *
 * Filters live in the URL, not in component state, for the same reason they do
 * on the orders screen: a filtered view is a thing people send each other, and
 * "the September printing spend" should be a link.
 */

const PRESETS = [
  { label: "This month", months: 0 },
  { label: "Last 3 months", months: 3 },
  { label: "This year", months: -1 },
];

export default function ExpenseFilters({
  categories,
  vendors,
  funders,
  today,
  totalSlot,
}: {
  categories: { id: string; name: string }[];
  vendors: { id: string; name: string }[];
  funders: { id: string; name: string }[];
  /**
   * Today in IST, from the server.
   *
   * Not computed here: the browser may be in any timezone, and a date preset
   * that means "this month" has to mean the shop's month. Passing it also
   * keeps the clock out of render, where a value that changes between two
   * renders of the same component has no business being.
   */
  today: string;
  totalSlot?: React.ReactNode;
}) {
  const params = useSearchParams();
  const { navigate } = useNavigation();

  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const category = params.get("category") ?? "all";
  const vendor = params.get("vendor") ?? "all";
  const funder = params.get("funder") ?? "all";
  const kind = params.get("kind") ?? "all";
  const [q, setQ] = useState(params.get("q") ?? "");

  const push = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v && v !== "all") next.set(k, v);
      else next.delete(k);
    }
    navigate(`/admin/expenses?${next.toString()}`);
  };

  const preset = (months: number) => {
    if (months === -1) return push({ from: `${today.slice(0, 4)}-01-01`, to: today });
    if (months === 0) return push({ from: `${today.slice(0, 7)}-01`, to: today });
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - months);
    return push({ from: d.toISOString().slice(0, 10), to: today });
  };

  const field =
    "bg-white border border-neutral-300 rounded-xl px-3 py-2 text-sm " +
    "focus:outline-none focus:border-primary-500 transition-colors";
  const label = "text-xs font-medium text-neutral-500 mb-1.5 block";

  const active =
    !!from || !!to || category !== "all" || vendor !== "all" ||
    funder !== "all" || kind !== "all" || !!params.get("q");

  return (
    <div className="mb-5 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[150px]">
          <label className={label}>Kind</label>
          <select
            value={kind}
            onChange={(e) => push({ kind: e.target.value })}
            className={`${field} w-full cursor-pointer`}
          >
            <option value="all">All kinds</option>
            {EXPENSE_KINDS.map((k) => (
              <option key={k} value={k}>{EXPENSE_KIND_LABELS[k]}</option>
            ))}
          </select>
        </div>

        <div className="min-w-[160px]">
          <label className={label}>Category</label>
          <select
            value={category}
            onChange={(e) => push({ category: e.target.value })}
            className={`${field} w-full cursor-pointer`}
          >
            <option value="all">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        <div className="min-w-[150px]">
          <label className={label}>Paid by</label>
          <select
            value={funder}
            onChange={(e) => push({ funder: e.target.value })}
            className={`${field} w-full cursor-pointer`}
          >
            <option value="all">Anyone</option>
            {funders.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </div>

        <div className="min-w-[150px]">
          <label className={label}>Vendor</label>
          <select
            value={vendor}
            onChange={(e) => push({ vendor: e.target.value })}
            className={`${field} w-full cursor-pointer`}
          >
            <option value="all">Any vendor</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className={label}>From</label>
          <input
            type="date" value={from}
            onChange={(e) => push({ from: e.target.value })}
            className={field}
          />
        </div>
        <div>
          <label className={label}>To</label>
          <input
            type="date" value={to}
            onChange={(e) => push({ to: e.target.value })}
            className={field}
          />
        </div>

        <div className="flex gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => preset(p.months)}
              className="rounded-full border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-600 hover:border-neutral-300"
            >
              {p.label}
            </button>
          ))}
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); push({ q: q || null }); }}
          className="relative min-w-[180px] flex-1"
        >
          <label className={label}>Search</label>
          <Search className="pointer-events-none absolute bottom-2.5 left-3 h-4 w-4 text-neutral-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Description or bill number"
            className={`${field} w-full pl-9`}
          />
        </form>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-neutral-100 pt-3 text-xs text-neutral-500">
        {totalSlot}
        {active && (
          <button
            onClick={() => navigate("/admin/expenses")}
            className="ml-auto inline-flex items-center gap-1 text-neutral-500 hover:text-neutral-900"
          >
            <X className="h-3 w-3" /> Clear filters
          </button>
        )}
      </div>
    </div>
  );
}

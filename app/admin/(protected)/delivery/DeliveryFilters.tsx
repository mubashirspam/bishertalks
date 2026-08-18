
"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { useNavigation } from "@/components/admin/Revalidating";
import { Search, X } from "lucide-react";
import {
  DELIVERY_STAGES,
  DELIVERY_LABELS,
  type DeliveryStage,
} from "@/lib/delivery-stage";
import { istToday, istDaysAgo } from "@/lib/format-date";
import type { StageCounts } from "@/lib/db/delivery-query";
import type { DeliveryAgent } from "@/lib/db/staff";

const PRESETS = [
  { label: "Today", days: 0 },
  { label: "7 days", days: 6 },
  { label: "30 days", days: 29 },
];

const TABS: { value: string; label: string }[] = [
  { value: "all", label: "All" },
  ...DELIVERY_STAGES.map((s: DeliveryStage) => ({
    value: s,
    label: DELIVERY_LABELS[s],
  })),
];

/**
 * Queue tabs plus date/search narrowing.
 *
 * Purely navigational — every filter is a URL parameter, so a view can be
 * bookmarked, shared, or reloaded after a bulk action without losing place.
 * The actions themselves live in DeliveryTable.
 */
export default function DeliveryFilters({
  counts,
  agents,
  couriers,
}: {
  counts: StageCounts;
  agents: DeliveryAgent[];
  /** Every courier, including switched-off ones — old parcels still name them. */
  couriers: { id: string; name: string }[];
}) {
  const params = useSearchParams();
  // Shared with the table, so it dims rather than blanking while reloading.
  const { pending, navigate } = useNavigation();

  const stage = params.get("stage") ?? "all";
  const agent = params.get("agent") ?? "";
  const courier = params.get("courier") ?? "";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  // Must match the default in parseDeliveryFilters (lib/db/delivery-query.ts).
  // It's mirrored rather than imported because that module pulls in the
  // service-role Supabase client, which has no business in the browser — but
  // the two disagreeing is exactly what once made this dropdown lie.
  const sort = params.get("sort") ?? "newest";
  const [q, setQ] = useState(params.get("q") ?? "");

  const push = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete("page"); // any filter change invalidates the current page
    navigate(`/admin/delivery?${next}`);
  };

  const hasFilters = !!from || !!to || !!params.get("q") || !!agent || !!courier;

  const field =
    "bg-white border border-neutral-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-primary-500 transition-colors";

  return (
    <div className="mb-5">
      {/* Queue tabs — the work, left to right */}
      <div className="flex gap-1.5 overflow-x-auto pb-2 mb-3">
        {TABS.map((t) => {
          const active = stage === t.value;
          const n = counts[t.value] ?? 0;
          return (
            <button
              key={t.value}
              onClick={() => push({ stage: t.value === "all" ? null : t.value })}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium whitespace-nowrap border transition-all ${
                active
                  ? "bg-neutral-900 text-white border-neutral-900"
                  : "bg-white text-neutral-600 border-neutral-200 hover:border-neutral-400"
              }`}
            >
              {t.label}
              <span
                className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                  active
                    ? "bg-white/20"
                    : t.value === "to_print" && n > 0
                      ? "bg-orange-100 text-orange-700"
                      : "bg-neutral-100 text-neutral-500"
                }`}
              >
                {n}
              </span>
            </button>
          );
        })}
      </div>

      <div className="bg-white border border-neutral-200 rounded-2xl p-4 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-xs font-medium text-neutral-500 mb-1.5 block">
              Ordered from
            </label>
            <input
              type="date"
              value={from}
              max={to || istToday()}
              onChange={(e) => push({ from: e.target.value || null })}
              className={`${field} cursor-pointer`}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-neutral-500 mb-1.5 block">
              To
            </label>
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

          {/* Whose parcels. "Nobody" is the useful one — it's the pile of work
              that hasn't been handed out yet. */}
          <div>
            <label className="text-xs font-medium text-neutral-500 mb-1.5 block">
              Agent
            </label>
            <select
              value={agent}
              onChange={(e) => push({ agent: e.target.value || null })}
              className={`${field} cursor-pointer`}
            >
              <option value="">Everyone</option>
              <option value="none">Nobody — unassigned</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>

          {/* Which courier carries them. "Nobody" is the useful one again —
              parcels that have been handed to an agent but not yet routed. */}
          {couriers.length > 0 && (
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1.5 block">
                Courier
              </label>
              <select
                value={courier}
                onChange={(e) => push({ courier: e.target.value || null })}
                className={`${field} cursor-pointer`}
              >
                <option value="">Any courier</option>
                <option value="none">Nobody — not routed yet</option>
                {couriers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-neutral-500 mb-1.5 block">
              Order
            </label>
            <select
              value={sort}
              onChange={(e) =>
                push({ sort: e.target.value === "newest" ? null : e.target.value })
              }
              className={`${field} cursor-pointer`}
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              push({ q: q || null });
            }}
            className="flex-1 min-w-[200px]"
          >
            <label className="text-xs font-medium text-neutral-500 mb-1.5 block">
              Search
            </label>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Name, phone, order #, pincode, tracking…"
                className={`${field} w-full pl-8`}
              />
            </div>
          </form>
        </div>

        {(hasFilters || pending) && (
          <div className="flex items-center gap-3 mt-3 pt-3 border-t border-neutral-100">
            <p className="text-xs text-neutral-500">
              {pending ? "Loading…" : "Filtered"}
            </p>
            {hasFilters && (
              <button
                onClick={() => {
                  setQ("");
                  push({ from: null, to: null, q: null, agent: null, courier: null });
                }}
                className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-900 transition-colors"
              >
                <X className="w-3 h-3" /> Clear
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

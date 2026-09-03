"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Search, X, Clock } from "lucide-react";
import { useNavigation } from "@/components/admin/Revalidating";
import { istToday } from "@/lib/format-date";
import {
  DELIVERY_STAGES,
  DELIVERY_SHORT,
  type DeliveryStage,
} from "@/lib/delivery-stage";
import {
  HANDOVER_CHIPS,
  HANDOVER_LABELS,
  HANDOVER_HINTS,
} from "@/lib/delivery/handover";
import {
  DATE_MODES,
  DATE_MODE_LABELS,
  DATE_MODE_HINTS,
  LATE_BASES,
  LATE_BASIS_LABELS,
  LATE_CHIPS,
  DEFAULT_LATE_DAYS,
  datePresets,
  reportPresets,
  hasNarrowing,
  type ReportFilters,
} from "@/lib/report-filters";

/**
 * Everything the reports screen can be asked.
 *
 * Purely navigational — every control writes a URL parameter and nothing else,
 * so a view can be bookmarked, shared with whoever asked the question, or
 * reloaded without losing its place. It also means the download button needs
 * to know nothing about any of this: it forwards the query string, and the
 * spreadsheet is by construction what was on screen.
 *
 * Laid out in the order the question is actually asked. Which parcels (the
 * saved views), then over what period (date axis and range), then whose
 * (courier and agent), then in what condition (stage, state, late), then the
 * search box for one specific parcel.
 */

const BOOK_COUNTS = [
  { label: "Any copies", value: "" },
  { label: "2 or more books", value: "multi" },
  { label: "Single copy", value: "single" },
];

const GIFT_CHOICES = [
  { label: "Gift or not", value: "" },
  { label: "Gift wrapped", value: "yes" },
  { label: "Signed copies", value: "signed" },
  { label: "Not a gift", value: "no" },
];

export default function ReportFilterBar({
  filters,
  couriers,
  agents,
}: {
  filters: ReportFilters;
  /** Every courier, switched-off ones included — old parcels still name them. */
  couriers: { id: string; name: string; active: boolean }[];
  agents: { id: string; name: string }[];
}) {
  const params = useSearchParams();
  const { pending, navigate } = useNavigation();

  const [q, setQ] = useState(filters.q ?? "");
  // Typing a threshold must not fire a navigation per keystroke, so the box
  // holds its own value and commits on blur or Enter. The chips beside it are
  // the fast path and navigate immediately.
  const [lateDraft, setLateDraft] = useState(String(filters.late));

  const push = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    // Any change invalidates the page you were on.
    next.delete("page");
    const qs = next.toString();
    navigate(qs ? `/admin/analytics?${qs}` : "/admin/analytics");
  };

  /** Stage chips are multi-select — "in transit" is two of them at once. */
  const toggleStage = (s: DeliveryStage) => {
    const on = filters.stages.includes(s);
    const next = on
      ? filters.stages.filter((x) => x !== s)
      : [...filters.stages, s];
    push({ stage: next.length ? next.join(",") : null });
  };

  const commitLate = () => {
    const n = Number.parseInt(lateDraft, 10);
    const value = Number.isFinite(n) && n >= 0 ? n : DEFAULT_LATE_DAYS;
    setLateDraft(String(value));
    push({ late: value === DEFAULT_LATE_DAYS ? null : String(value) });
  };

  const clearAll = () => {
    setQ("");
    setLateDraft(String(DEFAULT_LATE_DAYS));
    navigate("/admin/analytics");
  };

  const field =
    "bg-white border border-neutral-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-primary-500 transition-colors";
  const label = "text-xs font-medium text-neutral-500 mb-1.5 block";

  const presets = datePresets();
  const saved = reportPresets();
  const activeRange = (p: { from: string; to: string }) =>
    filters.from === p.from && filters.to === p.to;

  return (
    <div className="mb-5 space-y-3">
      {/* ── The six questions worth one click ───────────────────────────── */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {saved.map((p) => (
          <button
            key={p.key}
            title={p.hint}
            onClick={() => {
              setQ("");
              setLateDraft(p.params.late ?? String(DEFAULT_LATE_DAYS));
              navigate(`/admin/analytics?${new URLSearchParams(p.params)}`);
            }}
            className="px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap border border-neutral-200 bg-white text-neutral-600 hover:border-neutral-400 hover:text-neutral-900 transition-all"
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="bg-white border border-neutral-200 rounded-2xl p-4 shadow-sm space-y-4">
        {/* ── When ──────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-end gap-3">
          {/* The control that makes "assigned on 24 August" a two-click
              question: pick the axis, then set both dates to the 24th. */}
          <div>
            <label className={label}>Count by</label>
            <select
              value={filters.by}
              onChange={(e) =>
                push({ by: e.target.value === "ordered" ? null : e.target.value })
              }
              title={DATE_MODE_HINTS[filters.by]}
              className={`${field} cursor-pointer font-medium`}
            >
              {DATE_MODES.map((m) => (
                <option key={m} value={m} title={DATE_MODE_HINTS[m]}>
                  {DATE_MODE_LABELS[m]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={label}>From</label>
            <input
              type="date"
              value={filters.from ?? ""}
              max={filters.to || istToday()}
              onChange={(e) => push({ from: e.target.value || null })}
              className={`${field} cursor-pointer`}
            />
          </div>
          <div>
            <label className={label}>To</label>
            <input
              type="date"
              value={filters.to ?? ""}
              min={filters.from || undefined}
              onChange={(e) => push({ to: e.target.value || null })}
              className={`${field} cursor-pointer`}
            />
          </div>

          <div className="flex flex-wrap gap-1.5">
            {presets.map((p) => (
              <button
                key={p.label}
                onClick={() => push({ from: p.from, to: p.to })}
                className={`px-2.5 py-2 rounded-lg border text-xs transition-all ${
                  activeRange(p)
                    ? "border-neutral-900 bg-neutral-900 text-white"
                    : "border-neutral-200 text-neutral-600 hover:border-neutral-400 hover:text-neutral-900"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Said out loud, because a date axis that is not the order date
            silently drops parcels — and silently is the problem. */}
        {filters.by !== "ordered" && (
          <p className="text-xs text-neutral-500 -mt-1">
            {DATE_MODE_HINTS[filters.by]}
          </p>
        )}

        {/* ── Whose, and in what condition ──────────────────────────────── */}
        <div className="flex flex-wrap items-end gap-3 pt-3 border-t border-neutral-100">
          <div>
            <label className={label}>Courier</label>
            <select
              value={filters.courier ?? ""}
              onChange={(e) => push({ courier: e.target.value || null })}
              className={`${field} cursor-pointer`}
            >
              <option value="">Any courier</option>
              <option value="none">Nobody — not routed yet</option>
              {couriers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.active ? "" : " (off)"}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={label}>Agent</label>
            <select
              value={filters.agent ?? ""}
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

          <div>
            <label className={label}>State</label>
            <select
              value={filters.handover ?? ""}
              onChange={(e) => push({ handover: e.target.value || null })}
              className={`${field} cursor-pointer`}
            >
              <option value="">Any state</option>
              {HANDOVER_CHIPS.map((h) => (
                <option key={h} value={h} title={HANDOVER_HINTS[h]}>
                  {HANDOVER_LABELS[h]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={label}>Copies</label>
            <select
              value={filters.books ?? ""}
              onChange={(e) => push({ books: e.target.value || null })}
              className={`${field} cursor-pointer`}
            >
              {BOOK_COUNTS.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={label}>Gift</label>
            <select
              // One dropdown, two parameters: "signed" is a narrower case of a
              // gift, not a third independent thing.
              value={filters.signed === "yes" ? "signed" : (filters.gift ?? "")}
              onChange={(e) => {
                const v = e.target.value;
                push({
                  gift: v === "yes" || v === "no" ? v : null,
                  signed: v === "signed" ? "yes" : null,
                });
              }}
              className={`${field} cursor-pointer`}
            >
              {GIFT_CHOICES.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={label}>Order</label>
            <select
              value={filters.sort}
              onChange={(e) =>
                push({ sort: e.target.value === "newest" ? null : e.target.value })
              }
              className={`${field} cursor-pointer`}
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="age">Longest waiting</option>
            </select>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              push({ q: q || null });
            }}
            className="flex-1 min-w-[220px]"
          >
            <label className={label}>Search</label>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Name, phone, order #, pincode, waybill, reference…"
                className={`${field} w-full pl-8`}
              />
            </div>
          </form>
        </div>

        {/* ── Where it is ───────────────────────────────────────────────── */}
        <div className="pt-3 border-t border-neutral-100">
          <label className={label}>Where it is</label>
          <div className="flex flex-wrap gap-1.5">
            {DELIVERY_STAGES.map((s) => {
              const on = filters.stages.includes(s);
              return (
                <button
                  key={s}
                  onClick={() => toggleStage(s)}
                  className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                    on
                      ? "border-neutral-900 bg-neutral-900 text-white"
                      : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-400"
                  }`}
                >
                  {DELIVERY_SHORT[s]}
                </button>
              );
            })}
            {filters.stages.length > 0 && (
              <button
                onClick={() => push({ stage: null })}
                className="px-2 py-1.5 text-xs text-neutral-500 hover:text-neutral-900 transition-colors"
              >
                any
              </button>
            )}
          </div>
        </div>

        {/* ── Late ─────────────────────────────────────────────────────────
            The threshold is the reader's, not the code's. Ten days from the
            order is the default because that is what this shop asks about,
            and the basis dropdown is what makes the same control answer three
            different questions: the customer's, the courier's, and the road's. */}
        <div className="pt-3 border-t border-neutral-100 flex flex-wrap items-center gap-2.5">
          <span className="flex items-center gap-1.5 text-xs font-medium text-neutral-500">
            <Clock className="w-3.5 h-3.5" /> Late after
          </span>

          <input
            type="number"
            min={0}
            max={999}
            value={lateDraft}
            onChange={(e) => setLateDraft(e.target.value)}
            onBlur={commitLate}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitLate();
              }
            }}
            className={`${field} w-20 text-center`}
          />
          <span className="text-xs text-neutral-500">days since</span>

          <select
            value={filters.lateFrom}
            onChange={(e) =>
              push({
                late_from: e.target.value === "ordered" ? null : e.target.value,
              })
            }
            className={`${field} cursor-pointer`}
          >
            {LATE_BASES.map((b) => (
              <option key={b} value={b}>
                {LATE_BASIS_LABELS[b]}
              </option>
            ))}
          </select>

          <div className="flex gap-1.5">
            {LATE_CHIPS.map((d) => (
              <button
                key={d}
                onClick={() => {
                  setLateDraft(String(d));
                  push({ late: d === DEFAULT_LATE_DAYS ? null : String(d) });
                }}
                className={`px-2.5 py-1.5 rounded-lg border text-xs transition-all ${
                  filters.late === d
                    ? "border-amber-500 bg-amber-50 text-amber-800 font-semibold"
                    : "border-neutral-200 text-neutral-600 hover:border-neutral-400"
                }`}
              >
                {d}d
              </button>
            ))}
          </div>

          <button
            onClick={() => push({ only_late: filters.onlyLate ? null : "1" })}
            className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
              filters.onlyLate
                ? "border-rose-600 bg-rose-600 text-white"
                : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-400"
            }`}
          >
            {filters.onlyLate ? "Showing late only" : "Show late only"}
          </button>

          {filters.late === 0 && (
            <span className="text-xs text-neutral-400">
              Zero switches lateness off.
            </span>
          )}
        </div>

        {/* ── What is currently narrowing the view ──────────────────────── */}
        {(hasNarrowing(filters) || pending) && (
          <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-neutral-100">
            <p className="text-xs text-neutral-500">
              {pending ? "Loading…" : "Filtered"}
            </p>

            {(filters.ageMin !== undefined || filters.ageMax !== undefined) && (
              <button
                onClick={() => push({ age_min: null, age_max: null })}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-neutral-100 text-neutral-700 hover:bg-neutral-200 transition-colors"
              >
                Waiting{" "}
                {filters.ageMax === undefined
                  ? `${filters.ageMin}+ days`
                  : `${filters.ageMin ?? 0}–${filters.ageMax} days`}
                <X className="w-3 h-3" />
              </button>
            )}

            {filters.state && (
              <button
                onClick={() => push({ state: null })}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-neutral-100 text-neutral-700 hover:bg-neutral-200 transition-colors"
              >
                {filters.state}
                <X className="w-3 h-3" />
              </button>
            )}

            <button
              onClick={clearAll}
              className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-900 transition-colors"
            >
              <X className="w-3 h-3" /> Clear everything
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

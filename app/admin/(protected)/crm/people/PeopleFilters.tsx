"use client";

import { useSearchParams } from "next/navigation";
import { CalendarDays, MapPin, Search, X } from "lucide-react";
import { useNavigation } from "@/components/admin/Revalidating";
// Labels only — lib/crm/people reads every order in the database.
import {
  PERSON_STAGES,
  PERSON_STAGE_LABELS,
  PERSON_STAGE_HINTS,
  PRIORITIES,
  PRIORITY_LABELS,
  PRIORITY_HINTS,
  PRIORITY_TONE,
  type PersonStage,
  type Priority,
} from "@/lib/crm/people-labels";

/**
 * The filter bar for the people list.
 *
 * Every chip carries its own count, and the count is what you would get by
 * clicking it — each facet is counted with the other filters applied but not
 * itself. A chip that says "421" and then shows 38 rows is a chip nobody
 * trusts again.
 */

const STAGE_TONE: Record<PersonStage, string> = {
  not_started: "border-neutral-500 bg-neutral-100 text-neutral-800",
  payment_started: "border-blue-500 bg-blue-50 text-blue-700",
  failed: "border-rose-500 bg-rose-50 text-rose-700",
  customer: "border-green-600 bg-green-50 text-green-700",
};

export default function PeopleFilters({
  stageCounts,
  priorityCounts,
  messagedCounts,
  districts,
  total,
  totalPeople,
  actionSlot,
}: {
  stageCounts: Record<PersonStage, number>;
  priorityCounts: Record<Priority, number>;
  messagedCounts: { yes: number; no: number };
  districts: string[];
  total: number;
  totalPeople: number;
  /** The campaign button, top right. */
  actionSlot?: React.ReactNode;
}) {
  const params = useSearchParams();
  const { navigate } = useNavigation();

  const stage = params.get("stage") ?? "";
  const priority = params.get("priority") ?? "";
  const messaged = params.get("messaged") ?? "";
  const district = params.get("district") ?? "";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const q = params.get("q") ?? "";
  const replied = params.get("replied") === "1";
  const withStopped = params.get("stopped") === "1";

  const push = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    // Any filter change invalidates which page you were on.
    next.delete("page");
    navigate(`/admin/crm/people?${next.toString()}`);
  };

  const chip = (active: boolean, activeClass: string) =>
    `px-3 py-1.5 rounded-lg border text-xs transition-all ${
      active
        ? `${activeClass} font-semibold`
        : "border-neutral-200 text-neutral-600 hover:border-neutral-400 hover:text-neutral-900"
    }`;

  const count = (n: number) => <span className="tabular-nums opacity-70"> {n}</span>;

  const anyFilter =
    stage || priority || messaged || district || from || to || q || replied || withStopped;

  return (
    <div className="bg-white border border-neutral-200 rounded-2xl p-3.5 shadow-sm mb-4">
      {/* ── Stage. The main axis: one person is in exactly one of these ─── */}
      <div className="flex flex-wrap items-center gap-2 pb-3 mb-3 border-b border-neutral-100">
        <span className="text-xs font-medium text-neutral-500">Stage</span>
        <button
          onClick={() => push({ stage: null })}
          className={chip(!stage, "border-neutral-900 bg-neutral-900 text-white")}
        >
          Everyone{count(totalPeople)}
        </button>
        {PERSON_STAGES.map((s) => (
          <button
            key={s}
            title={PERSON_STAGE_HINTS[s]}
            onClick={() => push({ stage: stage === s ? null : s })}
            className={chip(stage === s, STAGE_TONE[s])}
          >
            {PERSON_STAGE_LABELS[s]}
            {count(stageCounts[s])}
          </button>
        ))}

        {actionSlot && <span className="ml-auto">{actionSlot}</span>}
      </div>

      {/* ── Priority ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 pb-3 mb-3 border-b border-neutral-100">
        <span className="text-xs font-medium text-neutral-500">Priority</span>
        <button
          onClick={() => push({ priority: null })}
          className={chip(!priority, "border-neutral-900 bg-neutral-900 text-white")}
        >
          Any
        </button>
        {PRIORITIES.map((p) => (
          <button
            key={p}
            title={PRIORITY_HINTS[p]}
            onClick={() => push({ priority: priority === p ? null : p })}
            className={chip(priority === p, PRIORITY_TONE[p])}
          >
            {PRIORITY_LABELS[p]}
            {count(priorityCounts[p])}
          </button>
        ))}
      </div>

      {/* ── Have we spoken to them ───────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 pb-3 mb-3 border-b border-neutral-100">
        <span className="text-xs font-medium text-neutral-500">Messages</span>
        <button
          onClick={() => push({ messaged: null })}
          className={chip(!messaged, "border-neutral-900 bg-neutral-900 text-white")}
        >
          Any
        </button>
        <button
          title="Nobody has sent them anything yet — where a first campaign should start"
          onClick={() => push({ messaged: messaged === "no" ? null : "no" })}
          className={chip(messaged === "no", "border-primary-500 bg-primary-50 text-primary-700")}
        >
          Never messaged{count(messagedCounts.no)}
        </button>
        <button
          title="A message has reached them at least once"
          onClick={() => push({ messaged: messaged === "yes" ? null : "yes" })}
          className={chip(messaged === "yes", "border-violet-500 bg-violet-50 text-violet-700")}
        >
          Messaged{count(messagedCounts.yes)}
        </button>

        <span className="w-px h-5 bg-neutral-200 mx-1" />

        <button
          title="Only people who have written back to us"
          onClick={() => push({ replied: replied ? null : "1" })}
          className={chip(replied, "border-emerald-500 bg-emerald-50 text-emerald-700")}
        >
          Has replied
        </button>
        <button
          title="Show the people who asked us to stop. They can never be messaged."
          onClick={() => push({ stopped: withStopped ? null : "1" })}
          className={chip(withStopped, "border-red-500 bg-red-50 text-red-700")}
        >
          Include opted out
        </button>
      </div>

      {/* ── The narrow cuts ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="relative">
          <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            defaultValue={q}
            onKeyDown={(e) => {
              if (e.key === "Enter") push({ q: e.currentTarget.value.trim() || null });
            }}
            onBlur={(e) => {
              if (e.currentTarget.value.trim() !== q) {
                push({ q: e.currentTarget.value.trim() || null });
              }
            }}
            placeholder="Name or mobile"
            className="bg-white border border-neutral-300 rounded-lg pl-8 pr-2.5 py-1.5 text-xs w-48 focus:outline-none focus:border-primary-500 transition-colors"
          />
        </span>

        <MapPin className="w-3.5 h-3.5 text-neutral-400 ml-1" />
        <select
          value={district}
          onChange={(e) => push({ district: e.target.value || null })}
          className="bg-white border border-neutral-300 rounded-lg px-2.5 py-1.5 text-xs cursor-pointer focus:outline-none focus:border-primary-500 transition-colors"
        >
          <option value="">Everywhere</option>
          {districts.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>

        {/* On their LAST order, not their first — "who went quiet in August"
            is the question, and a first-order date cannot answer it. */}
        <CalendarDays className="w-3.5 h-3.5 text-neutral-400 ml-1" />
        <input
          type="date"
          value={from.slice(0, 10)}
          onChange={(e) => push({ from: e.target.value || null })}
          title="Their most recent order on or after this day"
          className="bg-white border border-neutral-300 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-primary-500 transition-colors"
        />
        <span className="text-xs text-neutral-400">to</span>
        <input
          type="date"
          value={to.slice(0, 10)}
          onChange={(e) => push({ to: e.target.value || null })}
          title="Their most recent order before this day"
          className="bg-white border border-neutral-300 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-primary-500 transition-colors"
        />

        <p className="text-xs text-neutral-500 ml-auto whitespace-nowrap tabular-nums">
          {total.toLocaleString("en-IN")} {total === 1 ? "person" : "people"}
        </p>

        {anyFilter && (
          <button
            onClick={() => navigate("/admin/crm/people")}
            className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-900 transition-colors"
          >
            <X className="w-3 h-3" /> Clear
          </button>
        )}
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { Search, X, Clock, SlidersHorizontal, ChevronDown, Layers } from "lucide-react";
import { useNavigation } from "@/components/admin/Revalidating";
import { formatISTShort } from "@/lib/format-date";
import {
  CALL_STATUSES,
  CALL_STATUS_LABELS,
  CALL_FLAGS,
  CALL_FLAG_LABELS,
  CALL_FLAG_BADGE,
  callsHref,
  hasCallNarrowing,
  type CallFilters,
} from "@/lib/calls";
import type { CallBatch, CallCounts } from "@/lib/db/calls";

/**
 * The portal's filters. Every control writes the URL and nothing else, so a
 * view survives a reload and a manager can send someone "your call-backs due"
 * as a link.
 *
 * The batch picker leads, because a list is worked one assignment at a time.
 * Search and the chip rows stay on screen; the rarer selects fold away behind
 * "Filters", so on a phone the first call card isn't pushed below the fold.
 */
export default function CallFilterBar({
  filters,
  counts,
  batches,
  staff,
  canManage,
}: {
  filters: CallFilters;
  counts: CallCounts;
  batches: CallBatch[];
  staff: { id: string; name: string; email: string }[];
  canManage: boolean;
}) {
  const { pending, navigate } = useNavigation();
  const [q, setQ] = useState(filters.q ?? "");
  const [remark, setRemark] = useState(filters.remark ?? "");

  // How many of the folded-away filters are doing something — shown on the
  // toggle, and the reason it starts open: a hidden filter that is narrowing
  // the list is how someone ends up thinking their calls have vanished.
  const advancedActive = [
    filters.view !== "open",
    canManage && !!filters.assignee,
    !!filters.delivery,
    !!filters.remark,
  ].filter(Boolean).length;
  const [expanded, setExpanded] = useState(advancedActive > 0);

  const push = (changes: Record<string, string | null>) => navigate(callsHref(filters, changes));

  const staffName = new Map(staff.map((s) => [s.email, s.name]));
  const batchText = (b: CallBatch) =>
    [
      `${b.label || "Calling list"} — ${formatISTShort(b.key)}`,
      `${b.open} of ${b.total} open`,
      canManage ? (staffName.get(b.assigned_to_email ?? "") ?? b.assigned_to_email ?? "Unassigned") : null,
    ]
      .filter(Boolean)
      .join(" · ");
  const selectedBatch = batches.find((b) => b.key === filters.batch);

  const chip = (on: boolean) =>
    `px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap border transition-all ${
      on
        ? "border-neutral-900 bg-neutral-900 text-white"
        : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-400 hover:text-neutral-900"
    }`;
  const field =
    "bg-white border border-neutral-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-primary-500 transition-colors";
  const label = "text-xs font-medium text-neutral-500 mb-1.5 block";

  return (
    <div className="mb-5 space-y-3">
      {/* Batch — one "Assign calls" click, with when it was assigned */}
      <div className="bg-white border border-neutral-200 rounded-2xl p-3 shadow-sm">
        <label className="text-xs font-medium text-neutral-500 mb-1.5 flex items-center gap-1.5">
          <Layers className="w-3.5 h-3.5" /> Batch
        </label>
        <select
          value={filters.batch ?? ""}
          onChange={(e) => push({ batch: e.target.value || null })}
          className={`${field} w-full cursor-pointer font-medium`}
        >
          <option value="">All batches ({batches.length})</option>
          {/* A batch from a shared link that no longer lists stays selectable. */}
          {filters.batch && !selectedBatch && (
            <option value={filters.batch}>Batch of {formatISTShort(filters.batch)}</option>
          )}
          {batches.map((b) => (
            <option key={b.key} value={b.key}>
              {batchText(b)}
            </option>
          ))}
        </select>
        {selectedBatch && (
          <p className="text-[11px] text-neutral-500 mt-1.5">
            Assigned {formatISTShort(selectedBatch.key)} · {selectedBatch.total} customer
            {selectedBatch.total === 1 ? "" : "s"}, {selectedBatch.total - selectedBatch.open} done
          </p>
        )}
      </div>

      {/* Call status */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        <button onClick={() => push({ status: null })} className={chip(!filters.status)}>
          All <span className="opacity-60">{counts.total}</span>
        </button>
        {CALL_STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => push({ status: filters.status === s ? null : s })}
            className={chip(filters.status === s)}
          >
            {CALL_STATUS_LABELS[s]} <span className="opacity-60">{counts.byStatus[s]}</span>
          </button>
        ))}
      </div>

      {/* Flags */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        <button
          onClick={() => push({ due: filters.due ? null : "1" })}
          className={`px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap border transition-all flex items-center gap-1 ${
            filters.due
              ? "border-rose-600 bg-rose-600 text-white"
              : "border-rose-200 bg-white text-rose-700 hover:border-rose-400"
          }`}
        >
          <Clock className="w-3.5 h-3.5" /> Call back due <span className="opacity-70">{counts.due}</span>
        </button>
        {CALL_FLAGS.map((f) => {
          const on = filters.flag === f;
          return (
            <button
              key={f}
              onClick={() => push({ flag: on ? null : f })}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap border transition-all ${
                on ? CALL_FLAG_BADGE[f] : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-400"
              }`}
            >
              {CALL_FLAG_LABELS[f]} <span className="opacity-60">{counts.byFlag[f]}</span>
            </button>
          );
        })}
      </div>

      <div className="bg-white border border-neutral-200 rounded-2xl p-3 shadow-sm">
        {/* Always visible: search, and the toggle for everything else. */}
        <div className="flex items-center gap-2">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              push({ q: q.trim() || null });
            }}
            className="flex-1 min-w-0"
          >
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search name, mobile, order #"
                className={`${field} w-full pl-8`}
              />
            </div>
          </form>

          <button
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-sm font-medium whitespace-nowrap transition-colors ${
              expanded || advancedActive
                ? "border-neutral-900 text-neutral-900"
                : "border-neutral-300 text-neutral-600 hover:border-neutral-500"
            }`}
          >
            <SlidersHorizontal className="w-4 h-4" />
            Filters
            {advancedActive > 0 && (
              <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-neutral-900 text-white text-[10px] font-bold">
                {advancedActive}
              </span>
            )}
            <ChevronDown className={`w-4 h-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
          </button>

          {(hasCallNarrowing(filters) || q) && (
            <button
              onClick={() => {
                setQ("");
                setRemark("");
                navigate("/admin/calls");
              }}
              title="Clear every filter"
              className="flex items-center gap-1 px-2 py-2 text-xs text-neutral-500 hover:text-neutral-900 whitespace-nowrap"
            >
              <X className="w-3.5 h-3.5" /> Clear
            </button>
          )}
        </div>

        {expanded && (
          <div className="flex flex-wrap items-end gap-3 pt-3 mt-3 border-t border-neutral-100">
            <div>
              <label className={label}>Show</label>
              <select
                value={filters.view}
                onChange={(e) => push({ view: e.target.value === "open" ? null : e.target.value })}
                className={`${field} cursor-pointer`}
              >
                <option value="open">To do</option>
                <option value="done">Done</option>
                <option value="all">Everything</option>
              </select>
            </div>

            {canManage && (
              <div>
                <label className={label}>Assigned to</label>
                <select
                  value={filters.assignee ?? ""}
                  // A batch belongs to one person; switching person drops it.
                  onChange={(e) => push({ assignee: e.target.value || null, batch: null })}
                  className={`${field} cursor-pointer`}
                >
                  <option value="">Everyone</option>
                  <option value="none">Nobody</option>
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className={label}>Parcel</label>
              <select
                value={filters.delivery ?? ""}
                onChange={(e) => push({ delivery: e.target.value || null })}
                className={`${field} cursor-pointer`}
              >
                <option value="">Any</option>
                <option value="undelivered">Not delivered yet</option>
                <option value="delivered">Delivered</option>
                <option value="returned">Returned</option>
              </select>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                push({ remark: remark.trim() || null });
              }}
              className="min-w-[200px] flex-1"
            >
              <label className={label}>Courier remark</label>
              <input
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                onBlur={() =>
                  remark.trim() !== (filters.remark ?? "") && push({ remark: remark.trim() || null })
                }
                placeholder="e.g. Consignee Unavailable"
                className={`${field} w-full`}
              />
            </form>
          </div>
        )}

        {pending && <p className="text-xs text-neutral-500 pt-2">Loading…</p>}
      </div>
    </div>
  );
}

"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Search, X } from "lucide-react";
import { useNavigation } from "@/components/admin/Revalidating";
import {
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  TASK_CATEGORIES,
  TASK_CATEGORY_LABELS,
} from "@/lib/tasks";
import type { TaskCounts } from "@/lib/db/tasks";
import type { Staff } from "@/lib/db/staff";

const TABS: { value: string; label: string }[] = [
  { value: "all", label: "All" },
  ...TASK_STATUSES.map((s) => ({ value: s, label: TASK_STATUS_LABELS[s] })),
  { value: "urgent", label: "Urgent" },
];

/**
 * Queue tabs plus a filter card, same shape as the delivery screen's
 * (DeliveryFilters.tsx) — every filter is a URL parameter, so a view can be
 * bookmarked or reloaded without losing place. The Urgent tab is its own
 * dimension (priority, not status): a task can be Open and Urgent at once, so
 * clicking it clears the status filter rather than competing with it.
 */
export default function TasksFilters({
  counts,
  staff,
  canManage,
}: {
  counts: TaskCounts;
  staff: Staff[];
  /** Full access (tasks.manage) — false hides the Assignee filter, which is
   *  always locked to "me" for a tasks.view-only login and has nothing to
   *  offer it. */
  canManage: boolean;
}) {
  const params = useSearchParams();
  const { pending, navigate } = useNavigation();

  const status = params.get("status") ?? "all";
  const priority = params.get("priority") ?? "";
  const category = params.get("category") ?? "all";
  const assignee = params.get("assignee") ?? "";
  const [q, setQ] = useState(params.get("q") ?? "");

  const activeTab = priority === "urgent" ? "urgent" : status;

  const push = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete("page");
    navigate(`/admin/tasks?${next}`);
  };

  const countFor = (value: string): number => {
    if (value === "urgent") return counts.urgent;
    if (value === "all") return counts.open + counts.in_progress + counts.waiting + counts.solved;
    return counts[value as keyof TaskCounts] ?? 0;
  };

  const hasFilters =
    !!params.get("q") || (!!category && category !== "all") || (canManage && !!assignee);

  const field =
    "bg-white border border-neutral-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-primary-500 transition-colors";

  return (
    <div className="mb-5">
      <div className="flex gap-1.5 overflow-x-auto pb-2 mb-3">
        {TABS.map((t) => {
          const active = activeTab === t.value;
          const n = countFor(t.value);
          return (
            <button
              key={t.value}
              onClick={() =>
                t.value === "urgent"
                  ? push({ priority: "urgent", status: null })
                  : push({ status: t.value === "all" ? null : t.value, priority: null })
              }
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
                    : t.value === "urgent" && n > 0
                      ? "bg-red-100 text-red-700"
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
          {canManage && (
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1.5 block">
                Assignee
              </label>
              <select
                value={assignee}
                onChange={(e) => push({ assignee: e.target.value || null })}
                className={`${field} cursor-pointer`}
              >
                <option value="">Everyone</option>
                <option value="none">Unassigned</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-neutral-500 mb-1.5 block">
              Category
            </label>
            <select
              value={category}
              onChange={(e) =>
                push({ category: e.target.value === "all" ? null : e.target.value })
              }
              className={`${field} cursor-pointer`}
            >
              <option value="all">Any category</option>
              {TASK_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {TASK_CATEGORY_LABELS[c]}
                </option>
              ))}
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
                placeholder="Title, customer, phone, order #…"
                className={`${field} w-full pl-8`}
              />
            </div>
          </form>
        </div>

        {(hasFilters || pending) && (
          <div className="flex items-center gap-3 mt-3 pt-3 border-t border-neutral-100">
            <p className="text-xs text-neutral-500">{pending ? "Loading…" : "Filtered"}</p>
            {hasFilters && (
              <button
                onClick={() => {
                  setQ("");
                  push({ q: null, category: null, assignee: null });
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

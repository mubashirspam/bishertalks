"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "@/components/admin/AdminLink";
import {
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  TASK_STATUS_BADGE,
  TASK_PRIORITY_BADGE,
  TASK_CATEGORY_LABELS,
  TASK_TRACKING_CATEGORIES,
  type TaskStatus,
} from "@/lib/tasks";
import { formatISTShort, timeAgo } from "@/lib/format-date";
import type { Task } from "@/lib/db/tasks";
import type { Staff } from "@/lib/db/staff";

/**
 * The list. Status and assignee change inline, right in the row — those are
 * the two things done a dozen times a day, and neither should need a trip to
 * the detail page. Everything else (description, history) lives there.
 */
export default function TaskTable({
  tasks,
  staff,
  canManage,
}: {
  tasks: Task[];
  staff: Staff[];
  /** Full access (tasks.manage) — false makes the Assignee cell read-only:
   *  every row a tasks.view-only login sees is already their own, and
   *  reassigning somebody else's work is not theirs to do. */
  canManage: boolean;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  // The one row (if any) mid-change, and which status it's changing to —
  // every status change asks for a short note before it takes, not just a
  // solve, so whoever asked for it in the task has something to see beyond
  // the badge flipping. Opened deliberately, same reasoning as the delivery
  // portal's Return reason: not a side effect of the select firing.
  const [changingId, setChangingId] = useState<string | null>(null);
  const [pendingStatus, setPendingStatus] = useState<TaskStatus | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [trackingDraft, setTrackingDraft] = useState("");

  const patch = async (id: string, body: Record<string, unknown>) => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusyId(null);
    }
  };

  const openStatusChange = (t: Task, status: TaskStatus) => {
    setNoteDraft("");
    setTrackingDraft(status === "solved" ? (t.resolution_tracking_id ?? "") : "");
    setPendingStatus(status);
    setChangingId(t.id);
  };

  const confirmStatusChange = async (id: string) => {
    if (!pendingStatus) return;
    await patch(id, {
      status: pendingStatus,
      status_note: noteDraft.trim() || null,
      ...(pendingStatus === "solved"
        ? {
            resolution_note: noteDraft.trim() || null,
            resolution_tracking_id: trackingDraft.trim() || null,
          }
        : {}),
    });
    setChangingId(null);
    setPendingStatus(null);
    setNoteDraft("");
    setTrackingDraft("");
  };

  if (!tasks.length) {
    return (
      <p className="bg-white border border-neutral-200 rounded-2xl px-4 py-8 text-center text-sm text-neutral-400">
        No tasks match these filters.
      </p>
    );
  }

  // No bg/border-colour of its own — those come from the badge map per row,
  // so a select can read as its own status without two colour sources fighting.
  const selectBase =
    "rounded-lg border px-2 py-1 text-xs font-medium focus:outline-none transition-colors cursor-pointer";

  return (
    <div className="bg-white border border-neutral-200 rounded-2xl overflow-hidden shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left bg-neutral-50">
              <th className="px-4 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider">
                Task
              </th>
              <th className="px-4 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider">
                Status
              </th>
              <th className="px-4 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider hidden md:table-cell">
                Category
              </th>
              <th className="px-4 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider">
                Assignee
              </th>
              <th className="px-4 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider hidden lg:table-cell">
                Created
              </th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id} className="border-b border-neutral-100 last:border-0 align-top">
                <td className="px-4 py-3 max-w-[260px]">
                  <Link
                    href={`/admin/tasks/${t.id}`}
                    className="font-medium text-neutral-900 hover:text-primary-600 flex items-center gap-1.5"
                  >
                    {t.priority === "urgent" && (
                      <span
                        className={`inline-flex shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-bold border ${TASK_PRIORITY_BADGE.urgent}`}
                      >
                        URGENT
                      </span>
                    )}
                    <span className="truncate">{t.title}</span>
                  </Link>
                  {(t.order_number || t.customer_name) && (
                    <p className="text-xs text-neutral-500 mt-0.5 truncate">
                      {[t.order_number, t.customer_name].filter(Boolean).join(" · ")}
                    </p>
                  )}
                  {/* Category rides along here on narrow screens, where its own
                      column is hidden — the label still has to be readable
                      somewhere, not just dropped. */}
                  <p className="text-[11px] text-neutral-400 mt-0.5 md:hidden">
                    {TASK_CATEGORY_LABELS[t.category]}
                  </p>
                </td>
                <td className="px-4 py-3">
                  {changingId === t.id ? (
                    <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-2 w-56 space-y-1.5">
                      <p className="text-[10px] font-semibold text-neutral-500 uppercase tracking-wide">
                        {pendingStatus && TASK_STATUS_LABELS[pendingStatus]}
                      </p>
                      <input
                        autoFocus
                        value={noteDraft}
                        onChange={(e) => setNoteDraft(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && void confirmStatusChange(t.id)}
                        placeholder={
                          pendingStatus === "solved" ? "What fixed it? (optional)" : "Short note (optional)"
                        }
                        className="w-full text-[11px] border border-neutral-200 rounded px-1.5 py-1"
                      />
                      {pendingStatus === "solved" && (
                        <input
                          value={trackingDraft}
                          onChange={(e) => setTrackingDraft(e.target.value)}
                          placeholder={
                            TASK_TRACKING_CATEGORIES.includes(t.category)
                              ? "Waybill / tracking ID"
                              : "Tracking ID (optional)"
                          }
                          className="w-full text-[11px] border border-neutral-200 rounded px-1.5 py-1 font-mono placeholder:font-sans"
                        />
                      )}
                      <div className="flex gap-1">
                        <button
                          onClick={() => void confirmStatusChange(t.id)}
                          disabled={busyId === t.id}
                          className={`flex-1 text-[10px] font-semibold text-white rounded px-2 py-1 transition-colors disabled:opacity-50 ${
                            pendingStatus === "solved" ? "bg-green-600 hover:bg-green-700" : "bg-neutral-800 hover:bg-neutral-900"
                          }`}
                        >
                          {busyId === t.id ? "Saving…" : `Update to ${pendingStatus ? TASK_STATUS_LABELS[pendingStatus] : ""}`}
                        </button>
                        <button
                          onClick={() => {
                            setChangingId(null);
                            setPendingStatus(null);
                          }}
                          disabled={busyId === t.id}
                          className="text-[10px] text-neutral-500 hover:text-neutral-900 px-1.5 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <select
                      value={t.status}
                      disabled={busyId === t.id}
                      onChange={(e) => openStatusChange(t, e.target.value as TaskStatus)}
                      className={`${selectBase} ${TASK_STATUS_BADGE[t.status]}`}
                    >
                      {TASK_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {TASK_STATUS_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  )}
                  {t.status === "solved" && (t.resolution_note || t.resolution_tracking_id) && (
                    <p className="text-[10px] text-neutral-500 mt-1 max-w-[180px] truncate" title={t.resolution_note ?? ""}>
                      {t.resolution_note}
                      {t.resolution_tracking_id && (
                        <span className="font-mono text-neutral-400">
                          {t.resolution_note ? " · " : ""}
                          {t.resolution_tracking_id}
                        </span>
                      )}
                    </p>
                  )}
                </td>
                <td className="px-4 py-3 hidden md:table-cell text-xs text-neutral-500 whitespace-nowrap">
                  {TASK_CATEGORY_LABELS[t.category]}
                </td>
                <td className="px-4 py-3">
                  {canManage ? (
                    <select
                      value={t.assigned_to_id ?? ""}
                      disabled={busyId === t.id}
                      onChange={(e) => patch(t.id, { assigned_to_id: e.target.value || null })}
                      className={`${selectBase} bg-white border-neutral-200 text-neutral-700 w-full max-w-[140px]`}
                    >
                      <option value="">Unassigned</option>
                      {staff.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-xs text-neutral-500">
                      {t.assigned_to_email ?? "Unassigned"}
                    </span>
                  )}
                </td>
                <td
                  className="px-4 py-3 hidden lg:table-cell text-xs text-neutral-500 whitespace-nowrap"
                  title={formatISTShort(t.created_at)}
                >
                  {timeAgo(t.created_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

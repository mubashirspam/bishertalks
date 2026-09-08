"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "@/components/admin/AdminLink";
import { ArrowLeft, History as HistoryIcon, User, ShoppingBag, AlertCircle } from "lucide-react";
import { formatIST } from "@/lib/format-date";
import { describeAudit, type AuditRow } from "@/lib/audit";
import {
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  TASK_STATUS_BADGE,
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_PRIORITY_BADGE,
  TASK_CATEGORIES,
  TASK_CATEGORY_LABELS,
} from "@/lib/tasks";
import type { Task } from "@/lib/db/tasks";
import type { Staff } from "@/lib/db/staff";

export default function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();

  const [task, setTask] = useState<Task | null>(null);
  const [history, setHistory] = useState<AuditRow[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [descDraft, setDescDraft] = useState("");
  const [editingDesc, setEditingDesc] = useState(false);

  useEffect(() => {
    fetch(`/api/admin/tasks/${id}`)
      .then((r) => {
        if (r.status === 404) {
          setNotFound(true);
          return null;
        }
        return r.json();
      })
      .then((json) => {
        if (!json) return;
        setTask(json.task ?? null);
        setHistory(json.history ?? []);
        setDescDraft(json.task?.description ?? "");
        if (Array.isArray(json.staff)) setStaff(json.staff);
      })
      .finally(() => setLoading(false));
  }, [id]);

  const patch = async (body: Record<string, unknown>) => {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Something went wrong");
        return;
      }
      setTask(json.task);
      const historyRes = await fetch(`/api/admin/tasks/${id}`);
      const historyJson = await historyRes.json().catch(() => ({}));
      setHistory(historyJson.history ?? []);
    } catch {
      setError("Network error — try again");
    } finally {
      setSaving(false);
    }
  };

  const field =
    "bg-white border border-neutral-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-primary-500 transition-colors";

  if (loading) {
    return <div className="max-w-3xl mx-auto animate-pulse h-96" />;
  }

  if (notFound || !task) {
    return (
      <div className="max-w-3xl mx-auto text-center py-16">
        <p className="text-neutral-500">That task doesn&apos;t exist.</p>
        <Link href="/admin/tasks" className="text-primary-600 text-sm mt-2 inline-block">
          ← Back to tasks
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      <Link
        href="/admin/tasks"
        className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-900 mb-4"
      >
        <ArrowLeft className="w-4 h-4" /> All tasks
      </Link>

      {error && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 mb-4 text-sm text-red-800">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <p>{error}</p>
        </div>
      )}

      <div className="bg-white border border-neutral-200 rounded-2xl p-5 shadow-sm mb-4">
        <div className="flex items-start justify-between gap-3 mb-4">
          <h1 className="text-lg font-bold text-neutral-900">{task.title}</h1>
          {task.priority === "urgent" && (
            <span
              className={`shrink-0 inline-flex px-2 py-1 rounded-full text-xs font-bold border ${TASK_PRIORITY_BADGE.urgent}`}
            >
              URGENT
            </span>
          )}
        </div>

        {(task.order_number || task.customer_name || task.customer_phone) && (
          <div className="flex items-start gap-2 bg-neutral-50 border border-neutral-200 rounded-xl px-3 py-2.5 mb-4 text-sm">
            {task.order_id ? (
              <ShoppingBag className="w-4 h-4 text-neutral-400 mt-0.5 flex-shrink-0" />
            ) : (
              <User className="w-4 h-4 text-neutral-400 mt-0.5 flex-shrink-0" />
            )}
            <div>
              {task.order_number && (
                task.order_id ? (
                  <Link href={`/admin/orders/${task.order_number}`} className="font-medium text-primary-600 hover:underline">
                    {task.order_number}
                  </Link>
                ) : (
                  <p className="font-medium text-neutral-700">{task.order_number}</p>
                )
              )}
              <p className="text-neutral-600">
                {[task.customer_name, task.customer_phone].filter(Boolean).join(" · ") || "No customer on file — entered by hand"}
              </p>
            </div>
          </div>
        )}

        {/* Description — click to edit, same "quiet until touched" pattern as
            the order detail page's editable fields. */}
        {editingDesc ? (
          <div className="mb-4">
            <textarea
              value={descDraft}
              onChange={(e) => setDescDraft(e.target.value)}
              rows={4}
              className={`${field} w-full`}
              autoFocus
            />
            <div className="flex gap-2 mt-2">
              <button
                onClick={async () => {
                  await patch({ description: descDraft });
                  setEditingDesc(false);
                }}
                disabled={saving}
                className="px-3 py-1.5 rounded-lg bg-primary-500 hover:bg-primary-600 text-white text-xs font-bold disabled:opacity-60"
              >
                Save
              </button>
              <button
                onClick={() => {
                  setDescDraft(task.description ?? "");
                  setEditingDesc(false);
                }}
                className="px-3 py-1.5 rounded-lg border border-neutral-200 text-xs text-neutral-600"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setEditingDesc(true)}
            className="text-left w-full text-sm text-neutral-700 mb-4 hover:bg-neutral-50 rounded-lg -mx-1 px-1 py-1 transition-colors"
          >
            {task.description || <span className="text-neutral-400">Add a description…</span>}
          </button>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-4 border-t border-neutral-100">
          <div>
            <label className="text-xs font-medium text-neutral-500 mb-1.5 block">Status</label>
            <select
              value={task.status}
              disabled={saving}
              onChange={(e) => patch({ status: e.target.value })}
              className={`${field} w-full cursor-pointer ${TASK_STATUS_BADGE[task.status]}`}
            >
              {TASK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {TASK_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
            {task.status === "solved" && task.solved_by_email && (
              <p className="text-[11px] text-neutral-400 mt-1">
                Solved by {task.solved_by_email}
                {task.solved_at ? ` · ${formatIST(task.solved_at)}` : ""}
              </p>
            )}
          </div>

          <div>
            <label className="text-xs font-medium text-neutral-500 mb-1.5 block">Assignee</label>
            <select
              value={task.assigned_to_id ?? ""}
              disabled={saving}
              onChange={(e) => patch({ assigned_to_id: e.target.value || null })}
              className={`${field} w-full cursor-pointer`}
            >
              <option value="">Unassigned</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-neutral-500 mb-1.5 block">Category</label>
            <select
              value={task.category}
              disabled={saving}
              onChange={(e) => patch({ category: e.target.value })}
              className={`${field} w-full cursor-pointer`}
            >
              {TASK_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {TASK_CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-neutral-500 mb-1.5 block">Priority</label>
            <div className="flex gap-2">
              {TASK_PRIORITIES.map((p) => (
                <button
                  key={p}
                  disabled={saving}
                  onClick={() => patch({ priority: p })}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                    task.priority === p
                      ? p === "urgent"
                        ? "bg-red-600 text-white border-red-600"
                        : "bg-neutral-900 text-white border-neutral-900"
                      : "bg-white text-neutral-600 border-neutral-200 hover:border-neutral-400"
                  }`}
                >
                  {TASK_PRIORITY_LABELS[p]}
                </button>
              ))}
            </div>
          </div>
        </div>

        <p className="text-[11px] text-neutral-400 mt-4 pt-4 border-t border-neutral-100">
          Created by {task.created_by_email} · {formatIST(task.created_at)}
        </p>
      </div>

      {history.length > 0 && (
        <div className="bg-white border border-neutral-200 rounded-2xl p-5 shadow-sm">
          <h2 className="font-semibold text-sm text-neutral-700 mb-3 flex items-center gap-2">
            <HistoryIcon className="w-4 h-4 text-primary-500" /> History
          </h2>
          <ul className="space-y-2.5">
            {history.map((h) => (
              <li key={h.id} className="flex items-start gap-2.5 text-xs">
                <span className="w-1.5 h-1.5 rounded-full bg-neutral-300 mt-1.5 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-neutral-700">{describeAudit(h)}</p>
                  <p className="text-neutral-400 mt-0.5">
                    {h.actor_email} · {formatIST(h.created_at)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

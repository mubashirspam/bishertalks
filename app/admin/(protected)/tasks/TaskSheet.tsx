"use client";

import { useEffect, useState } from "react";
import Link from "@/components/admin/AdminLink";
import { ArrowLeft, ExternalLink, X } from "lucide-react";
import TaskDetail from "./TaskDetail";
import OrderQuickPanel from "./OrderQuickPanel";

/**
 * Desktop side sheet for the task list. Opening a task here is a fetch of one
 * row, not a server navigation to a new page — and its order opens in the same
 * sheet, with Back returning to the task, so working a queue of tasks never
 * leaves the list.
 */
export default function TaskSheet({
  taskId,
  canViewOrders,
  canEditOrders,
  onClose,
  onChanged,
}: {
  taskId: string;
  canViewOrders: boolean;
  canEditOrders: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  // Keyed by taskId in TaskTable, so clicking another row starts back on
  // that task's own view.
  const [orderNumber, setOrderNumber] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Esc steps back out of the order first, then closes.
      if (orderNumber) setOrderNumber(null);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [orderNumber, onClose]);

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-neutral-900/20 animate-[fadeIn_150ms_ease-out]" onClick={onClose} />
      <aside
        role="dialog"
        aria-modal="true"
        className="absolute inset-y-0 right-0 w-full max-w-xl bg-neutral-50 shadow-2xl border-l border-neutral-200 flex flex-col animate-[slideIn_200ms_ease-out]"
      >
        <header className="flex items-center gap-2 px-4 py-3 bg-white border-b border-neutral-200">
          {orderNumber ? (
            <button
              onClick={() => setOrderNumber(null)}
              className="inline-flex items-center gap-1.5 text-sm text-neutral-600 hover:text-neutral-900"
            >
              <ArrowLeft className="w-4 h-4" /> Back to task
            </button>
          ) : (
            <span className="text-sm font-semibold text-neutral-700">Task</span>
          )}
          <div className="ml-auto flex items-center gap-1">
            <Link
              href={orderNumber ? `/admin/orders/${orderNumber}` : `/admin/tasks/${taskId}`}
              title="Open full page"
              className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
            >
              <ExternalLink className="w-4 h-4" />
            </Link>
            <button
              onClick={onClose}
              title="Close (Esc)"
              className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4">
          {/* Both stay mounted so Back to task is instant and keeps its state. */}
          <div hidden={!!orderNumber}>
            <TaskDetail
              id={taskId}
              onOpenOrder={canViewOrders ? setOrderNumber : undefined}
              onChanged={onChanged}
            />
          </div>
          {orderNumber && (
            <OrderQuickPanel key={orderNumber} orderNumber={orderNumber} canEdit={canEditOrders} />
          )}
        </div>
      </aside>
      <style>{`
        @keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      `}</style>
    </div>
  );
}

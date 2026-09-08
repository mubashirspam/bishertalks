"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Check, MessageCircle, Plus, Search } from "lucide-react";
import {
  TASK_CATEGORIES,
  TASK_CATEGORY_LABELS,
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  type TaskCategory,
  type TaskPriority,
} from "@/lib/tasks";
import type { Staff } from "@/lib/db/staff";
import type { OrderMatch } from "@/lib/db/tasks";

interface Draft {
  title: string;
  description: string;
  category: TaskCategory;
  priority: TaskPriority;
  assignedToId: string;
  orderId: string;
  customerName: string;
  customerPhone: string;
  /** Off by default — most tasks are internal and have nobody to notify. */
  notifyCustomer: boolean;
}

const blank = (): Draft => ({
  title: "",
  description: "",
  category: "other",
  priority: "normal",
  assignedToId: "",
  orderId: "",
  customerName: "",
  customerPhone: "",
  notifyCustomer: false,
});

/**
 * The "+ New task" button and its inline form — collapsed to a button when
 * idle, an inline card when open, same convention as StaffManager.tsx. Not a
 * modal: nothing here needs to float over the list.
 */
export default function NewTaskForm({ staff }: { staff: Staff[] }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [manual, setManual] = useState(false);
  const [orderQuery, setOrderQuery] = useState("");
  const [orderResults, setOrderResults] = useState<OrderMatch[]>([]);
  const [searching, setSearching] = useState(false);
  // Guards against a slow earlier search landing after a faster later one —
  // same pattern the pincode lookup in DirectSaleForm.tsx uses.
  const searchSeq = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openForm = () => {
    setDraft(blank());
    setManual(false);
    setOrderQuery("");
    setOrderResults([]);
    setError("");
  };

  const closeForm = () => {
    setDraft(null);
    setError("");
  };

  const searchOrders = (term: string) => {
    setOrderQuery(term);
    setDraft((d) => (d ? { ...d, orderId: "" } : d));
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (term.trim().length < 2) {
      setOrderResults([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      const seq = ++searchSeq.current;
      setSearching(true);
      try {
        const res = await fetch(`/api/admin/tasks/search-orders?q=${encodeURIComponent(term)}`);
        const json = await res.json().catch(() => ({ orders: [] }));
        if (seq !== searchSeq.current) return; // a newer search has since started
        setOrderResults(json.orders ?? []);
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    }, 300);
  };

  const pickOrder = (o: OrderMatch) => {
    setDraft((d) =>
      d
        ? {
            ...d,
            orderId: o.id,
            customerName: o.buyer_name ?? "",
            customerPhone: o.buyer_phone ?? "",
            // Whoever this task was about a moment ago is not who it's about
            // now — a stray tick must never carry over onto a different phone.
            notifyCustomer: false,
          }
        : d
    );
    setOrderQuery(`${o.order_number} — ${o.buyer_name ?? o.buyer_phone ?? "no name"}`);
    setOrderResults([]);
  };

  const toggleManual = () => {
    setManual((m) => !m);
    setDraft((d) =>
      d ? { ...d, orderId: "", customerName: "", customerPhone: "", notifyCustomer: false } : d
    );
    setOrderQuery("");
    setOrderResults([]);
  };

  const save = async () => {
    if (!draft) return;
    if (!draft.title.trim()) {
      setError("Enter a title.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: draft.title,
          description: draft.description,
          category: draft.category,
          priority: draft.priority,
          assigned_to_id: draft.assignedToId || undefined,
          order_id: draft.orderId || undefined,
          customer_name: manual ? draft.customerName : undefined,
          customer_phone: manual ? draft.customerPhone : undefined,
          // Guarded on a phone actually being present, not just the checkbox
          // state — the box is hidden without one, but state can lag a
          // fast clear-then-submit.
          notify_customer: draft.notifyCustomer && !!draft.customerPhone.trim(),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Something went wrong");
        return;
      }
      closeForm();
      router.refresh();
    } catch {
      setError("Network error — try again");
    } finally {
      setBusy(false);
    }
  };

  const field =
    "bg-white border border-neutral-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-primary-500 transition-colors";

  if (!draft) {
    return (
      <button
        onClick={openForm}
        className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary-500 hover:bg-primary-600 text-white text-sm font-bold mb-5 transition-colors"
      >
        <Plus className="w-4 h-4" /> New task
      </button>
    );
  }

  return (
    <div className="bg-white border border-neutral-200 rounded-2xl p-5 shadow-sm mb-5">
      <h2 className="font-semibold text-sm text-neutral-700 mb-4">New task</h2>

      {error && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 mb-4 text-sm text-red-800">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <p>{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <div className="md:col-span-2">
          <label className="text-xs font-medium text-neutral-500 mb-1.5 block">Title</label>
          <input
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder="What needs doing"
            className={`${field} w-full`}
          />
        </div>
        <div className="md:col-span-2">
          <label className="text-xs font-medium text-neutral-500 mb-1.5 block">
            Description <span className="text-neutral-400 font-normal">(optional)</span>
          </label>
          <textarea
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            rows={2}
            className={`${field} w-full`}
          />
        </div>

        <div>
          <label className="text-xs font-medium text-neutral-500 mb-1.5 block">Category</label>
          <select
            value={draft.category}
            onChange={(e) => setDraft({ ...draft, category: e.target.value as TaskCategory })}
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
          <label className="text-xs font-medium text-neutral-500 mb-1.5 block">
            Assign to <span className="text-neutral-400 font-normal">(optional)</span>
          </label>
          <select
            value={draft.assignedToId}
            onChange={(e) => setDraft({ ...draft, assignedToId: e.target.value })}
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

        <div className="md:col-span-2">
          <label className="text-xs font-medium text-neutral-500 mb-1.5 block">Priority</label>
          <div className="flex gap-2">
            {TASK_PRIORITIES.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setDraft({ ...draft, priority: p })}
                className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                  draft.priority === p
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

      <div className="border-t border-neutral-100 pt-4 mb-4">
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs font-medium text-neutral-500 block">
            Who this is about <span className="text-neutral-400 font-normal">(optional)</span>
          </label>
          <button
            type="button"
            onClick={toggleManual}
            className="text-xs text-primary-600 hover:text-primary-700"
          >
            {manual ? "Search an order instead" : "Can't find them — enter manually"}
          </button>
        </div>

        {manual ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              value={draft.customerName}
              onChange={(e) => setDraft({ ...draft, customerName: e.target.value })}
              placeholder="Name"
              className={`${field} w-full`}
            />
            <input
              value={draft.customerPhone}
              onChange={(e) => setDraft({ ...draft, customerPhone: e.target.value })}
              placeholder="Phone"
              className={`${field} w-full`}
            />
          </div>
        ) : (
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={orderQuery}
              onChange={(e) => searchOrders(e.target.value)}
              placeholder="Order number, name or phone…"
              className={`${field} w-full pl-8 pr-8`}
            />
            {draft.orderId && (
              <Check className="w-4 h-4 text-green-600 absolute right-3 top-1/2 -translate-y-1/2" />
            )}
            {orderResults.length > 0 && (
              <div className="absolute z-10 mt-1 w-full bg-white border border-neutral-200 rounded-xl shadow-lg overflow-hidden max-h-56 overflow-y-auto">
                {orderResults.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => pickOrder(o)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-neutral-50 border-b border-neutral-50 last:border-0"
                  >
                    <p className="font-medium text-neutral-900">{o.order_number}</p>
                    <p className="text-xs text-neutral-500">
                      {[o.buyer_name, o.buyer_phone].filter(Boolean).join(" · ") || "No name on file"}
                    </p>
                  </button>
                ))}
              </div>
            )}
            {searching && <p className="text-xs text-neutral-400 mt-1">Searching…</p>}
            {!searching &&
              orderQuery.trim().length >= 2 &&
              !orderResults.length &&
              !draft.orderId && (
                <p className="text-xs text-neutral-400 mt-1">
                  No matching orders — try{" "}
                  <button type="button" onClick={toggleManual} className="underline">
                    entering it manually
                  </button>
                  .
                </p>
              )}
          </div>
        )}

        {/* Only offered once there's a phone to actually send to — hidden
            rather than disabled, so nobody wonders what it would do. Off by
            default: most tasks are internal, and a message should be a
            deliberate choice, not a side effect of filling in a form. */}
        {draft.customerPhone.trim() && (
          <label className="flex items-center gap-2 mt-3 cursor-pointer">
            <input
              type="checkbox"
              checked={draft.notifyCustomer}
              onChange={(e) => setDraft({ ...draft, notifyCustomer: e.target.checked })}
              className="w-4 h-4 rounded border-neutral-300 accent-primary-500"
            />
            <span className="text-xs text-neutral-700 flex items-center gap-1.5">
              <MessageCircle className="w-3.5 h-3.5 text-neutral-400" />
              Notify them on WhatsApp — &ldquo;we&rsquo;ve registered your request&rdquo;
            </span>
          </label>
        )}
      </div>

      <div className="flex gap-2 pt-4 border-t border-neutral-100">
        <button
          onClick={save}
          disabled={busy}
          className="px-4 py-2 rounded-xl bg-primary-500 hover:bg-primary-600 text-white text-sm font-bold disabled:opacity-60 transition-colors"
        >
          {busy ? "Creating…" : "Create task"}
        </button>
        <button
          onClick={closeForm}
          className="px-4 py-2 rounded-xl border border-neutral-200 text-sm text-neutral-600 hover:border-neutral-400 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

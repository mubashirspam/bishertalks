"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Loader2, X } from "lucide-react";
import {
  MOVEMENT_KINDS,
  MOVEMENT_LABELS,
  type MovementKind,
} from "@/lib/inventory-movements";

/**
 * The two ways stock changes by hand.
 *
 * Both are closed until asked for. This screen is read far more often than it
 * is written to — somebody checking how many books are left should not have to
 * look past two forms to find the number — and a write-off is not something to
 * leave one stray click away.
 */
export default function StockForms({ canManage }: { canManage: boolean }) {
  const [open, setOpen] = useState<"movement" | "run" | null>(null);

  if (!canManage) return null;

  return (
    <div className="mb-6">
      {open === null && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setOpen("movement")}
            className="flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 transition hover:border-neutral-500"
          >
            <Plus className="h-3.5 w-3.5" /> Record a correction
          </button>
          <button
            onClick={() => setOpen("run")}
            className="flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 transition hover:border-neutral-500"
          >
            <Plus className="h-3.5 w-3.5" /> Add a print run
          </button>
        </div>
      )}

      {open === "movement" && <MovementForm onClose={() => setOpen(null)} />}
      {open === "run" && <PrintRunForm onClose={() => setOpen(null)} />}
    </div>
  );
}

function Shell({
  title,
  hint,
  onClose,
  children,
}: {
  title: string;
  hint: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-5">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-neutral-900">{title}</h2>
          <p className="mt-0.5 text-xs text-neutral-500">{hint}</p>
        </div>
        <button
          onClick={onClose}
          className="text-neutral-400 transition hover:text-neutral-700"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {children}
    </div>
  );
}

const field =
  "w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:border-primary-400 focus:outline-none focus:ring-1 focus:ring-primary-200";
const label = "block text-xs font-medium text-neutral-600 mb-1";

function MovementForm({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [kind, setKind] = useState<MovementKind>("out_damaged");
  const [copies, setCopies] = useState("");
  const [reason, setReason] = useState("");
  const [orderNumber, setOrderNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The one kind that asks which parcel came back, because that is the only
  // one where a specific order is the reason.
  const isReturn = kind === "in_returned";

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/inventory/movement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          copies: Number(copies),
          reason,
          order_number: isReturn ? orderNumber : null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not save that.");
      onClose();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save that.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell
      title="Record a stock correction"
      hint="For what the orders cannot explain. This cannot be edited afterwards — a mistake is fixed by recording the correction, the way a physical count works."
      onClose={onClose}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={label}>What happened</label>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as MovementKind)}
            className={field}
          >
            {MOVEMENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {MOVEMENT_LABELS[k]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={label}>How many copies</label>
          <input
            type="number"
            min={1}
            value={copies}
            onChange={(e) => setCopies(e.target.value)}
            placeholder="e.g. 12"
            className={field}
          />
        </div>

        {isReturn && (
          <div>
            <label className={label}>Which order came back (optional)</label>
            <input
              value={orderNumber}
              onChange={(e) => setOrderNumber(e.target.value.toUpperCase())}
              placeholder="ORD-XXXXXX"
              className={`${field} font-mono`}
            />
          </div>
        )}

        <div className="sm:col-span-2">
          <label className={label}>Why</label>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Water damage in the store room — pulped"
            className={field}
          />
        </div>
      </div>

      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={save}
          disabled={busy || !copies || !reason.trim()}
          className="flex items-center gap-1.5 rounded-lg bg-neutral-900 px-4 py-2 text-xs font-semibold text-white transition hover:bg-neutral-700 disabled:opacity-40"
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {busy ? "Saving…" : "Record it"}
        </button>
        <button
          onClick={onClose}
          className="text-xs font-medium text-neutral-500 transition hover:text-neutral-800"
        >
          Cancel
        </button>
      </div>
    </Shell>
  );
}

function PrintRunForm({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [edition, setEdition] = useState("");
  const [copies, setCopies] = useState("");
  const [receivedOn, setReceivedOn] = useState(new Date().toISOString().slice(0, 10));
  const [cost, setCost] = useState("");
  const [printer, setPrinter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/inventory/print-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          edition: Number(edition),
          copies: Number(copies),
          received_on: receivedOn,
          unit_cost_rupees: cost ? Number(cost) : null,
          printer,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not save that.");
      onClose();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save that.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell
      title="Add a print run"
      hint="Books count from the day they arrived, not the day the run was ordered — a run still on the press is not stock."
      onClose={onClose}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={label}>Edition</label>
          <input
            type="number"
            min={1}
            value={edition}
            onChange={(e) => setEdition(e.target.value)}
            placeholder="5"
            className={field}
          />
        </div>
        <div>
          <label className={label}>Copies that arrived</label>
          <input
            type="number"
            min={1}
            value={copies}
            onChange={(e) => setCopies(e.target.value)}
            placeholder="5000"
            className={field}
          />
        </div>
        <div>
          <label className={label}>Received on</label>
          <input
            type="date"
            value={receivedOn}
            onChange={(e) => setReceivedOn(e.target.value)}
            className={field}
          />
        </div>
        <div>
          <label className={label}>Cost per copy (₹, optional)</label>
          <input
            type="number"
            min={0}
            step="0.01"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            placeholder="95"
            className={field}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={label}>Printer (optional)</label>
          <input
            value={printer}
            onChange={(e) => setPrinter(e.target.value)}
            className={field}
          />
        </div>
      </div>

      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={save}
          disabled={busy || !edition || !copies || !receivedOn}
          className="flex items-center gap-1.5 rounded-lg bg-neutral-900 px-4 py-2 text-xs font-semibold text-white transition hover:bg-neutral-700 disabled:opacity-40"
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {busy ? "Saving…" : "Add the run"}
        </button>
        <button
          onClick={onClose}
          className="text-xs font-medium text-neutral-500 transition hover:text-neutral-800"
        >
          Cancel
        </button>
      </div>
    </Shell>
  );
}

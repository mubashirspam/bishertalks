"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";

/**
 * Removing an expense that should never have been recorded.
 *
 * A real delete, not a flag. An expense is a claim on the company's money, and
 * a wrong one left soft-deleted keeps turning up in somebody's balance long
 * after everyone agreed it was a mistake. What was removed, and by whom, is in
 * the audit log.
 *
 * Two clicks, because the balance it moves is money somebody is owed.
 */
export default function DeleteExpense({ id }: { id: string }) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/expenses?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? "Could not delete it.");
        setBusy(false);
        return;
      }
      router.push("/admin/expenses");
      router.refresh();
    } catch {
      setError("Could not reach the server.");
      setBusy(false);
    }
  }

  if (!armed) {
    return (
      <button
        onClick={() => setArmed(true)}
        className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-red-700"
      >
        <Trash2 className="h-4 w-4" /> Delete this expense
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
      <p className="text-sm text-red-900">
        Delete it for good? Whoever paid will stop being owed for it.
      </p>
      {error && <p className="mt-1.5 text-xs text-red-700">{error}</p>}
      <div className="mt-2.5 flex gap-2">
        <button
          onClick={remove}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Yes, delete
        </button>
        <button
          onClick={() => { setArmed(false); setError(null); }}
          className="rounded-xl px-3 py-2 text-sm text-neutral-600 hover:text-neutral-900"
        >
          Keep it
        </button>
      </div>
    </div>
  );
}

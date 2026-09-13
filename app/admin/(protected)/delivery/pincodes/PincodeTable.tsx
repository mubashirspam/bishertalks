"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, Pin, PinOff, X } from "lucide-react";
import type { PincodeStat, PincodeFilter } from "@/lib/db/pincode-stats";
import { formatISTShort } from "@/lib/format-date";

const FILTERS: { value: PincodeFilter; label: string }[] = [
  { value: "all", label: "All pincodes" },
  { value: "eligible", label: "Delhivery-ready" },
  { value: "not_eligible", label: "Not Delhivery-ready" },
  { value: "overridden", label: "Manually pinned" },
];

/**
 * Browse pincode_delivery_stats, and pin one by hand.
 *
 * A pin is deliberately a separate act from the row it sits on: typing a
 * reason is what turns "I clicked the wrong thing" into "I meant this",
 * which matters here because a pin outlives the rule — it survives every
 * recompute until someone clears it, not just this page load.
 */
export default function PincodeTable({
  rows,
  count,
  pageNum,
  perPage,
  search,
  filter,
  staffNames,
  mayOverride,
}: {
  rows: PincodeStat[];
  count: number;
  pageNum: number;
  perPage: number;
  search: string;
  filter: PincodeFilter;
  staffNames: Record<string, string>;
  mayOverride: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(search);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Which row has the pin panel open, if any — one at a time. */
  const [pinning, setPinning] = useState<string | null>(null);
  const [reasonDraft, setReasonDraft] = useState("");
  const [addPincode, setAddPincode] = useState("");

  const push = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete("page");
    router.push(`/admin/delivery/pincodes?${next}`);
  };

  async function setOverride(pincode: string, override: boolean | null, reason: string) {
    setBusy(pincode);
    setError(null);
    try {
      const res = await fetch("/api/admin/delivery/pincode-override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pincode, override, reason: reason.trim() || null }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed (${res.status})`);
      }
      setPinning(null);
      setReasonDraft("");
      setAddPincode("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  const totalPages = Math.ceil(count / perPage);
  const pageLink = (p: number) => {
    const next = new URLSearchParams(params.toString());
    next.set("page", String(p));
    return `/admin/delivery/pincodes?${next}`;
  };

  return (
    <div>
      <div className="bg-white border border-neutral-200 rounded-2xl p-3.5 shadow-sm mb-4 flex flex-wrap items-center gap-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            push({ q: q.trim() || null });
          }}
          className="relative"
        >
          <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Pincode, district or state"
            className="bg-white border border-neutral-300 rounded-lg pl-8 pr-3 py-1.5 text-xs w-64 focus:outline-none focus:border-primary-500"
          />
        </form>

        <select
          value={filter}
          onChange={(e) => push({ filter: e.target.value === "all" ? null : e.target.value })}
          className="bg-white border border-neutral-300 rounded-lg px-2.5 py-1.5 text-xs cursor-pointer focus:outline-none focus:border-primary-500"
        >
          {FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>

        {(search || filter !== "all") && (
          <button
            onClick={() => router.push("/admin/delivery/pincodes")}
            className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-900"
          >
            <X className="w-3 h-3" /> Clear
          </button>
        )}

        <p className="text-xs text-neutral-500 ml-auto">{count} pincode{count === 1 ? "" : "s"}</p>

        {/* A pincode with no history yet has no row to click — this is how
            one gets pinned ready before it has earned it on its own. */}
        {mayOverride && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (/^\d{6}$/.test(addPincode.trim())) {
                setPinning(addPincode.trim());
                setReasonDraft("");
              } else {
                setError("Type a 6-digit pincode first.");
              }
            }}
            className="flex items-center gap-1.5 w-full sm:w-auto"
          >
            <input
              value={addPincode}
              onChange={(e) => setAddPincode(e.target.value)}
              placeholder="Pin a new pincode…"
              maxLength={6}
              className="bg-white border border-neutral-300 rounded-lg px-2.5 py-1.5 text-xs w-40 font-mono focus:outline-none focus:border-primary-500"
            />
            <button
              type="submit"
              className="px-2.5 py-1.5 rounded-lg border border-neutral-300 text-xs text-neutral-700 hover:border-neutral-400"
            >
              Add
            </button>
          </form>
        )}
      </div>

      {error && (
        <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          {error}
        </p>
      )}

      {/* A pincode typed into "Pin a new pincode" that isn't in the table
          yet — its own row, so setting the pin is the same flow as any
          other row's. */}
      {pinning && !rows.some((r) => r.pincode === pinning) && (
        <PinPanel
          pincode={pinning}
          reasonDraft={reasonDraft}
          setReasonDraft={setReasonDraft}
          busy={busy === pinning}
          onSave={(override) => setOverride(pinning, override, reasonDraft)}
          onCancel={() => {
            setPinning(null);
            setReasonDraft("");
          }}
        />
      )}

      <div className="bg-white border border-neutral-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-neutral-50 border-b border-neutral-200 text-left">
                <th className="px-3 py-2.5 font-semibold text-neutral-500 uppercase tracking-wider">Pincode</th>
                <th className="px-3 py-2.5 font-semibold text-neutral-500 uppercase tracking-wider">District</th>
                <th className="px-3 py-2.5 font-semibold text-neutral-500 uppercase tracking-wider text-right">Delivered</th>
                <th className="px-3 py-2.5 font-semibold text-neutral-500 uppercase tracking-wider text-right">Fast</th>
                <th className="px-3 py-2.5 font-semibold text-neutral-500 uppercase tracking-wider text-right">Returned</th>
                <th className="px-3 py-2.5 font-semibold text-neutral-500 uppercase tracking-wider">Rule says</th>
                <th className="px-3 py-2.5 font-semibold text-neutral-500 uppercase tracking-wider">Effective</th>
                {mayOverride && (
                  <th className="px-3 py-2.5 font-semibold text-neutral-500 uppercase tracking-wider">Pin</th>
                )}
              </tr>
            </thead>
            <tbody>
              {!rows.length ? (
                <tr>
                  <td colSpan={mayOverride ? 8 : 7} className="px-4 py-8 text-center text-neutral-400">
                    No pincodes match.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <RowLine
                    key={r.pincode}
                    r={r}
                    busy={busy === r.pincode}
                    pinning={pinning === r.pincode}
                    reasonDraft={reasonDraft}
                    setReasonDraft={setReasonDraft}
                    staffNames={staffNames}
                    mayOverride={mayOverride}
                    onOpenPin={() => {
                      setPinning(r.pincode);
                      setReasonDraft(r.overrideReason ?? "");
                    }}
                    onClosePin={() => {
                      setPinning(null);
                      setReasonDraft("");
                    }}
                    onSave={(override) => setOverride(r.pincode, override, reasonDraft)}
                    onClear={() => setOverride(r.pincode, null, "")}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-neutral-500 text-xs">
            Page {pageNum + 1} of {totalPages}
          </p>
          <div className="flex gap-2">
            {pageNum > 0 && (
              <a
                href={pageLink(pageNum)}
                className="px-3 py-1.5 rounded-lg bg-white border border-neutral-200 text-sm hover:border-neutral-300"
              >
                ← Prev
              </a>
            )}
            {pageNum + 1 < totalPages && (
              <a
                href={pageLink(pageNum + 2)}
                className="px-3 py-1.5 rounded-lg bg-white border border-neutral-200 text-sm hover:border-neutral-300"
              >
                Next →
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function RowLine({
  r,
  busy,
  pinning,
  reasonDraft,
  setReasonDraft,
  staffNames,
  mayOverride,
  onOpenPin,
  onClosePin,
  onSave,
  onClear,
}: {
  r: PincodeStat;
  busy: boolean;
  pinning: boolean;
  reasonDraft: string;
  setReasonDraft: (v: string) => void;
  staffNames: Record<string, string>;
  mayOverride: boolean;
  onOpenPin: () => void;
  onClosePin: () => void;
  onSave: (override: boolean) => void;
  onClear: () => void;
}) {
  return (
    <>
      <tr className={`border-b border-neutral-100 last:border-0 ${busy ? "opacity-60" : ""}`}>
        <td className="px-3 py-2 font-mono font-semibold text-neutral-800">{r.pincode}</td>
        <td className="px-3 py-2 text-neutral-600">
          {[r.district, r.state].filter(Boolean).join(", ") || "—"}
        </td>
        <td className="px-3 py-2 text-right tabular-nums">{r.deliveredCount}</td>
        <td className="px-3 py-2 text-right tabular-nums">{r.fastDeliveredCount}</td>
        <td className="px-3 py-2 text-right tabular-nums">
          {r.returnedCount > 0 ? (
            <span className="text-rose-600 font-semibold">{r.returnedCount}</span>
          ) : (
            r.returnedCount
          )}
        </td>
        <td className="px-3 py-2">
          <Badge on={r.computedEligible} />
        </td>
        <td className="px-3 py-2">
          <div className="flex items-center gap-1.5">
            <Badge on={r.delhiveryEligible} />
            {r.manualOverride !== null && (
              <span
                title={
                  `Pinned ${r.manualOverride ? "ready" : "not ready"} by ` +
                  `${(r.overrideBy && staffNames[r.overrideBy]) || "someone"}` +
                  (r.overrideAt ? ` on ${formatISTShort(r.overrideAt)}` : "") +
                  (r.overrideReason ? ` — ${r.overrideReason}` : "")
                }
                className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-primary-700 bg-primary-50 border border-primary-200 rounded-full px-1.5 py-0.5"
              >
                <Pin className="w-2.5 h-2.5" /> Pinned
              </span>
            )}
          </div>
        </td>
        {mayOverride && (
          <td className="px-3 py-2">
            <div className="flex items-center gap-2">
              <button
                onClick={onOpenPin}
                title="Set or change this pincode's pin"
                className="text-neutral-400 hover:text-neutral-700"
              >
                <Pin className="w-3.5 h-3.5" />
              </button>
              {r.manualOverride !== null && (
                <button
                  onClick={onClear}
                  disabled={busy}
                  title="Clear the pin — go back to what the rule says"
                  className="text-neutral-400 hover:text-red-600 disabled:opacity-40"
                >
                  <PinOff className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </td>
        )}
      </tr>
      {pinning && (
        <tr className="bg-neutral-50 border-b border-neutral-100">
          <td colSpan={mayOverride ? 8 : 7} className="px-3 py-3">
            <PinPanel
              pincode={r.pincode}
              reasonDraft={reasonDraft}
              setReasonDraft={setReasonDraft}
              busy={busy}
              onSave={onSave}
              onCancel={onClosePin}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function Badge({ on }: { on: boolean }) {
  return on ? (
    <span className="inline-flex text-[10px] font-semibold text-green-700 bg-green-50 border border-green-200 rounded-full px-2 py-0.5">
      Delhivery-ready
    </span>
  ) : (
    <span className="inline-flex text-[10px] font-semibold text-neutral-500 bg-neutral-100 border border-neutral-200 rounded-full px-2 py-0.5">
      Not ready
    </span>
  );
}

function PinPanel({
  pincode,
  reasonDraft,
  setReasonDraft,
  busy,
  onSave,
  onCancel,
}: {
  pincode: string;
  reasonDraft: string;
  setReasonDraft: (v: string) => void;
  busy: boolean;
  onSave: (override: boolean) => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="font-mono font-semibold">{pincode}</span>
      <input
        autoFocus
        value={reasonDraft}
        onChange={(e) => setReasonDraft(e.target.value)}
        placeholder="Why? (optional, but shows up on hover later)"
        maxLength={300}
        className="flex-1 min-w-[180px] border border-neutral-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-primary-500"
      />
      <button
        onClick={() => onSave(true)}
        disabled={busy}
        className="px-2.5 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white font-semibold disabled:opacity-50"
      >
        Pin ready
      </button>
      <button
        onClick={() => onSave(false)}
        disabled={busy}
        className="px-2.5 py-1.5 rounded-lg bg-neutral-700 hover:bg-neutral-800 text-white font-semibold disabled:opacity-50"
      >
        Pin not ready
      </button>
      <button
        onClick={onCancel}
        disabled={busy}
        className="px-2.5 py-1.5 text-neutral-500 hover:text-neutral-900 disabled:opacity-40"
      >
        Cancel
      </button>
    </div>
  );
}

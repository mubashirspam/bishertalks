"use client";

import { useEffect, useState } from "react";
import { ScanLine, Upload, Loader2, AlertTriangle, Check } from "lucide-react";

/**
 * India Post's article numbers, and how many are left.
 *
 * The one piece of stock this shop has to keep. Delhivery hands back a waybill
 * in the response that accepts a parcel, so there is nothing to run out of;
 * India Post allots a block of numbers up front, we mint from it ourselves,
 * and each number is spent whether or not the booking that used it worked. Run
 * the block down with nobody watching and the next batch of parcels cannot be
 * posted at all — hence a count on the screen and a warning well before zero.
 *
 * Loading is a file upload rather than a form for a reason worth keeping: the
 * numbers come out of their portal as a spreadsheet, and a range retyped by
 * hand with one digit wrong produces article numbers that pass every check we
 * have and belong to another customer's allotment. Their file also lets the
 * server check our check-digit arithmetic against theirs — see
 * lib/india-post/barcode-import.ts.
 */

/** Below this, ask for the next allotment. About a fortnight of post. */
const LOW = 200;

interface Stock {
  unused: number;
  allotted: number;
  openRanges: number;
}

export default function BarcodeStock({
  courierId,
  courierName,
}: {
  courierId: string;
  courierName: string;
}) {
  const [stock, setStock] = useState<Stock | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const [typing, setTyping] = useState(false);
  const [range, setRange] = useState({ from: "", to: "" });

  // The count on first paint. Everything after that comes back in the response
  // to a load, so this runs once per courier and never again.
  useEffect(() => {
    let live = true;

    fetch(`/api/admin/couriers/barcodes?courier_id=${encodeURIComponent(courierId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (live && data) setStock(data as Stock);
      })
      .catch(() => {
        // A count that will not load is not worth an error on this screen; the
        // panel says nothing until it does.
      });

    return () => {
      live = false;
    };
  }, [courierId]);

  async function upload(file: File) {
    setBusy(true);
    setNote(null);

    const form = new FormData();
    form.append("courier_id", courierId);
    form.append("file", file);

    try {
      const res = await fetch("/api/admin/couriers/barcodes", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setNote({ text: data.error ?? "Could not read that file.", bad: true });
        return;
      }

      setStock(data.stock ?? null);
      setNote({
        text:
          (data.message ?? "Loaded.") +
          (data.skipped?.length ? ` Skipped: ${data.skipped.join("; ")}` : ""),
      });
    } catch {
      setNote({ text: "Upload failed — check your connection.", bad: true });
    } finally {
      setBusy(false);
    }
  }

  async function typeIn() {
    setBusy(true);
    setNote(null);

    try {
      const res = await fetch("/api/admin/couriers/barcodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courier_id: courierId, from: range.from, to: range.to }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setNote({ text: data.error ?? "Could not save that range.", bad: true });
        return;
      }

      setStock(data.stock ?? null);
      setNote({ text: data.message ?? "Loaded." });
      setRange({ from: "", to: "" });
      setTyping(false);
    } catch {
      setNote({ text: "Save failed — check your connection.", bad: true });
    } finally {
      setBusy(false);
    }
  }

  const unused = stock?.unused ?? 0;
  const low = !!stock && unused < LOW;

  return (
    <div className="mt-4 rounded-xl border border-neutral-200 bg-neutral-50/70 p-4">
      <p className="text-xs font-medium text-neutral-700 flex items-center gap-1.5">
        <ScanLine className="w-3.5 h-3.5" />
        Article numbers for {courierName}
      </p>

      <p className="text-[11px] text-neutral-500 mt-1">
        India Post allots these in blocks. One is spent on every parcel — and
        never returned, even if the booking fails — so the count only goes down.
      </p>

      {/* The count, and the warning that matters more than the count. */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span
          className={`px-2.5 py-1 rounded-lg text-sm font-semibold ${
            low
              ? "bg-amber-50 text-amber-800 border border-amber-200"
              : "bg-white text-neutral-800 border border-neutral-200"
          }`}
        >
          {stock ? unused.toLocaleString("en-IN") : "—"} left
        </span>

        {stock && stock.allotted > 0 && (
          <span className="text-[11px] text-neutral-500">
            of {stock.allotted.toLocaleString("en-IN")} ever allotted
            {stock.openRanges > 1 && `, across ${stock.openRanges} ranges`}
          </span>
        )}

        {low && (
          <span className="flex items-center gap-1 text-[11px] font-semibold text-amber-800">
            <AlertTriangle className="w-3.5 h-3.5" />
            {unused === 0
              ? "None left — no Speed Post parcel can be booked until a range is loaded."
              : "Ask India Post for the next block now."}
          </span>
        )}
      </div>

      {/* ── Loading the next allotment ────────────────────────────────────── */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold cursor-pointer transition-colors ${
            busy
              ? "border-neutral-200 text-neutral-400 cursor-not-allowed"
              : "border-primary-500 bg-primary-500 text-white hover:bg-primary-600"
          }`}
          title="The Export to Excel from Barcode Management System → Allocated Barcodes"
        >
          {busy ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Upload className="w-3.5 h-3.5" />
          )}
          {busy ? "Reading…" : "Upload allotment file"}
          <input
            type="file"
            accept=".xlsx,.xls,.csv,.txt"
            disabled={busy}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              // Cleared so choosing the same file twice fires the change event
              // again — a failed import is usually retried with the same file.
              e.target.value = "";
              if (file) upload(file);
            }}
          />
        </label>

        <button
          onClick={() => setTyping(!typing)}
          disabled={busy}
          className="px-3 py-1.5 rounded-lg border border-neutral-200 text-xs text-neutral-600 hover:border-neutral-400 transition-colors disabled:opacity-40"
        >
          {typing ? "Cancel" : "Type the range instead"}
        </button>
      </div>

      <p className="text-[11px] text-neutral-500 mt-2">
        The file from the portal: Barcode Management System → Allocated Barcodes
        → Export to Excel. Every article number in it is read, whichever column
        it is in.
      </p>

      {/* The fallback, for an allotment that arrived as a letter rather than a
          file. Second, and plainly second: this is the input where a wrong
          digit cannot be caught. */}
      {typing && (
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto] items-end">
          <div>
            <label className="text-[11px] font-medium text-neutral-500 mb-1 block">
              First number
            </label>
            <input
              value={range.from}
              onChange={(e) => setRange({ ...range, from: e.target.value })}
              placeholder="ET21433001IN"
              className="w-full bg-white border border-neutral-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary-500 transition-colors"
            />
          </div>
          <div>
            <label className="text-[11px] font-medium text-neutral-500 mb-1 block">
              Last number
            </label>
            <input
              value={range.to}
              onChange={(e) => setRange({ ...range, to: e.target.value })}
              placeholder="ET21434000IN"
              className="w-full bg-white border border-neutral-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary-500 transition-colors"
            />
          </div>
          <button
            onClick={typeIn}
            disabled={busy || !range.from || !range.to}
            className="px-3 py-2 rounded-lg bg-neutral-800 text-white text-xs font-semibold hover:bg-neutral-900 disabled:opacity-40 transition-colors"
          >
            Save range
          </button>
        </div>
      )}

      {note && (
        <p
          className={`text-[11px] mt-3 flex items-start gap-1.5 ${
            note.bad ? "text-red-600" : "text-emerald-700"
          }`}
        >
          {note.bad ? (
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
          ) : (
            <Check className="w-3.5 h-3.5 shrink-0 mt-px" />
          )}
          {note.text}
        </p>
      )}
    </div>
  );
}

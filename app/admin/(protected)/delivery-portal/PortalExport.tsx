"use client";

import { useState } from "react";
import { FileSpreadsheet, Loader2 } from "lucide-react";
import { COURIER_SHEET_MAX } from "@/lib/courier-sheet";

/**
 * Download the ticked parcels as the courier's upload sheet.
 *
 * The button owns the request and nothing else: which parcels are on it is the
 * grid's business, and what happens to them afterwards is handled by `onDone`.
 *
 * Downloading confirms the batch — the file IS the addresses going into the
 * courier's system — so the rows it returns are the ones now ticked Confirmed.
 * That can be fewer than were picked, when a parcel was sheeted up on another
 * screen while this page sat open, and saying so is more use than a silent
 * count.
 */
export default function PortalExport({
  orderNumbers,
  onDone,
}: {
  orderNumbers: string[];
  /** The parcels that made it onto the sheet, now entered with the courier. */
  onDone: (confirmed: string[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);

  async function download() {
    setBusy(true);
    setNote(null);

    try {
      const res = await fetch("/api/admin/delivery/courier-sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_numbers: orderNumbers }),
      });

      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "Download failed" }));
        setNote({ text: error ?? "Download failed", bad: true });
        return;
      }

      const confirmed = (res.headers.get("X-Confirmed") ?? "")
        .split(",")
        .filter(Boolean);

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download =
        res.headers.get("Content-Disposition")?.match(/filename="(.+?)"/)?.[1] ??
        "courier.xlsx";
      a.click();
      URL.revokeObjectURL(url);

      const missed = orderNumbers.length - confirmed.length;
      setNote({
        text:
          `${confirmed.length} parcel${confirmed.length === 1 ? "" : "s"} downloaded and ticked Confirmed.` +
          (missed > 0
            ? ` ${missed} skipped — already with the courier.`
            : ""),
      });
      onDone(confirmed);
    } catch {
      setNote({ text: "Download failed — check your connection.", bad: true });
    } finally {
      setBusy(false);
    }
  }

  const none = orderNumbers.length === 0;

  return (
    <>
      <button
        onClick={download}
        disabled={busy || none}
        title={
          none
            ? `Tick up to ${COURIER_SHEET_MAX} new parcels to put on a sheet`
            : `Download ${orderNumbers.length} parcel${orderNumbers.length === 1 ? "" : "s"} as the courier's upload sheet — and tick them Confirmed`
        }
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-600 bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 hover:border-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
      >
        {busy ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <FileSpreadsheet className="w-3.5 h-3.5" />
        )}
        {busy ? "Preparing…" : `Download Excel${none ? "" : ` (${orderNumbers.length})`}`}
      </button>

      {note && (
        <span className={`text-xs ${note.bad ? "text-red-600" : "text-emerald-700"}`}>
          {note.text}
        </span>
      )}
    </>
  );
}

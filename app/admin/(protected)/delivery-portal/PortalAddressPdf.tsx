"use client";

import { useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import { COURIER_SHEET_MAX } from "@/lib/courier-sheet";

/**
 * Download the ticked parcels as a printable A4 address sheet.
 *
 * The paper sibling of PortalExport, and deliberately without its `onDone`:
 * downloading the Excel confirms a batch, because that file is the addresses
 * going into the courier's system. This is a page somebody carries to a shelf.
 * Nothing changes when it is printed, so nothing has to be told about it — and
 * reprinting is the normal case rather than an error to recover from.
 *
 * Outlined rather than filled, next to the Excel button: two solid buttons side
 * by side would ask which one is the action, and the Excel still is.
 */
export default function PortalAddressPdf({ orderNumbers }: { orderNumbers: string[] }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);

  async function download() {
    setBusy(true);
    setNote(null);

    try {
      const res = await fetch("/api/admin/delivery/address-sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_numbers: orderNumbers }),
      });

      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "Download failed" }));
        setNote({ text: error ?? "Download failed", bad: true });
        return;
      }

      const printed = Number(res.headers.get("X-Addresses") ?? orderNumbers.length);
      const pages = Number(res.headers.get("X-Pages") ?? 1);

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download =
        res.headers.get("Content-Disposition")?.match(/filename="(.+?)"/)?.[1] ??
        "addresses.pdf";
      a.click();
      URL.revokeObjectURL(url);

      // Says how many sheets are about to come out of the printer, because
      // that is the thing somebody is about to be surprised by.
      setNote({
        text: `${printed} address${printed === 1 ? "" : "es"} on ${pages} page${
          pages === 1 ? "" : "s"
        }.`,
      });
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
            ? `Tick up to ${COURIER_SHEET_MAX} parcels to print their addresses`
            : `Print ${orderNumbers.length} address${
                orderNumbers.length === 1 ? "" : "es"
              } — 10 to an A4 page. Changes nothing.`
        }
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-300 bg-white text-neutral-700 text-xs font-semibold hover:bg-neutral-50 hover:border-neutral-400 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
      >
        {busy ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <FileText className="w-3.5 h-3.5" />
        )}
        {busy ? "Preparing…" : `Print PDF${none ? "" : ` (${orderNumbers.length})`}`}
      </button>

      {note && (
        <span className={`text-xs ${note.bad ? "text-red-600" : "text-neutral-500"}`}>
          {note.text}
        </span>
      )}
    </>
  );
}

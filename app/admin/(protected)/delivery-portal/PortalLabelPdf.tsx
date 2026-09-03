"use client";

import { useState } from "react";
import { Tag, Loader2 } from "lucide-react";
import { COURIER_SHEET_MAX } from "@/lib/courier-sheet";

/**
 * Download the ticked parcels as 4x6 thermal labels, one to a page.
 *
 * The sibling of PortalAddressPdf, and the one to reach for when a label
 * printer is loaded: that button prints ten addresses on an A4 sheet to be cut
 * up with scissors, this prints what actually goes on the parcel.
 *
 * Changes nothing, exactly like the A4 button — reprinting a label is normal
 * (they jam, they smudge, they come off) rather than an error to recover from.
 */
export default function PortalLabelPdf({ orderNumbers }: { orderNumbers: string[] }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);

  async function download() {
    setBusy(true);
    setNote(null);

    try {
      const res = await fetch("/api/admin/delivery/portal-labels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_numbers: orderNumbers }),
      });

      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "Download failed" }));
        setNote({ text: error ?? "Download failed", bad: true });
        return;
      }

      const printed = Number(res.headers.get("X-Label-Count") ?? orderNumbers.length);
      const missing = Number(res.headers.get("X-Missing-Barcode") ?? 0);

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download =
        res.headers.get("Content-Disposition")?.match(/filename="(.+?)"/)?.[1] ??
        "labels.pdf";
      a.click();
      URL.revokeObjectURL(url);

      // A label with no barcode is the one outcome worth interrupting for: it
      // prints and looks finished, and the counter cannot scan it. Said in
      // amber, with the count, so the agent can allot the missing numbers and
      // print again before carrying the stack anywhere.
      if (missing) {
        setNote({
          text: `${printed} label${printed === 1 ? "" : "s"} — but ${missing} ${
            missing === 1 ? "has" : "have"
          } no article number, so ${
            missing === 1 ? "its barcode is" : "their barcodes are"
          } blank. Allot the numbers and print those again.`,
          bad: true,
        });
        return;
      }

      // One page per label, always: this route prints no packing slips, so
      // the stack coming out is exactly as long as the list that went in.
      setNote({ text: `${printed} label${printed === 1 ? "" : "s"}, one per page.` });
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
            ? `Tick up to ${COURIER_SHEET_MAX} parcels to print their labels`
            : `Print ${orderNumbers.length} label${
                orderNumbers.length === 1 ? "" : "s"
              } at 4x6 inches, one per page, for a thermal label printer. No packing slips. Changes nothing.`
        }
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-300 bg-white text-neutral-700 text-xs font-semibold hover:bg-neutral-50 hover:border-neutral-400 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
      >
        {busy ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Tag className="w-3.5 h-3.5" />
        )}
        {busy ? "Preparing…" : `Labels 4×6${none ? "" : ` (${orderNumbers.length})`}`}
      </button>

      {note && (
        <span className={`text-xs ${note.bad ? "text-red-600" : "text-neutral-500"}`}>
          {note.text}
        </span>
      )}
    </>
  );
}

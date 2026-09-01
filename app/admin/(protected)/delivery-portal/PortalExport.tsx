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
 * That can be fewer than were picked, and for two different reasons that need
 * telling apart: a parcel sheeted up on another screen while this page sat
 * open is gone and needs nothing, while a parcel India Post would refuse is
 * still here, still unconfirmed, and waiting on somebody to shorten an
 * address. Both are more use than a silent count.
 */
interface SkipReason {
  order: string;
  problems: string[];
}

/** The per-parcel reasons, which travel URI-encoded because a header is ASCII. */
function readWhy(header: string | null): SkipReason[] {
  if (!header) return [];
  try {
    const parsed = JSON.parse(decodeURIComponent(header));
    return Array.isArray(parsed) ? (parsed as SkipReason[]) : [];
  } catch {
    // A note that cannot be decoded must not cost the agent the count and the
    // order numbers, which are in their own header and are the actionable half.
    return [];
  }
}

/**
 * The reasons, short enough to sit on one line under the button.
 *
 * Two spelled out and the rest counted: the first two are what somebody acts
 * on now, and a wall of forty is read as an error rather than a to-do list.
 */
function describe(why: SkipReason[], skipped: string[]): string {
  if (!why.length) return skipped.join(", ") + ".";

  const shown = why
    .slice(0, 2)
    .map((w) => `${w.order} — ${w.problems.join(", ")}`)
    .join("; ");
  const rest = skipped.length - Math.min(2, why.length);

  return shown + (rest > 0 ? `; and ${rest} more.` : ".");
}

export default function PortalExport({
  orderNumbers,
  onDone,
}: {
  orderNumbers: string[];
  /**
   * The parcels that made it onto the sheet and are now entered with the
   * courier, and the ones India Post would have refused — which are unchanged
   * and still need picking up.
   */
  onDone: (confirmed: string[], skipped: string[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; tone?: "warn" | "bad" } | null>(null);

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
        setNote({ text: error ?? "Download failed", tone: "bad" });
        return;
      }

      const confirmed = (res.headers.get("X-Confirmed") ?? "")
        .split(",")
        .filter(Boolean);

      // Left off the file because India Post would refuse the row. Still here,
      // still unconfirmed — so they are named, not counted.
      const skipped = (res.headers.get("X-Skipped") ?? "").split(",").filter(Boolean);
      const why = readWhy(res.headers.get("X-Skipped-Why"));

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download =
        res.headers.get("Content-Disposition")?.match(/filename="(.+?)"/)?.[1] ??
        "courier.xlsx";
      a.click();
      URL.revokeObjectURL(url);

      // Anything that neither made the file nor was refused for its address
      // was picked up by another screen before this request ran.
      const elsewhere = orderNumbers.length - confirmed.length - skipped.length;

      setNote({
        text:
          `${confirmed.length} parcel${confirmed.length === 1 ? "" : "s"} downloaded and ticked Confirmed.` +
          (elsewhere > 0 ? ` ${elsewhere} skipped — already with the courier.` : "") +
          (skipped.length
            ? ` ${skipped.length} left unconfirmed — India Post would refuse ` +
              `${skipped.length === 1 ? "it" : "them"}: ${describe(why, skipped)}`
            : ""),
        tone: skipped.length ? "warn" : undefined,
      });

      // The refused parcels stay ticked, so the address can be fixed and the
      // same selection downloaded again without picking them out a second time.
      onDone(confirmed, skipped);
    } catch {
      setNote({ text: "Download failed — check your connection.", tone: "bad" });
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
        <span
          className={`text-xs ${
            note.tone === "bad"
              ? "text-red-600"
              : note.tone === "warn"
                ? "text-amber-700"
                : "text-emerald-700"
          }`}
        >
          {note.text}
        </span>
      )}
    </>
  );
}

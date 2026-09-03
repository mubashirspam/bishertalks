"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Download, Loader2 } from "lucide-react";

/**
 * The filtered report, as a spreadsheet.
 *
 * Sends the page's own query string and nothing else, so there is no second
 * copy of the filter logic to fall out of step with the screen — change a chip
 * and the next download follows it, with nothing here needing to know that the
 * chip exists. It is the same contract `ContactDownload` has on the delivery
 * portal, and the reason both files are this short.
 *
 * Downloading changes nothing: no parcel is ticked, nothing goes to a courier,
 * and pressing it twice produces the same file.
 */
export default function ReportDownload() {
  const params = useSearchParams();
  const [busy, setBusy] = useState<"xlsx" | "csv" | null>(null);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);

  async function download(format: "xlsx" | "csv") {
    setBusy(format);
    setNote(null);

    try {
      const qs = new URLSearchParams(params.toString());
      // The file is every matching parcel, not the page being looked at.
      qs.delete("page");
      qs.set("format", format);

      const res = await fetch(`/api/admin/reports/parcels?${qs}`);

      if (!res.ok) {
        const { error } = await res
          .json()
          .catch(() => ({ error: "Download failed" }));
        setNote({ text: error ?? "Download failed", bad: true });
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download =
        res.headers.get("Content-Disposition")?.match(/filename="(.+?)"/)?.[1] ??
        `parcels.${format}`;
      a.click();
      URL.revokeObjectURL(url);

      // How many rows landed in the file, so nobody has to open it to find out
      // whether the filters caught anything.
      const rows = res.headers.get("X-Row-Count");
      const partial = res.headers.get("X-Truncated") === "1";
      setNote({
        text: partial
          ? `${rows} rows — the ceiling was reached, so this file is partial. Narrow the dates.`
          : `${rows ?? "All"} rows downloaded`,
        bad: partial,
      });
    } catch {
      setNote({ text: "Download failed", bad: true });
    } finally {
      setBusy(null);
    }
  }

  const btn =
    "flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-medium transition-all disabled:opacity-50";

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <button
          onClick={() => download("xlsx")}
          disabled={busy !== null}
          title="Every matching parcel, plus a Summary tab with the counts above"
          className={`${btn} bg-neutral-900 border-neutral-900 text-white hover:bg-neutral-800`}
        >
          {busy === "xlsx" ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Download className="w-3.5 h-3.5" />
          )}
          Excel
        </button>
        <button
          onClick={() => download("csv")}
          disabled={busy !== null}
          title="The rows only, as CSV"
          className={`${btn} bg-white border-neutral-200 text-neutral-600 hover:border-neutral-400 hover:text-neutral-900`}
        >
          {busy === "csv" ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Download className="w-3.5 h-3.5" />
          )}
          CSV
        </button>
      </div>

      {note && (
        <p className={`text-[11px] ${note.bad ? "text-rose-600" : "text-neutral-500"}`}>
          {note.text}
        </p>
      )}
    </div>
  );
}

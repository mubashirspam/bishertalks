"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Download, Loader2 } from "lucide-react";

/**
 * "Download Excel" for whatever the page is currently filtered to.
 *
 * It sends the page's own query string and nothing else, so there is no second
 * copy of the filter logic to fall out of step with the screen — change a chip
 * and the next download follows it, with nothing here needing to know that the
 * chip exists.
 *
 * Downloading changes nothing. No parcel is ticked, nothing is handed to a
 * courier, and pressing it twice produces the same file — which is what makes
 * it safe to sit in the corner of a screen people work in all day, next to a
 * button that very much does confirm a batch.
 */
export default function ContactDownload({
  mode = "portal",
  label = "Download Excel",
  title = "Download the filtered parcels — name, mobile, reference, order number, pincode, courier status and waybill",
}: {
  /** Which scope the API should read. See the route for what each may see. */
  mode?: "portal" | "breakdown";
  label?: string;
  title?: string;
}) {
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);

  async function download() {
    setBusy(true);
    setNote(null);

    try {
      const qs = new URLSearchParams(params.toString());
      // The export is every matching parcel, not the page being looked at.
      qs.delete("page");
      qs.set("mode", mode);

      const res = await fetch(`/api/admin/delivery/contact-export?${qs.toString()}`);

      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "Download failed" }));
        setNote({ text: error ?? "Download failed", bad: true });
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download =
        res.headers.get("Content-Disposition")?.match(/filename="(.+?)"/)?.[1] ??
        "parcels.xlsx";
      a.click();
      URL.revokeObjectURL(url);

      const n = res.headers.get("X-Parcel-Count") ?? "";
      setNote({ text: `${n} parcel${n === "1" ? "" : "s"} downloaded.` });
    } catch {
      setNote({ text: "Download failed — check your connection.", bad: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex items-center gap-2">
      {note && (
        <span className={`text-xs ${note.bad ? "text-red-600" : "text-neutral-500"}`}>
          {note.text}
        </span>
      )}
      <button
        onClick={download}
        disabled={busy}
        title={title}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-300 bg-white text-xs font-semibold text-neutral-700 hover:border-neutral-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all whitespace-nowrap"
      >
        {busy ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Download className="w-3.5 h-3.5" />
        )}
        {busy ? "Preparing…" : label}
      </button>
    </span>
  );
}

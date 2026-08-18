"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, X, AlertCircle, Check, Loader2 } from "lucide-react";

/**
 * KKR's daily report of what they could not send by Delhivery.
 *
 * Always previews before it writes. The file is one we did not design,
 * describing parcels we cannot verify against the courier, so it must not be
 * able to move a customer's order without somebody having read the plan — and
 * the plan is worth reading, because the same upload can change a status,
 * which messages the customer.
 *
 * CSV or pasted rows rather than .xlsx: an .xlsx is a ZIP of XML documents,
 * and reading one properly means a dependency and a parser to maintain for a
 * file that Excel exports as CSV in one click. The plainer format is also the
 * one a person can check by eye before uploading it.
 */
export default function ExceptionImport() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    willUpdate: number;
    matched: Record<string, string>;
    ignored: string[];
    unmatched: { key: string; why: string }[];
    plan: {
      order_number: string;
      buyer_name: string | null;
      mode: string | null;
      tracking: string | null;
      from_status: string;
      to_status: string | null;
      note: string | null;
    }[];
  } | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const send = async (apply: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/delivery/exception-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, apply }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || data.error) {
        setError(data.error ?? "Could not read that file.");
        setPreview(null);
        return;
      }

      if (apply) {
        const moves = Object.entries(data.statusChanges ?? {})
          .map(([k, v]) => `${v} → ${k}`)
          .join(", ");
        setDone(`${data.updated} order(s) updated${moves ? ` · ${moves}` : ""}`);
        setPreview(null);
        setText("");
        setOpen(false);
        router.refresh();
      } else {
        setPreview(data);
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  const readFile = async (file: File) => {
    setDone(null);
    if (/\.xlsx?$/i.test(file.name) && !/\.csv$/i.test(file.name)) {
      setError(
        `"${file.name}" is an Excel file. Open it, choose File → Save As → CSV, ` +
          "and upload that — or just copy the rows and paste them below."
      );
      return;
    }
    setText(await file.text());
    setError(null);
  };

  if (!open) {
    return (
      <div className="flex items-center gap-3">
        <button
          onClick={() => { setOpen(true); setDone(null); }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-300 text-xs font-medium text-neutral-700 hover:border-neutral-500 transition-colors"
        >
          <Upload className="w-3.5 h-3.5" /> Upload KKR report
        </button>
        {done && (
          <span className="text-xs text-green-700 flex items-center gap-1">
            <Check className="w-3.5 h-3.5" /> {done}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="bg-white border border-neutral-200 rounded-2xl p-5 shadow-sm mb-4">
      <div className="flex items-start justify-between mb-3 gap-4">
        <div>
          <h2 className="font-semibold text-sm text-neutral-900">
            KKR&apos;s report — parcels sent another way
          </h2>
          <p className="text-xs text-neutral-500 mt-1 max-w-2xl leading-relaxed">
            The daily list of orders KKR could not send by Delhivery. Needs a
            column naming the order (order number or reference) and at least one
            of: the service used, a tracking number, or a status. Column names
            can be whatever KKR uses.
          </p>
        </div>
        <button onClick={() => setOpen(false)} className="text-neutral-400 hover:text-neutral-900">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-3">
        <input
          type="file"
          accept=".csv,text/csv,text/plain"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void readFile(f); }}
          className="text-xs file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border file:border-neutral-300 file:bg-white file:text-xs file:font-medium file:cursor-pointer"
        />
        <span className="text-xs text-neutral-400">or paste the rows below</span>
      </div>

      <textarea
        value={text}
        onChange={(e) => { setText(e.target.value); setPreview(null); setError(null); }}
        rows={6}
        placeholder={"Order No,Mode,Tracking,Status\nORD-ABUHX7,India Post,EK123456789IN,Shipped"}
        className="w-full font-mono text-xs bg-neutral-50 border border-neutral-300 rounded-xl px-3 py-2 focus:outline-none focus:border-primary-500 focus:bg-white transition-colors resize-y"
      />

      {error && (
        <p className="mt-3 flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> {error}
        </p>
      )}

      {preview && (
        <div className="mt-4 border border-neutral-200 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 bg-neutral-50 border-b border-neutral-200 text-xs">
            <strong className="text-neutral-900">{preview.willUpdate}</strong> order(s) would change
            {preview.unmatched.length > 0 && (
              <span className="text-amber-700"> · {preview.unmatched.length} row(s) match no order</span>
            )}
            <span className="text-neutral-400">
              {" "}· read as: {Object.entries(preview.matched).map(([k, v]) => `${k}="${v}"`).join(", ")}
            </span>
          </div>

          <div className="overflow-x-auto max-h-64">
            <table className="w-full text-xs">
              <thead className="bg-white sticky top-0">
                <tr className="text-left border-b border-neutral-200">
                  {["Order", "Customer", "Sent by", "Tracking", "Status"].map((h) => (
                    <th key={h} className="px-3 py-2 font-semibold text-neutral-500 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.plan.map((p) => (
                  <tr key={p.order_number} className="border-b border-neutral-100 last:border-0">
                    <td className="px-3 py-1.5 font-mono">{p.order_number}</td>
                    <td className="px-3 py-1.5">{p.buyer_name ?? "—"}</td>
                    <td className="px-3 py-1.5">{p.mode ?? <span className="text-neutral-300">unchanged</span>}</td>
                    <td className="px-3 py-1.5 font-mono">{p.tracking ?? <span className="text-neutral-300">—</span>}</td>
                    <td className="px-3 py-1.5">
                      {p.to_status ? (
                        <span className="text-green-700">{p.from_status} → {p.to_status}</span>
                      ) : (
                        <span className="text-neutral-400">{p.from_status}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {preview.unmatched.length > 0 && (
            <p className="px-4 py-2 text-xs text-amber-800 bg-amber-50 border-t border-amber-200">
              Not found here: {preview.unmatched.slice(0, 8).map((u) => u.key).join(", ")}
              {preview.unmatched.length > 8 && ` and ${preview.unmatched.length - 8} more`}. These are skipped.
            </p>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 mt-4">
        <button
          onClick={() => send(false)}
          disabled={!text.trim() || busy}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-neutral-300 text-xs font-semibold text-neutral-700 hover:border-neutral-500 disabled:opacity-40 transition-colors"
        >
          {busy && !preview ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
          Check the file
        </button>

        {preview && preview.willUpdate > 0 && (
          <button
            onClick={() => send(true)}
            disabled={busy}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary-500 hover:bg-primary-600 text-white text-xs font-semibold disabled:opacity-40 transition-colors"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            Apply to {preview.willUpdate} order{preview.willUpdate === 1 ? "" : "s"}
          </button>
        )}
      </div>
    </div>
  );
}

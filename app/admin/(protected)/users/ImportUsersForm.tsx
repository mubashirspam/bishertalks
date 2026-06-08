"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, X, FileSpreadsheet, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";

interface ParsedRow {
  name: string;
  email: string;
  phone: string;
}

interface CourseOption {
  slug: string;
  title: string;
}

interface ImportSummary {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  granted: number;
}

interface RowResult {
  row: number;
  phone: string;
  name: string;
  status: "created" | "updated" | "skipped";
  reason?: string;
}

const BATCH_SIZE = 15;

/** Minimal RFC-4180-ish CSV parser: handles quoted fields, commas and newlines. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      // End the row on \n; swallow \r\n pairs.
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  // Flush the trailing field/row if the file didn't end with a newline.
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

function findColumn(headers: string[], keywords: string[]): number {
  return headers.findIndex((h) =>
    keywords.some((k) => h.toLowerCase().includes(k))
  );
}

export default function ImportUsersForm({ courses }: { courses: CourseOption[] }) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [courseSlug, setCourseSlug] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [done, setDone] = useState(0);
  const [live, setLive] = useState<RowResult[]>([]);

  const reset = () => {
    setRows([]);
    setFileName("");
    setError("");
    setSummary(null);
    setDone(0);
    setLive([]);
    if (fileInput.current) fileInput.current.value = "";
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setError("");
    setSummary(null);
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);

    try {
      const text = await file.text();
      const table = parseCsv(text);
      if (table.length < 2) {
        setError("CSV looks empty or has no data rows.");
        setRows([]);
        return;
      }
      const headers = table[0];
      const nameCol = findColumn(headers, ["name"]);
      const emailCol = findColumn(headers, ["email", "mail"]);
      const phoneCol = findColumn(headers, ["phone", "mobile", "number"]);

      if (phoneCol === -1) {
        setError('Could not find a "Phone" column in the CSV.');
        setRows([]);
        return;
      }

      const parsed: ParsedRow[] = table.slice(1).map((r) => ({
        name: nameCol > -1 ? (r[nameCol] || "").trim() : "",
        email: emailCol > -1 ? (r[emailCol] || "").trim() : "",
        phone: (r[phoneCol] || "").trim(),
      }));

      setRows(parsed);
    } catch {
      setError("Failed to read the file.");
      setRows([]);
    }
  };

  const submit = async () => {
    if (!rows.length) return;
    setLoading(true);
    setError("");
    setSummary(null);
    setDone(0);
    setLive([]);

    // Send in small batches so the admin sees live progress instead of one
    // long blocking wait. Totals are accumulated across batches.
    const agg: ImportSummary = {
      total: rows.length,
      created: 0,
      updated: 0,
      skipped: 0,
      granted: 0,
    };

    try {
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const chunk = rows.slice(i, i + BATCH_SIZE);
        const res = await fetch("/api/admin/users/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows: chunk, courseSlug: courseSlug || undefined }),
        });
        const data = await res.json();
        if (!data.success) {
          setError(data.error || "Import failed.");
          setLoading(false);
          return;
        }
        agg.created += data.summary.created;
        agg.updated += data.summary.updated;
        agg.skipped += data.summary.skipped;
        agg.granted += data.summary.granted;

        // Re-number rows so the live log reflects the whole file, not the chunk.
        const chunkResults = (data.results as RowResult[]).map((r) => ({
          ...r,
          row: i + r.row,
        }));
        setLive((prev) => [...prev, ...chunkResults]);
        setDone(i + chunk.length);
      }
      setSummary(agg);
      router.refresh();
    } catch {
      setError("Something went wrong. Some users may already be imported.");
    } finally {
      setLoading(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white border border-neutral-300 hover:border-neutral-400 text-neutral-700 text-sm font-semibold transition-all"
      >
        <Upload className="w-4 h-4" /> Import CSV
      </button>
    );
  }

  const valid = rows.filter((r) => /^[6-9]\d{9}$/.test(r.phone.replace(/\D/g, ""))).length;
  const invalid = rows.length - valid;
  const pending = rows.length - done;
  const pct = rows.length ? Math.round((done / rows.length) * 100) : 0;

  // Live, scrollable log of each processed row (newest first).
  const liveLog = live.length > 0 && (
    <div className="border border-neutral-200 rounded-xl divide-y divide-neutral-100 max-h-48 overflow-y-auto text-xs">
      {[...live].reverse().map((r) => (
        <div key={r.row} className="flex items-center justify-between gap-3 px-3 py-1.5">
          <span className="truncate text-neutral-700">
            <span className="text-neutral-400 mr-1.5">#{r.row}</span>
            {r.name || "—"}{" "}
            <span className="text-neutral-400 font-mono">{r.phone}</span>
          </span>
          <span
            className={`shrink-0 font-medium ${
              r.status === "created"
                ? "text-green-600"
                : r.status === "updated"
                ? "text-blue-600"
                : "text-amber-600"
            }`}
          >
            {r.status === "created"
              ? "Added"
              : r.status === "updated"
              ? "Updated"
              : r.reason || "Skipped"}
          </span>
        </div>
      ))}
    </div>
  );

  return (
    <div className="bg-white border border-neutral-200 rounded-2xl p-5 w-full shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-sm text-neutral-900">Import Users from CSV</h3>
        <button
          onClick={() => {
            reset();
            setOpen(false);
          }}
          className="text-neutral-400 hover:text-neutral-900"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {summary ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-green-700">
            <CheckCircle2 className="w-5 h-5" />
            <span className="font-semibold text-sm">Import complete</span>
          </div>
          <ul className="text-sm text-neutral-700 space-y-1">
            <li>{summary.created} new user{summary.created !== 1 ? "s" : ""} created</li>
            <li>{summary.updated} existing user{summary.updated !== 1 ? "s" : ""} updated</li>
            {summary.granted > 0 && <li>{summary.granted} course access grant{summary.granted !== 1 ? "s" : ""}</li>}
            {summary.skipped > 0 && (
              <li className="text-amber-600">{summary.skipped} row{summary.skipped !== 1 ? "s" : ""} skipped (invalid phone)</li>
            )}
          </ul>
          {liveLog}
          <div className="flex gap-2 pt-1">
            <button
              onClick={reset}
              className="px-4 py-2 rounded-xl bg-primary-500 hover:bg-primary-600 text-white text-sm font-semibold transition-all"
            >
              Import another file
            </button>
            <button
              onClick={() => {
                reset();
                setOpen(false);
              }}
              className="px-4 py-2 rounded-xl bg-white border border-neutral-300 hover:border-neutral-400 text-neutral-700 text-sm font-semibold transition-all"
            >
              Done
            </button>
          </div>
        </div>
      ) : loading ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-neutral-900">
            <Loader2 className="w-4 h-4 animate-spin text-primary-500" />
            <span className="font-semibold text-sm">
              Importing… {done} of {rows.length}
            </span>
          </div>

          {/* Progress bar */}
          <div className="h-2 w-full rounded-full bg-neutral-100 overflow-hidden">
            <div
              className="h-full bg-primary-500 transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <span className="text-neutral-500">{pct}% done</span>
            <span className="text-amber-600">{pending} pending</span>
            <span className="text-green-600">{live.filter((r) => r.status === "created").length} added</span>
            <span className="text-blue-600">{live.filter((r) => r.status === "updated").length} updated</span>
            {live.some((r) => r.status === "skipped") && (
              <span className="text-amber-600">
                {live.filter((r) => r.status === "skipped").length} skipped
              </span>
            )}
          </div>

          {liveLog}
          <p className="text-[11px] text-neutral-400">
            Keep this open until it finishes — don&apos;t close the tab.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-neutral-500">
            CSV should have <span className="font-medium text-neutral-700">Name</span>,{" "}
            <span className="font-medium text-neutral-700">Email</span> and{" "}
            <span className="font-medium text-neutral-700">Phone</span> columns. Users are matched
            by phone number — existing users are updated, not duplicated.
          </p>

          <label className="flex items-center gap-3 border border-dashed border-neutral-300 rounded-xl px-4 py-3 cursor-pointer hover:border-primary-400 transition-colors">
            <FileSpreadsheet className="w-5 h-5 text-neutral-400" />
            <span className="text-sm text-neutral-600">
              {fileName || "Choose a .csv file…"}
            </span>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              onChange={onFile}
              className="hidden"
            />
          </label>

          {rows.length > 0 && (
            <div className="text-xs text-neutral-600 flex items-center gap-3">
              <span>{rows.length} row{rows.length !== 1 ? "s" : ""}</span>
              <span className="text-green-600">{valid} valid</span>
              {invalid > 0 && (
                <span className="text-amber-600 inline-flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" /> {invalid} invalid phone
                </span>
              )}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-neutral-600 mb-1.5">
              Grant course access (optional)
            </label>
            <select
              value={courseSlug}
              onChange={(e) => setCourseSlug(e.target.value)}
              className="w-full bg-white border border-neutral-300 rounded-xl px-4 py-2.5 text-sm text-neutral-900 focus:outline-none focus:border-primary-500"
            >
              <option value="">No course — just register users</option>
              {courses.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.title}
                </option>
              ))}
            </select>
          </div>

          {error && <p className="text-red-600 text-xs">{error}</p>}

          <button
            onClick={submit}
            disabled={loading || valid === 0}
            className="w-full py-2.5 rounded-full bg-primary-500 hover:bg-primary-600 disabled:opacity-60 text-white font-bold text-sm transition-all"
          >
            {loading
              ? "Importing…"
              : valid === 0
              ? "Select a valid CSV"
              : `Import ${valid} user${valid !== 1 ? "s" : ""}${courseSlug ? " + grant access" : ""}`}
          </button>
        </div>
      )}
    </div>
  );
}

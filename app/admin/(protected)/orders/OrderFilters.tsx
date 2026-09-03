"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { useNavigation } from "@/components/admin/Revalidating";
import { Search, Download, X, FileSpreadsheet, FileText } from "lucide-react";
import { TRAFFIC_SOURCES, SOURCE_LABELS } from "@/lib/attribution";
import { FOLLOW_UP_FILTERS } from "@/lib/follow-up";

const STAGES = [
  { label: "All orders", value: "all" },
  { label: "Paid", value: "complete" },
  { label: "Payment started", value: "payment_started" },
  { label: "Payment not started", value: "lead" },
  { label: "Payment failed", value: "failed" },
  // Money actually sent back through Razorpay — not the same as a cancelled
  // order, most of which were never refunded. See migration 0055.
  { label: "Refunded", value: "refunded" },
];

/**
 * Copies in the order.
 *
 * "2 or more" is the one people actually come here for: it's the gift buyers,
 * the resellers and the trainers ordering for a batch, and they're worth a call
 * that a single-copy buyer isn't.
 */
const BOOK_COUNTS = [
  { label: "Any copies", value: "all" },
  { label: "2 or more books", value: "multi" },
  { label: "Single copy", value: "single" },
];

const PRESETS = [
  { label: "Today", days: 0 },
  { label: "7 days", days: 6 },
  { label: "30 days", days: 29 },
];

/** Today in IST as YYYY-MM-DD — the browser may be in any timezone. */
function istToday(): string {
  return new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
}
function istDaysAgo(n: number): string {
  return new Date(Date.now() + 5.5 * 3600e3 - n * 864e5).toISOString().slice(0, 10);
}

/**
 * The count is passed in as a streamed slot rather than a number, so this bar
 * can render the instant the page does instead of waiting for the query that
 * produces the total.
 */
export default function OrderFilters({ countSlot }: { countSlot?: React.ReactNode }) {
  const params = useSearchParams();
  // Shared with the table below, so it dims while these filters reload it.
  const { navigate } = useNavigation();

  const stage = params.get("stage") ?? "all";
  const source = params.get("source") ?? "all";
  const followUp = params.get("followUp") ?? "all";
  const books = params.get("books") ?? "all";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const [q, setQ] = useState(params.get("q") ?? "");

  const push = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete("page"); // any filter change invalidates the current page
    navigate(`/admin/orders?${next.toString()}`);
  };

  const exportUrl = (format: "csv" | "xlsx") => {
    const p = new URLSearchParams();
    if (stage !== "all") p.set("stage", stage);
    if (source !== "all") p.set("source", source);
    if (followUp !== "all") p.set("followUp", followUp);
    if (books !== "all") p.set("books", books);
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    if (params.get("q")) p.set("q", params.get("q")!);
    p.set("format", format);
    return `/api/admin/orders/export?${p.toString()}`;
  };

  const hasFilters =
    stage !== "all" || source !== "all" || followUp !== "all" || books !== "all" ||
    !!from || !!to || !!params.get("q");

  const field =
    "bg-white border border-neutral-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-primary-500 transition-colors";

  return (
    <div className="bg-white border border-neutral-200 rounded-2xl p-4 shadow-sm mb-5">
      <div className="flex flex-wrap items-end gap-3">
        {/* Stage */}
        <div className="min-w-[180px]">
          <label className="text-xs font-medium text-neutral-500 mb-1.5 block">Stage</label>
          <select
            value={stage}
            onChange={(e) => push({ stage: e.target.value === "all" ? null : e.target.value })}
            className={`${field} w-full cursor-pointer`}
          >
            {STAGES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>

        {/* Follow-up — the working list for everything unpaid */}
        <div className="min-w-[160px]">
          <label className="text-xs font-medium text-neutral-500 mb-1.5 block">Follow-up</label>
          <select
            value={followUp}
            onChange={(e) => push({ followUp: e.target.value === "all" ? null : e.target.value })}
            className={`${field} w-full cursor-pointer`}
          >
            {FOLLOW_UP_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
        </div>

        {/* Traffic source */}
        <div className="min-w-[150px]">
          <label className="text-xs font-medium text-neutral-500 mb-1.5 block">Came from</label>
          <select
            value={source}
            onChange={(e) => push({ source: e.target.value === "all" ? null : e.target.value })}
            className={`${field} w-full cursor-pointer`}
          >
            <option value="all">All sources</option>
            {TRAFFIC_SOURCES.map((s) => (
              <option key={s} value={s}>{SOURCE_LABELS[s]}</option>
            ))}
          </select>
        </div>

        {/* Copies — finds the bulk buyers */}
        <div className="min-w-[150px]">
          <label className="text-xs font-medium text-neutral-500 mb-1.5 block">Books</label>
          <select
            value={books}
            onChange={(e) => push({ books: e.target.value === "all" ? null : e.target.value })}
            className={`${field} w-full cursor-pointer`}
          >
            {BOOK_COUNTS.map((b) => (
              <option key={b.value} value={b.value}>{b.label}</option>
            ))}
          </select>
        </div>

        {/* Date range — IST calendar days */}
        <div>
          <label className="text-xs font-medium text-neutral-500 mb-1.5 block">From</label>
          <input
            type="date"
            value={from}
            max={to || istToday()}
            onChange={(e) => push({ from: e.target.value || null })}
            className={`${field} cursor-pointer`}
          />
        </div>
        <div>
          <label className="text-xs font-medium text-neutral-500 mb-1.5 block">To</label>
          <input
            type="date"
            value={to}
            min={from || undefined}
            max={istToday()}
            onChange={(e) => push({ to: e.target.value || null })}
            className={`${field} cursor-pointer`}
          />
        </div>

        {/* Date presets. The active one is filled in, so "why am I only seeing
            six orders?" is answerable at a glance — an applied range that looks
            identical to an unapplied one is how people conclude the data is
            missing. */}
        <div className="flex gap-1.5">
          {PRESETS.map((p) => {
            const active = !!from && from === istDaysAgo(p.days) && to === istToday();
            return (
              <button
                key={p.label}
                onClick={() =>
                  push(
                    active
                      ? { from: null, to: null }
                      : { from: istDaysAgo(p.days), to: istToday() }
                  )
                }
                title={active ? "Click again to clear" : undefined}
                className={`px-2.5 py-2 rounded-lg border text-xs transition-all ${
                  active
                    ? "border-primary-500 bg-primary-50 text-primary-700 font-semibold"
                    : "border-neutral-200 text-neutral-600 hover:border-neutral-400 hover:text-neutral-900"
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Search, count and export share one row — three half-empty rows of
          chrome above the table was most of why this screen felt tall. */}
      <div className="flex flex-wrap items-center gap-3 mt-3 pt-3 border-t border-neutral-100">
        <form
          onSubmit={(e) => { e.preventDefault(); push({ q: q || null }); }}
          className="flex-1 min-w-[180px] sm:max-w-xs"
        >
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Name, phone, order #…"
              className={`${field} w-full pl-8 py-1.5`}
            />
          </div>
        </form>

        <p className="text-xs text-neutral-500 whitespace-nowrap">{countSlot}</p>

        {hasFilters && (
          <button
            onClick={() => navigate("/admin/orders")}
            className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-900 transition-colors"
          >
            <X className="w-3 h-3" /> Clear
          </button>
        )}

        <div className="ml-auto flex items-center gap-2">
          <Download className="w-3.5 h-3.5 text-neutral-400" />
          {/* Plain links, not fetch — lets the browser handle the download. */}
          <a
            href={exportUrl("xlsx")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600 text-white text-xs font-medium hover:bg-green-700 transition-colors"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" /> Excel
          </a>
          <a
            href={exportUrl("csv")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-900 text-white text-xs font-medium hover:bg-neutral-700 transition-colors"
          >
            <FileText className="w-3.5 h-3.5" /> CSV
          </a>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { CalendarClock, X } from "lucide-react";
import { RANGES, DEFAULT_RANGE } from "./ranges";

/**
 * The log's filters, with the time window as the main one.
 *
 * Every message the shop sends or receives lands in one table — a campaign of
 * fifty writes fifty rows, the poller and the flows write more — so the
 * question that decides whether this screen loads is "how far back". It is
 * first, and it has a default, because a log that reads the table to the
 * beginning of time gets slower every week and takes the page with it.
 *
 * `datetime-local` rather than a date input: "what went out this morning" and
 * "what went out at 11" are the same question asked twice, and a date-only
 * filter can only answer the first.
 */


export default function LogFilters({
  count,
  showing,
}: {
  count: number;
  showing: number;
}) {
  const params = useSearchParams();
  const router = useRouter();

  const range = params.get("range") ?? DEFAULT_RANGE;
  const status = params.get("status") ?? "";
  const direction = params.get("direction") ?? "";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";

  const push = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete("page");
    const qs = next.toString();
    router.push(`/admin/crm/log${qs ? `?${qs}` : ""}`);
  };

  const chip = (active: boolean, tone: string) =>
    `rounded-lg border px-3 py-1.5 text-xs transition-all ${
      active
        ? `${tone} font-semibold`
        : "border-neutral-200 text-neutral-600 hover:border-neutral-400 hover:text-neutral-900"
    }`;

  const custom = !!(from || to);

  return (
    <div className="mb-4 rounded-2xl border border-neutral-200 bg-white p-3.5 shadow-sm">
      {/* ── When ──────────────────────────────────────────────────────── */}
      <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-neutral-100 pb-3">
        <CalendarClock className="h-3.5 w-3.5 text-neutral-400" />
        <span className="text-xs font-medium text-neutral-500">When</span>

        {RANGES.map((r) => (
          <button
            key={r.key}
            onClick={() => push({ range: r.key, from: null, to: null })}
            title={
              r.key === "all"
                ? "Every message ever recorded. Slow once the table is large."
                : undefined
            }
            className={chip(
              !custom && range === r.key,
              r.key === "all"
                ? "border-amber-500 bg-amber-50 text-amber-800"
                : "border-primary-500 bg-primary-50 text-primary-700"
            )}
          >
            {r.label}
          </button>
        ))}

        <span className="mx-1 h-5 w-px bg-neutral-200" />

        {/* Date and time together. Setting either one takes over from the
            quick ranges — two things claiming to set the window is how a
            filter starts lying about what is on screen. */}
        <input
          type="datetime-local"
          value={from}
          onChange={(e) => push({ from: e.target.value || null, range: null })}
          title="From this moment (IST)"
          className="rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs focus:border-primary-500 focus:outline-none"
        />
        <span className="text-xs text-neutral-400">to</span>
        <input
          type="datetime-local"
          value={to}
          onChange={(e) => push({ to: e.target.value || null, range: null })}
          title="Up to this moment (IST)"
          className="rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs focus:border-primary-500 focus:outline-none"
        />
      </div>

      {/* ── What ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-neutral-500">Show</span>
        <button
          onClick={() => push({ status: null, direction: null })}
          className={chip(!status && !direction, "border-neutral-900 bg-neutral-900 text-white")}
        >
          Everything
        </button>
        <button
          onClick={() => push({ direction: direction === "in" ? null : "in", status: null })}
          className={chip(direction === "in", "border-blue-500 bg-blue-50 text-blue-700")}
        >
          Received
        </button>
        <button
          onClick={() => push({ direction: direction === "out" ? null : "out", status: null })}
          className={chip(direction === "out", "border-violet-500 bg-violet-50 text-violet-700")}
        >
          Sent
        </button>
        <button
          onClick={() => push({ status: status === "failed" ? null : "failed", direction: null })}
          className={chip(status === "failed", "border-red-500 bg-red-50 text-red-700")}
        >
          Failed &amp; refused
        </button>
        <button
          onClick={() => push({ status: status === "read" ? null : "read", direction: null })}
          className={chip(status === "read", "border-green-600 bg-green-50 text-green-700")}
        >
          Read
        </button>

        <p className="ml-auto whitespace-nowrap text-xs tabular-nums text-neutral-500">
          {showing} of {count.toLocaleString("en-IN")}
        </p>

        {(status || direction || custom || range !== DEFAULT_RANGE) && (
          <button
            onClick={() => router.push("/admin/crm/log")}
            className="flex items-center gap-1 text-xs text-neutral-500 transition-colors hover:text-neutral-900"
          >
            <X className="h-3 w-3" /> Reset
          </button>
        )}
      </div>
    </div>
  );
}

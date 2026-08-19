"use client";

import { useMemo, useState } from "react";
import {
  SOURCE_LABELS, isTrafficSource, type TrafficSource,
} from "@/lib/attribution";

/**
 * Revenue over time + revenue by channel, on one daily/weekly/monthly toggle.
 *
 * Pure SVG, no chart dependency — the data is a few hundred rows at most, and
 * a hand-rolled bar/semi-donut keeps the admin bundle small and the colours
 * exact. All bucketing is in IST (+5:30): the dashboard answers "how did today
 * go", and today means the seller's day, not the server's.
 */

export interface RevenueRow {
  /** The order date — when it was paid (0043). */
  ordered_at: string;
  amount_paise: number | null;
  /** Copies in the order. Null on rows written before the column existed. */
  quantity: number | null;
  source: string | null;
}

type Grain = "daily" | "weekly" | "monthly";

const GRAINS: { key: Grain; label: string }[] = [
  { key: "daily", label: "Daily" },
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
];

const GRAIN_WINDOW: Record<Grain, string> = {
  daily: "last 14 days",
  weekly: "last 8 weeks",
  monthly: "last 12 months",
};

const IST_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const istDate = (iso: string) => new Date(new Date(iso).getTime() + IST_MS);

const dayKey = (iso: string) => istDate(iso).toISOString().slice(0, 10);

/** Monday of the ISO week containing the given IST day, as YYYY-MM-DD. */
function weekKey(iso: string): string {
  const d = istDate(iso);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

const monthKey = (iso: string) => dayKey(iso).slice(0, 7);

const fmtDay = (k: string) =>
  new Date(`${k}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

/** "Aug '26" — the year matters because a 12-month window spans two of them
 *  and bare month names repeat. */
const fmtMonth = (k: string) =>
  new Date(`${k}-01T00:00:00Z`).toLocaleDateString("en-IN", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  }).replace(" ", " '");

const rupees = (paise: number) => Math.round(paise / 100).toLocaleString("en-IN");

/** Compact ₹ for bar labels: ₹12.4k above ten thousand. */
const shortRupees = (paise: number) => {
  const r = paise / 100;
  if (r >= 10000) return `₹${(r / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `₹${rupees(paise)}`;
};

/** How many buckets back each grain shows, current bucket included. */
const SPAN: Record<Grain, number> = { daily: 14, weekly: 8, monthly: 12 };

interface Bucket {
  key: string;
  label: string;
  paise: number;
  orders: number;
  /** Copies, which is what the money is proportional to — see the tooltip. */
  books: number;
}

function bucketize(rows: RevenueRow[], grain: Grain): Bucket[] {
  const keyOf = grain === "daily" ? dayKey : grain === "weekly" ? weekKey : monthKey;
  const now = new Date(Date.now() + IST_MS);

  // Pre-create the window so days with no sales still render an empty bar.
  const keys: string[] = [];
  for (let i = SPAN[grain] - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * DAY_MS);
    if (grain === "daily") keys.push(d.toISOString().slice(0, 10));
    else if (grain === "weekly") {
      d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
      keys.push(d.toISOString().slice(0, 10));
    } else {
      // UTC month keys — never accidentally fall back a month due to local TZ.
      const rawMonth = now.getUTCMonth() - i;
      const year = now.getUTCFullYear() + Math.floor(rawMonth / 12);
      const month = ((rawMonth % 12) + 12) % 12;
      keys.push(`${year}-${String(month + 1).padStart(2, "0")}`);
    }
  }

  const map = new Map<string, Bucket>(
    keys.map((k) => [k, {
      key: k,
      label: grain === "monthly" ? fmtMonth(k) : fmtDay(k),
      paise: 0,
      orders: 0,
      books: 0,
    }])
  );

  for (const row of rows) {
    const b = map.get(keyOf(row.ordered_at));
    if (b) {
      b.paise += row.amount_paise ?? 0;
      b.orders += 1;
      b.books += row.quantity ?? 1;
    }
  }
  return [...map.values()];
}

const SOURCE_COLORS: Record<TrafficSource, string> = {
  instagram: "#ec4899",
  facebook: "#3b82f6",
  whatsapp: "#22c55e",
  youtube: "#ef4444",
  google: "#f59e0b",
  referral: "#a855f7",
  qr: "#6366f1",
  direct: "#f97316",
  other: "#a3a3a3",
};

/** Plot height in px — bars are sized in pixels, never %, because percentage
 *  heights inside auto-height flex columns collapse to zero. */
const BAR_H = 150;

export default function RevenueCharts({ rows }: { rows: RevenueRow[] }) {
  const [grain, setGrain] = useState<Grain>("daily");

  const buckets = useMemo(() => bucketize(rows, grain), [rows, grain]);
  const windowKeys = useMemo(() => new Set(buckets.map((b) => b.key)), [buckets]);
  const keyOf = grain === "daily" ? dayKey : grain === "weekly" ? weekKey : monthKey;

  const sources = useMemo(() => {
    const bySource = new Map<TrafficSource, number>();
    for (const row of rows) {
      if (!windowKeys.has(keyOf(row.ordered_at))) continue;
      const s = isTrafficSource(row.source) ? row.source : "direct";
      bySource.set(s, (bySource.get(s) ?? 0) + (row.amount_paise ?? 0));
    }
    return [...bySource.entries()]
      .map(([source, paise]) => ({ source, paise }))
      .filter((s) => s.paise > 0)
      .sort((a, b) => b.paise - a.paise);
  }, [rows, grain, windowKeys, keyOf]);

  const totalPaise = buckets.reduce((sum, b) => sum + b.paise, 0);
  const maxPaise = Math.max(...buckets.map((b) => b.paise), 1);

  // Semi-donut geometry: an 180° arc, left to right, r=80 in a 200x112 viewBox.
  const ARC_LEN = Math.PI * 80;
  let arcOffset = 0;

  return (
    <div className="bg-white border border-neutral-200 rounded-2xl shadow-sm overflow-hidden mb-8">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-neutral-100 bg-neutral-50/60">
        <div>
          <h2 className="font-semibold text-sm">Revenue</h2>
          <p className="text-[11px] text-neutral-400 mt-0.5">
            ₹{rupees(totalPaise)} · {GRAIN_WINDOW[grain]}
          </p>
        </div>
        <div className="flex gap-1 bg-neutral-100 rounded-lg p-1">
          {GRAINS.map((g) => (
            <button
              key={g.key}
              onClick={() => setGrain(g.key)}
              className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${
                grain === g.key
                  ? "bg-white shadow-sm text-neutral-900"
                  : "text-neutral-500 hover:text-neutral-700"
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid lg:grid-cols-5 gap-5 p-4 sm:p-5">
        {/* ── Bars ── */}
        {/* Horizontally scrollable on mobile: 14 bars at a readable minimum
            width beat 14 bars squashed into 320px. */}
        <div className="lg:col-span-3 rounded-xl border border-neutral-100 bg-neutral-50/50 p-4 overflow-x-auto">
          <div className="min-w-[480px] lg:min-w-0">
            <div className="flex gap-1 sm:gap-1.5">
              {buckets.map((b) => (
                <div
                  key={b.key}
                  className="flex-1 min-w-0 flex flex-col items-center justify-end gap-1"
                  style={{ height: BAR_H + 16 }}
                  title={`${b.label}: ₹${rupees(b.paise)} (${b.orders} order${b.orders === 1 ? "" : "s"}${
                    // Only when they disagree — a multi-copy order is the one
                    // case where fewer orders can still mean more money, and
                    // without this the bar looks like it lost a sale.
                    b.books === b.orders ? "" : `, ${b.books} books`
                  })`}
                >
                  <span className="text-[9px] font-semibold text-neutral-500 leading-none h-3">
                    {b.paise > 0 ? shortRupees(b.paise) : ""}
                  </span>
                  <div
                    className={`w-full rounded-t-md transition-colors ${
                      b.paise > 0
                        ? "bg-gradient-to-t from-primary-600 to-primary-400 hover:from-primary-700 hover:to-primary-500"
                        : "bg-neutral-200"
                    }`}
                    style={{ height: b.paise > 0 ? Math.max((b.paise / maxPaise) * BAR_H, 8) : 3 }}
                  />
                </div>
              ))}
            </div>
            <div className="flex gap-1 sm:gap-1.5 mt-1.5 border-t border-neutral-200 pt-1.5">
              {buckets.map((b) => (
                <span key={b.key} className="flex-1 text-center text-[9px] text-neutral-400 truncate">
                  {b.label}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* ── Half-donut by channel, same window as the bars ── */}
        <div className="lg:col-span-2 rounded-xl border border-primary-100 bg-gradient-to-b from-primary-50/70 to-white p-4 flex flex-col min-w-0">
          <p className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide mb-2">
            By channel
          </p>
          <div className="relative w-full max-w-[240px] mx-auto">
            <svg viewBox="0 0 200 112" className="w-full">
              {/* track */}
              <path
                d="M 20 100 A 80 80 0 0 1 180 100"
                fill="none" stroke="#e7e5e4" strokeWidth="18" strokeLinecap="round"
              />
              {sources.map((s) => {
                const pct = totalPaise > 0 ? s.paise / totalPaise : 0;
                const len = pct * ARC_LEN;
                const el = (
                  <path
                    key={s.source}
                    d="M 20 100 A 80 80 0 0 1 180 100"
                    fill="none"
                    stroke={SOURCE_COLORS[s.source]}
                    strokeWidth="18"
                    strokeDasharray={`${Math.max(len - 1, 0)} ${ARC_LEN}`}
                    strokeDashoffset={-arcOffset}
                  />
                );
                arcOffset += len;
                return el;
              })}
            </svg>
            <div className="absolute inset-x-0 bottom-0 text-center">
              <p className="text-xl font-black leading-none">₹{rupees(totalPaise)}</p>
              <p className="text-[10px] text-neutral-400 mt-1">{GRAIN_WINDOW[grain]}</p>
            </div>
          </div>
          <ul className="mt-4 grid grid-cols-2 gap-x-3 gap-y-1.5">
            {sources.map((s) => (
              <li key={s.source} className="flex items-center gap-1.5 text-xs min-w-0">
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: SOURCE_COLORS[s.source] }} />
                <span className="text-neutral-600 truncate">{SOURCE_LABELS[s.source]}</span>
                <span className="ml-auto font-semibold text-neutral-900 whitespace-nowrap">
                  {totalPaise > 0 ? Math.round((s.paise / totalPaise) * 100) : 0}%
                </span>
              </li>
            ))}
          </ul>
          {sources.length === 0 && (
            <p className="text-neutral-400 text-xs text-center py-6">No paid orders in this window.</p>
          )}
        </div>
      </div>
    </div>
  );
}

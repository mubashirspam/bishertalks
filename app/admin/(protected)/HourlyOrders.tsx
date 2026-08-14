"use client";

import { useMemo, useState } from "react";

/**
 * Paid orders by hour of the IST day — the "when do people actually buy" chart.
 *
 * Revenue-over-time answers how much; this answers when. The x axis is a fixed
 * 24-hour day, midnight to midnight, so every day is plotted on the same ruler
 * and the peak sits in the same place no matter which day you switch to. That
 * fixed frame is the whole point: it's what makes "8pm is our hour" visible
 * instead of something you have to reconstruct from a list of timestamps.
 *
 * Pick a window (last 7 or 30 days), then step through the individual days in
 * it. "All days" is ONE line — the window summed per hour — because seven
 * overlapping day-lines are unreadable spaghetti; per-day view is a chip away,
 * with the window's average hour-shape drawn behind as a dashed grey line, so
 * a spike reads as "unusual for us" rather than just "tall".
 *
 * Pure SVG/flex, no chart dependency — same reasoning as RevenueCharts.
 */

export interface HourlyRow {
  created_at: string;
}

const IST_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOURS = 24;

/** The instant shifted into IST, so the plain getUTC* readers give IST parts. */
const istDate = (iso: string) => new Date(new Date(iso).getTime() + IST_MS);

const dayKey = (iso: string) => istDate(iso).toISOString().slice(0, 10);
const hourOf = (iso: string) => istDate(iso).getUTCHours();

type Span = 7 | 30;

const SPANS: { key: Span; label: string }[] = [
  { key: 7, label: "Last 7 days" },
  { key: 30, label: "Last 30 days" },
];

/** "12a", "3p" — the axis is a ruler, not a caption, so it stays terse. */
const tickLabel = (h: number) => {
  const hr = h % 24;
  const suffix = hr < 12 ? "a" : "p";
  const twelve = hr % 12 === 0 ? 12 : hr % 12;
  return `${twelve}${suffix}`;
};

/** "8 PM" — used in tooltips and the peak callout, where it's read as words. */
const hourName = (h: number) => {
  const hr = ((h % 24) + 24) % 24;
  const twelve = hr % 12 === 0 ? 12 : hr % 12;
  return `${twelve} ${hr < 12 ? "AM" : "PM"}`;
};

/** "8–9 PM", collapsing the meridiem when both ends share it. */
const hourRange = (h: number) => {
  const from = hourName(h);
  const to = hourName(h + 1);
  const [fromNum, fromMer] = from.split(" ");
  const [, toMer] = to.split(" ");
  return fromMer === toMer ? `${fromNum}–${to}` : `${from}–${to}`;
};

const orders = (n: number) => `${n} order${n === 1 ? "" : "s"}`;

/**
 * Y-axis ticks on round numbers.
 *
 * Order counts per hour are small integers, so a naive max-based scale gives
 * ticks like 0/2.33/4.67/7. Snap the top to a step people count in instead.
 */
function scaleFor(max: number): { top: number; ticks: number[] } {
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
  const step = steps.find((s) => max / s <= 4) ?? 1000;
  const top = Math.max(Math.ceil(max / step) * step, step);
  const ticks: number[] = [];
  for (let v = top; v >= 0; v -= step) ticks.push(v);
  return { top, ticks };
}

/** The last `span` IST days, today first. */
function recentDays(span: Span): string[] {
  const now = new Date(Date.now() + IST_MS);
  return Array.from({ length: span }, (_, i) =>
    new Date(now.getTime() - i * DAY_MS).toISOString().slice(0, 10)
  );
}

/** "Today" / "Yesterday" / "Thu 7 Aug" — recency is what you scan the chips for. */
function dayChipLabel(key: string, index: number): string {
  if (index === 0) return "Today";
  if (index === 1) return "Yesterday";
  return new Date(`${key}T00:00:00Z`).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

const fmtDayLong = (key: string) =>
  new Date(`${key}T00:00:00Z`).toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

/** Bars are sized in px against this — percentage heights collapse in flex. */
const PLOT_H = 168;
/** Headroom above the tallest bar so the peak's direct label has somewhere to sit. */
const LABEL_H = 18;

/** SVG plot space: ten units per hour so the curve stays smooth when stretched. */
const SW = HOURS * 10;
const sx = (h: number) => h * 10 + 5; // hour centre

/**
 * Smooth path through per-hour points — Catmull-Rom converted to cubic
 * Béziers, the same monotone feel as a chart library's `type="monotone"`.
 * y is flipped: SVG space counts down from the top.
 */
function smoothLine(values: number[], top: number): string {
  const pts = values.map((v, h) => [sx(h), 100 - (v / top) * 100] as const);
  if (pts.length < 2) return "";
  let d = `M ${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    d +=
      ` C ${p1[0] + (p2[0] - p0[0]) / 6},${p1[1] + (p2[1] - p0[1]) / 6}` +
      ` ${p2[0] - (p3[0] - p1[0]) / 6},${p2[1] - (p3[1] - p1[1]) / 6}` +
      ` ${p2[0]},${p2[1]}`;
  }
  return d;
}

export default function HourlyOrders({ rows }: { rows: HourlyRow[] }) {
  const [span, setSpan] = useState<Span>(7);
  const [day, setDay] = useState<string | null>(null); // null = whole window
  const [hover, setHover] = useState<number | null>(null);

  const days = useMemo(() => recentDays(span), [span]);

  /** hour-of-day counts per IST day, for the days in the window only. */
  const byDay = useMemo(() => {
    const map = new Map<string, number[]>(
      days.map((d) => [d, Array(HOURS).fill(0)])
    );
    for (const row of rows) {
      const hours = map.get(dayKey(row.created_at));
      if (hours) hours[hourOf(row.created_at)] += 1;
    }
    return map;
  }, [rows, days]);

  const dayTotals = useMemo(
    () => new Map(days.map((d) => [d, (byDay.get(d) ?? []).reduce((a, b) => a + b, 0)])),
    [days, byDay]
  );

  /** Window totals per hour — also the basis for the average line. */
  const windowHours = useMemo(() => {
    const sum = Array(HOURS).fill(0);
    for (const hours of byDay.values()) {
      for (let h = 0; h < HOURS; h++) sum[h] += hours[h];
    }
    return sum;
  }, [byDay]);

  // A selected day is plotted alone; "All days" stacks the window into one
  // shape, which is the honest answer to "which hour sells most" — one day is
  // too few orders to trust.
  const series = day ? byDay.get(day) ?? Array(HOURS).fill(0) : windowHours;
  const average = useMemo(
    () => windowHours.map((v) => v / span),
    [windowHours, span]
  );

  const total = series.reduce((a, b) => a + b, 0);
  const peakHour = total > 0 ? series.indexOf(Math.max(...series)) : -1;
  const peakCount = peakHour >= 0 ? series[peakHour] : 0;

  const { top, ticks } = scaleFor(
    Math.max(...series, ...(day ? average : []), 1)
  );

  const y = (v: number) => (v / top) * PLOT_H;

  /** Hour centre as a percentage of plot width — for the HTML dot overlays. */
  const xPct = (h: number) => ((h + 0.5) / HOURS) * 100;

  const lineD = useMemo(() => smoothLine(series, top), [series, top]);
  const areaD = lineD ? `${lineD} L ${sx(HOURS - 1)},100 L ${sx(0)},100 Z` : "";
  const avgD = useMemo(
    () => (day ? smoothLine(average, top) : ""),
    [day, average, top]
  );

  const shown = hover ?? peakHour;

  return (
    <div className="bg-white border border-neutral-200 rounded-2xl shadow-sm overflow-hidden mb-8">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-neutral-100 bg-neutral-50/60">
        <div>
          <h2 className="font-semibold text-sm">Orders by hour</h2>
          <p className="text-[11px] text-neutral-400 mt-0.5">
            {total > 0 ? (
              <>
                Busiest hour {hourRange(peakHour)} · {orders(peakCount)} ·{" "}
                {day ? fmtDayLong(day) : SPANS.find((s) => s.key === span)?.label.toLowerCase()}
              </>
            ) : (
              <>No paid orders {day ? `on ${fmtDayLong(day)}` : "in this window"}</>
            )}
          </p>
        </div>
        <div className="flex gap-1 bg-neutral-100 rounded-lg p-1">
          {SPANS.map((s) => (
            <button
              key={s.key}
              onClick={() => {
                setSpan(s.key);
                setDay(null);
              }}
              className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${
                span === s.key
                  ? "bg-white shadow-sm text-neutral-900"
                  : "text-neutral-500 hover:text-neutral-700"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Day picker: "All days" plus one chip per day in the window ── */}
      <div className="flex gap-1.5 px-5 py-3 overflow-x-auto border-b border-neutral-100">
        <button
          onClick={() => setDay(null)}
          className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
            day === null
              ? "bg-primary-600 border-primary-600 text-white"
              : "bg-white border-neutral-200 text-neutral-600 hover:border-neutral-300"
          }`}
        >
          All {span} days
        </button>
        {days.map((d, i) => (
          <button
            key={d}
            onClick={() => setDay(d)}
            title={`${fmtDayLong(d)} · ${orders(dayTotals.get(d) ?? 0)}`}
            className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
              day === d
                ? "bg-primary-600 border-primary-600 text-white"
                : "bg-white border-neutral-200 text-neutral-600 hover:border-neutral-300"
            }`}
          >
            {dayChipLabel(d, i)}
            <span className={day === d ? "text-primary-100" : "text-neutral-400"}>
              {" "}· {dayTotals.get(d) ?? 0}
            </span>
          </button>
        ))}
      </div>

      <div className="p-4 sm:p-5">
        <div className="flex gap-2">
          {/* ── Y axis: order counts, on whole numbers ── */}
          <div
            className="relative flex-shrink-0 w-6"
            style={{ height: PLOT_H + LABEL_H }}
          >
            {ticks.map((t) => (
              <span
                key={t}
                className="absolute right-0 text-[9px] text-neutral-400 tabular-nums leading-none -translate-y-1/2"
                style={{ bottom: y(t) }}
              >
                {t}
              </span>
            ))}
          </div>

          <div className="flex-1 min-w-0">
            <div
              className="relative"
              style={{ height: PLOT_H + LABEL_H }}
              onMouseLeave={() => setHover(null)}
            >
              {/* gridlines — hairline, solid, one step off the surface */}
              {ticks.map((t) => (
                <div
                  key={t}
                  className={`absolute inset-x-0 h-px ${
                    t === 0 ? "bg-neutral-300" : "bg-neutral-100"
                  }`}
                  style={{ bottom: y(t) }}
                />
              ))}

              {/* one dashed vertical per hour, through that hour's point — the
                  guide the eye follows down from a dot to the ruler. Lighter
                  than the solid hover cursor so the two never compete. */}
              {series.map((_, h) => (
                <div
                  key={h}
                  className="absolute bottom-0 border-l border-dashed border-neutral-200 pointer-events-none"
                  style={{ left: `${xPct(h)}%`, height: PLOT_H }}
                />
              ))}

              {/* invisible hit columns — one per hour; they drive hover */}
              <div
                className="absolute inset-x-0 bottom-0 flex items-stretch"
                style={{ height: PLOT_H + LABEL_H }}
              >
                {series.map((v, h) => (
                  <div
                    key={h}
                    className="flex-1 cursor-crosshair"
                    onMouseEnter={() => setHover(h)}
                    title={`${hourRange(h)} · ${orders(v)}`}
                  />
                ))}
              </div>

              {/* the line itself: the window's hours summed, or one day when a
                  chip is selected. Area fill fades to nothing under the curve. */}
              <svg
                className="absolute inset-x-0 bottom-0 w-full pointer-events-none overflow-visible"
                style={{ height: PLOT_H }}
                viewBox={`0 0 ${SW} 100`}
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <defs>
                  <linearGradient id="hourlyArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f97316" stopOpacity="0.16" />
                    <stop offset="100%" stopColor="#f97316" stopOpacity="0" />
                  </linearGradient>
                </defs>
                {lineD && <path d={areaD} fill="url(#hourlyArea)" />}
                {lineD && (
                  <path
                    d={lineD}
                    fill="none"
                    stroke="#ea580c"
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
                {/* Average-day line, drawn only when one day is on screen — it
                    is the "is this normal for us?" reference, meaningless
                    against the window total it was derived from. */}
                {day && avgD && (
                  <path
                    d={avgD}
                    fill="none"
                    stroke="#737373"
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
              </svg>

              {/* Hover cursor + dot, or the peak dot when nothing is hovered.
                  HTML rather than SVG: circles drawn in the stretched plot
                  space would come out as ellipses. */}
              {hover !== null ? (
                <>
                  <div
                    className="absolute bottom-0 w-px bg-neutral-300 pointer-events-none"
                    style={{ left: `${xPct(hover)}%`, height: PLOT_H }}
                  />
                  <div
                    className="absolute w-3 h-3 rounded-full bg-primary-600 ring-2 ring-white -translate-x-1/2 translate-y-1/2 pointer-events-none"
                    style={{ left: `${xPct(hover)}%`, bottom: y(series[hover]) }}
                  />
                  <span
                    className="absolute text-[9px] font-semibold text-neutral-600 leading-none tabular-nums -translate-x-1/2 pointer-events-none"
                    style={{
                      left: `${xPct(hover)}%`,
                      bottom: Math.min(y(series[hover]) + 12, PLOT_H + LABEL_H - 10),
                    }}
                  >
                    {series[hover]}
                  </span>
                </>
              ) : (
                peakCount > 0 && (
                  <>
                    <div
                      className="absolute w-3 h-3 rounded-full bg-primary-600 ring-2 ring-white -translate-x-1/2 translate-y-1/2 pointer-events-none"
                      style={{ left: `${xPct(peakHour)}%`, bottom: y(peakCount) }}
                    />
                    <span
                      className="absolute text-[9px] font-semibold text-neutral-600 leading-none tabular-nums -translate-x-1/2 pointer-events-none"
                      style={{
                        left: `${xPct(peakHour)}%`,
                        bottom: Math.min(y(peakCount) + 12, PLOT_H + LABEL_H - 10),
                      }}
                    >
                      {peakCount}
                    </span>
                  </>
                )
              )}
            </div>

            {/* ── X axis: every hour labelled, centred on its dashed line ── */}
            <div className="relative h-4 mt-1.5 border-t border-neutral-200 pt-1.5">
              {Array.from({ length: HOURS }, (_, h) => (
                <span
                  key={h}
                  className="absolute top-1.5 text-[9px] text-neutral-400 leading-none whitespace-nowrap -translate-x-1/2"
                  style={{ left: `${xPct(h)}%` }}
                >
                  {tickLabel(h)}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* ── Readout + legend ── */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 mt-5">
          <p className="text-xs text-neutral-500">
            {total > 0 && shown >= 0 ? (
              <>
                <span className="font-semibold text-neutral-900 tabular-nums">
                  {series[shown]}
                </span>{" "}
                {series[shown] === 1 ? "order" : "orders"} between{" "}
                <span className="font-medium text-neutral-700">{hourRange(shown)}</span>
                {day ? (
                  <> · {average[shown].toFixed(1)} on an average day</>
                ) : (
                  <> · {Math.round((series[shown] / total) * 100)}% of {orders(total)}</>
                )}
              </>
            ) : (
              <>Nothing to plot yet — paid orders show up here the hour they land.</>
            )}
          </p>
          {day && (
            <div className="flex items-center gap-4 text-[11px] text-neutral-500">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-0.5 rounded-full bg-primary-600" />
                {dayChipLabel(day, days.indexOf(day))}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-0.5 rounded-full bg-neutral-500" />
                Average day ({span}-day)
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

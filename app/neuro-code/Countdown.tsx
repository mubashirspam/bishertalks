"use client";

import { useEffect, useState } from "react";

/**
 * The pre-booking clock.
 *
 * The deadline is already stated in words further up the page ("ഈ വില
 * ശനിയാഴ്ച വരെ മാത്രം"). This is the same fact as a number that moves: a
 * weekday is something to deal with later, a running clock is now. It is the
 * only thing on this page that changes while you look at it, which is exactly
 * the weight it should carry.
 *
 * Nothing here decides *whether* there is an offer — the server does that in
 * lib/preorder.ts and hands it down. This only counts.
 */

export type Remaining = {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  /** Hours including whole days, for the one-line form: "28:14:07". */
  totalHours: number;
  /** The deadline has passed while the page was open. */
  over: boolean;
};

function split(ms: number): Remaining {
  const clamped = Math.max(0, ms);
  const total = Math.floor(clamped / 1000);
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor(total / 3600) % 24,
    minutes: Math.floor(total / 60) % 60,
    seconds: total % 60,
    totalHours: Math.floor(total / 3600),
    over: clamped <= 0,
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Counts down to `endsAt`, starting from a figure the server worked out.
 *
 * `initialRemainingMs` is the reason this takes two arguments instead of one.
 * The route is force-dynamic, so the server knows the real gap at render time
 * and passes it in; the browser's first render uses that same number and so
 * matches the HTML exactly. Only after hydration does the effect start reading
 * the local clock. Seeding from `Date.now()` on the first render instead would
 * put a different second in the DOM than the server sent — a hydration
 * mismatch on the loudest element on the page.
 *
 * Every tick recomputes from the absolute deadline rather than subtracting a
 * second, so a throttled background tab or a sleeping phone comes back to the
 * correct time instead of to however many intervals the browser felt like
 * firing.
 */
export function useCountdown(endsAt: number, initialRemainingMs: number): Remaining {
  const [ms, setMs] = useState(initialRemainingMs);

  useEffect(() => {
    const tick = () => setMs(endsAt - Date.now());
    // Once immediately: the server's figure is already stale by the page's
    // time in flight, and on a slow connection that is visible.
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [endsAt]);

  return split(ms);
}

/**
 * The clock as digit boxes — the form used where there is room to be loud.
 *
 * The days box appears only when there is at least one; on the last day a "00"
 * sitting next to the hours reads as broken rather than as urgent.
 *
 * `tabular-nums` is not decoration: without it the row re-measures on every
 * tick as the glyph widths change, and the boxes twitch once a second.
 */
export function CountdownBoxes({
  r,
  className = "",
}: {
  r: Remaining;
  className?: string;
}) {
  const units = [
    ...(r.days > 0 ? [{ value: r.days, label: "ദിവസം" }] : []),
    { value: r.hours, label: "മണിക്കൂർ" },
    { value: r.minutes, label: "മിനിറ്റ്" },
    { value: r.seconds, label: "സെക്കൻഡ്" },
  ];

  return (
    <div className={`flex items-stretch justify-center gap-1.5 ${className}`}>
      {units.map((u, i) => (
        <div key={u.label} className="flex items-stretch">
          <div className="min-w-[52px] rounded-lg border border-amber-300 dark:border-amber-500/30 bg-white/80 dark:bg-black/30 px-2 py-1.5 text-center">
            <span className="block font-anek tabular-nums text-[22px] leading-none font-black text-amber-900 dark:text-amber-300">
              {pad(u.value)}
            </span>
            <span className="block font-anek text-[9px] leading-none mt-1 font-bold uppercase tracking-wide text-amber-700/80 dark:text-amber-400/70">
              {u.label}
            </span>
          </div>
          {i < units.length - 1 && (
            <span
              aria-hidden
              className="self-start font-anek tabular-nums text-[20px] leading-none pt-[6px] px-0.5 font-black text-amber-500/70"
            >
              :
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * The clock on one line — "28:14:07" — for the sticky bar and the price card,
 * where a row of boxes would take the space the price needs.
 *
 * Days roll up into the hours rather than getting their own segment: four
 * numbers in a strip that is already carrying an offer line is noise, and
 * "28:14:07" is read as "a long time today", which is true enough.
 */
export function CountdownClock({ r, className = "" }: { r: Remaining; className?: string }) {
  return (
    <span className={`font-anek tabular-nums font-black ${className}`}>
      {pad(r.totalHours)}:{pad(r.minutes)}:{pad(r.seconds)}
    </span>
  );
}

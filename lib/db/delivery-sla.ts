import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/db/paginate";
import { SLA_LEGS, type SlaLeg } from "@/lib/report-filters";

/**
 * Is the shop keeping its own delivery promise, and which parcels are not?
 *
 * Two different questions, and the panel needs both:
 *
 *   HISTORY   of the legs that finished, how long did they take and how many
 *             came in under target. This is the honest scoreboard, and it can
 *             only be computed from parcels where BOTH ends of the leg are
 *             timestamped.
 *   NOW       of the parcels still on this leg, how many are already past
 *             target. This is the chase list, and it is the number somebody
 *             can actually act on this morning.
 *
 * Kept apart on purpose. Averaging them would produce a figure that is neither
 * — a "performance" number that moves when a parcel is delivered AND when one
 * merely gets older, which nobody can reason about.
 *
 * ── Why days are counted the way they are ──
 *
 * Whole IST calendar days, matching `report_scope` in migration 0058 exactly.
 * That is what makes a card's number and the parcel list it opens agree: if
 * this counted fractional hours and the SQL counted calendar days, a parcel
 * would be late on one screen and fine on the other, and the report would stop
 * being believed. The rule there — and here — is that a parcel is late when
 * MORE than `target` whole days have passed, so exactly two days is on time.
 *
 * ── What is deliberately not measured ──
 *
 * A leg whose start timestamp is missing is not a fast leg, it is an unknown
 * one, and it is excluded from both halves rather than counted as zero.
 * `courier_assigned_at` only exists from migration 0057, so roughly a tenth of
 * historical parcels cannot answer for the routing and handover legs at all.
 * The panel reports that count rather than hiding it — a compliance figure
 * quietly computed over half the data is worse than no figure.
 *
 * Cancelled and returned parcels are out. A cancelled parcel is not owed to
 * anybody and a returned one already made the journey; leaving them in would
 * charge the shop for time nobody was waiting.
 */

export interface LegStats {
  leg: SlaLeg;
  /** Legs that finished, and so can be scored. */
  completed: number;
  /** Of those, how many came in on or under target. */
  withinTarget: number;
  /** Whole days, middle value. Null when nothing has finished. */
  medianDays: number | null;
  /** The slow tail — 90th percentile. Null when nothing has finished. */
  p90Days: number | null;
  /** Parcels sitting on this leg right now. */
  openNow: number;
  /** Of those, already past target. This is the chase number. */
  breachingNow: number;
  /** The worst of them, for the panel's preview. Newest breach last. */
  worstDays: number | null;
  /** On this leg but missing its start timestamp, so unscoreable. */
  unmeasurable: number;
}

export interface SlaReport {
  legs: LegStats[];
  /** Every paid, addressed parcel considered. */
  parcels: number;
  generatedAt: string;
}

interface Row {
  status: string;
  courier_id: string | null;
  assigned_agent_id: string | null;
  ordered_at: string | null;
  courier_assigned_at: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  returned_at: string | null;
}

/** Whole IST calendar days between two instants — the SQL's rule, in TypeScript. */
function istDaysBetween(fromIso: string, toIso: string): number {
  const istDate = (iso: string) =>
    new Date(new Date(iso).getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);
  const a = Date.parse(`${istDate(fromIso)}T00:00:00Z`);
  const b = Date.parse(`${istDate(toIso)}T00:00:00Z`);
  return Math.round((b - a) / 864e5);
}

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

/**
 * The delivery promise, scored.
 *
 * Reads every paid, addressed parcel once and derives all three legs from it —
 * three separate aggregate queries would be three table scans for numbers that
 * come from the same rows. Memoised per request, so the panel and anything
 * else on the page share the trip.
 */
export const deliverySla = cache(async function deliverySla(): Promise<SlaReport> {
  const { rows } = await fetchAllRows<Row>(
    (from, to) =>
      supabaseAdmin
        .from("orders")
        .select(
          "status,courier_id,assigned_agent_id,ordered_at," +
            "courier_assigned_at,shipped_at,delivered_at,returned_at"
        )
        .eq("payment_status", "paid")
        .not("address_line1", "is", null)
        // Ordered, or a paged read can repeat and skip rows between pages.
        .order("ordered_at", { ascending: true })
        .range(from, to) as never,
    { label: "delivery sla" }
  );

  const now = new Date().toISOString();
  const finished = (r: Row) =>
    r.status === "delivered" || r.status === "returned" || r.status === "cancelled";

  const legs = SLA_LEGS.map((leg): LegStats => {
    const durations: number[] = [];
    let openNow = 0;
    let breachingNow = 0;
    let worstDays: number | null = null;
    let unmeasurable = 0;

    for (const r of rows) {
      if (r.status === "cancelled" || r.status === "returned") continue;

      const startedAt = r[leg.from];
      const endedAt = r[leg.to];

      if (endedAt) {
        // The leg finished. Scoreable only if we know when it began.
        if (!startedAt) {
          unmeasurable++;
          continue;
        }
        durations.push(istDaysBetween(startedAt, endedAt));
        continue;
      }

      // The leg has not finished. Two ways that is not this parcel's problem.
      //
      // It is done with the journey by another route — marked delivered with
      // no delivered_at, say. Nobody is waiting on it.
      if (finished(r)) continue;
      // Its start never happened, which means the parcel is still sitting on
      // an EARLIER leg and will be counted there. A parcel with no courier yet
      // is not "slow to hand over"; it is slow to route.
      if (!startedAt) continue;

      // A later leg has already started, so this one is over even though its
      // own end is unstamped — don't hold the parcel here forever.
      const laterStarted =
        (leg.key === "routing" && (r.shipped_at || r.delivered_at)) ||
        (leg.key === "handover" && r.delivered_at);
      if (laterStarted) {
        unmeasurable++;
        continue;
      }

      openNow++;
      const age = istDaysBetween(startedAt, now);
      if (age > leg.target) {
        breachingNow++;
        if (worstDays === null || age > worstDays) worstDays = age;
      }
    }

    const sorted = [...durations].sort((a, b) => a - b);

    return {
      leg,
      completed: sorted.length,
      withinTarget: sorted.filter((d) => d <= leg.target).length,
      medianDays: percentile(sorted, 0.5),
      p90Days: percentile(sorted, 0.9),
      openNow,
      breachingNow,
      worstDays,
      unmeasurable,
    };
  });

  return { legs, parcels: rows.length, generatedAt: now };
});

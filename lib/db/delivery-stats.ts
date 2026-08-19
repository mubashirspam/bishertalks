import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { scopeArgs, type DeliveryFilters } from "@/lib/db/delivery-query";
import { DELIVERY_STAGES, type DeliveryStage } from "@/lib/delivery-stage";
import { listStaff } from "@/lib/db/staff";

/**
 * The numbers behind the delivery queue.
 *
 * One round trip, aggregated here, rather than a count query per figure: the
 * per-agent table alone would be five counts times however many agents, and
 * they all read the same rows. The columns fetched are the four timestamps and
 * two ids the maths needs — no names, no addresses.
 *
 * Everything respects the page's date, search and agent filters, but not its
 * stage tab: the strip *is* the stage breakdown, so narrowing to one tab and
 * then reporting "100% shipped" would be a mirror, not a fact.
 */

/** How many days of the shipped/delivered chart to draw. */
const THROUGHPUT_DAYS = 14;

export interface AgentStat {
  id: string;
  name: string;
  /** Holding, not yet gone to the courier. */
  assigned: number;
  /** Of those, keyed into the courier's system. */
  confirmed: number;
  shipped: number;
  delivered: number;
  returned: number;
  /** Assigned, unconfirmed, and sitting there over a day. */
  stale: number;
}

export interface DeliveryStats {
  totals: Record<DeliveryStage, number>;
  agents: AgentStat[];
  ageing: {
    over24h: number;
    over48h: number;
    /** ISO date of the oldest parcel still not shipped, if any. */
    oldestUnshipped: string | null;
  };
  throughput: { day: string; shipped: number; delivered: number }[];
  /**
   * Always false since 0045.
   *
   * It meant "Node stopped reading before the end", which was possible when
   * this paged the whole queue into memory and gave up at 20,000 rows. An
   * aggregate has no such ceiling, so the figures are now always complete.
   * Kept on the interface so the strip that renders the caveat is unchanged.
   */
  sampled: boolean;
}

export const deliveryStats = cache(async function deliveryStats(
  filters: DeliveryFilters
): Promise<DeliveryStats> {
  // One aggregate row instead of every shippable parcel (migration 0045).
  //
  // This used to page the whole queue into Node and reduce it here, which was
  // fine at a thousand orders and is the kind of thing that stops being fine
  // without announcing it. Postgres does the counting now; this function's job
  // is shaping the answer and naming the agents.
  //
  // Staff names stay out of SQL: the database returns agent ids, and the label
  // for an agent switched off since — "Removed agent" — belongs next to the
  // rest of the copy rather than in a migration.
  const [{ data, error }, staff] = await Promise.all([
    supabaseAdmin.rpc("delivery_stats_summary", {
      ...scopeArgs(filters),
      p_days: THROUGHPUT_DAYS,
    }),
    listStaff(),
  ]);

  if (error) {
    console.error("[Delivery] stats failed:", error.message);
    return EMPTY_STATS;
  }

  const raw = (data ?? {}) as StatsPayload;
  const names = new Map(staff.map((s) => [s.id, s.name]));

  // Every stage present, including the ones with nothing in them — the strip
  // draws a figure per stage and an absent key would render as blank.
  const totals = Object.fromEntries(
    DELIVERY_STAGES.map((s) => [s, Number(raw.totals?.[s] ?? 0)])
  ) as Record<DeliveryStage, number>;

  const agents: AgentStat[] = (raw.agents ?? []).map((a) => ({
    id: a.id,
    // An agent switched off since still owns whatever they were given — their
    // column has to stay legible or the parcels look orphaned.
    name: names.get(a.id) ?? "Removed agent",
    assigned: Number(a.assigned) || 0,
    confirmed: Number(a.confirmed) || 0,
    shipped: Number(a.shipped) || 0,
    delivered: Number(a.delivered) || 0,
    returned: Number(a.returned) || 0,
    stale: Number(a.stale) || 0,
  }));

  // Busiest first — whoever is carrying the most is who the day depends on.
  // The tie-break is on the name, which only exists here, so the sort has to
  // finish in TypeScript however the rows arrived.
  agents.sort((a, b) => b.assigned - a.assigned || a.name.localeCompare(b.name));

  return {
    totals,
    agents,
    ageing: {
      over24h: Number(raw.ageing?.over24h) || 0,
      over48h: Number(raw.ageing?.over48h) || 0,
      oldestUnshipped: raw.ageing?.oldestUnshipped ?? null,
    },
    throughput: (raw.throughput ?? []).map((d) => ({
      day: d.day,
      shipped: Number(d.shipped) || 0,
      delivered: Number(d.delivered) || 0,
    })),
    // Always false now. It meant "Node gave up before reading everything",
    // which an aggregate cannot do. Kept on the interface so the strip's
    // contract is unchanged.
    sampled: false,
  };
});

/** What `delivery_stats_summary` returns, before it is shaped and named. */
interface StatsPayload {
  totals?: Record<string, number>;
  agents?: {
    id: string;
    assigned: number;
    confirmed: number;
    shipped: number;
    delivered: number;
    returned: number;
    stale: number;
  }[];
  ageing?: {
    over24h: number;
    over48h: number;
    oldestUnshipped: string | null;
  };
  throughput?: { day: string; shipped: number; delivered: number }[];
}

/** What the strip shows when the aggregate could not be read at all. */
const EMPTY_STATS: DeliveryStats = {
  totals: Object.fromEntries(DELIVERY_STAGES.map((s) => [s, 0])) as Record<
    DeliveryStage,
    number
  >,
  agents: [],
  ageing: { over24h: 0, over48h: 0, oldestUnshipped: null },
  throughput: [],
  sampled: false,
};

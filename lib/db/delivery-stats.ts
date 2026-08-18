import { cache } from "react";
import { buildDeliveryQuery, type DeliveryFilters } from "@/lib/db/delivery-query";
import { deliveryStage, type DeliveryStage } from "@/lib/delivery-stage";
import { listStaff } from "@/lib/db/staff";
import { fetchAllRows } from "@/lib/db/paginate";

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

/**
 * Past this the aggregate is a sample, and the strip says so.
 *
 * Now genuinely enforced: this was a `.limit()`, which PostgREST overrode with
 * its own 1000-row cap, so the strip claimed to be complete while sampling.
 */
const MAX_ROWS = 20_000;

/** How many days of the shipped/delivered chart to draw. */
const THROUGHPUT_DAYS = 14;

const STATS_COLUMNS =
  "status,assigned_agent_id,assigned_at,courier_entered_at,shipped_at,delivered_at,created_at";

interface StatsRow {
  status: string;
  assigned_agent_id: string | null;
  assigned_at: string | null;
  courier_entered_at: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  created_at: string;
}

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
  /** True when the cap was hit — the figures are the newest MAX_ROWS only. */
  sampled: boolean;
}

/** YYYY-MM-DD in IST, which is the day an admin means by "yesterday". */
const istDay = (iso: string): string =>
  new Date(new Date(iso).getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);

const HOUR = 3600e3;

export const deliveryStats = cache(async function deliveryStats(
  filters: DeliveryFilters
): Promise<DeliveryStats> {
  const [{ rows: fetched, truncated }, staff] = await Promise.all([
    fetchAllRows<StatsRow>(
      (from, to) =>
        buildDeliveryQuery(
          // Stage dropped on purpose — see the note at the top.
          { ...filters, stage: undefined },
          { columns: STATS_COLUMNS }
        ).range(from, to) as never,
      { label: "delivery stats", max: MAX_ROWS }
    ),
    listStaff(),
  ]);

  const rows = fetched;
  const names = new Map(staff.map((s) => [s.id, s.name]));

  const totals = {
    new: 0, assigned: 0, shipped: 0, out_for_delivery: 0,
    delivered: 0, cancelled: 0, returned: 0,
  } as Record<DeliveryStage, number>;

  const byAgent = new Map<string, AgentStat>();
  const byDay = new Map<string, { shipped: number; delivered: number }>();

  const now = Date.now();
  let over24h = 0;
  let over48h = 0;
  let oldestUnshipped: string | null = null;

  const agentStat = (id: string): AgentStat => {
    let stat = byAgent.get(id);
    if (!stat) {
      stat = {
        id,
        // An agent switched off since still owns whatever they were given —
        // their column has to stay legible or the parcels look orphaned.
        name: names.get(id) ?? "Removed agent",
        assigned: 0, confirmed: 0, shipped: 0, delivered: 0, returned: 0, stale: 0,
      };
      byAgent.set(id, stat);
    }
    return stat;
  };

  const day = (iso: string) => {
    let d = byDay.get(istDay(iso));
    if (!d) byDay.set(istDay(iso), (d = { shipped: 0, delivered: 0 }));
    return d;
  };

  for (const row of rows) {
    const stage = deliveryStage(row);
    totals[stage] += 1;

    if (row.shipped_at) day(row.shipped_at).shipped += 1;
    if (row.delivered_at) day(row.delivered_at).delivered += 1;

    // Still ours to chase: assigned, and not yet handed to the courier.
    if (stage === "assigned") {
      const waiting = now - new Date(row.assigned_at ?? row.created_at).getTime();
      if (!row.courier_entered_at) {
        if (waiting > 48 * HOUR) over48h += 1;
        else if (waiting > 24 * HOUR) over24h += 1;
      }
      if (!oldestUnshipped || row.created_at < oldestUnshipped) {
        oldestUnshipped = row.created_at;
      }
    }

    if (!row.assigned_agent_id) continue;
    const stat = agentStat(row.assigned_agent_id);

    switch (stage) {
      case "assigned":
        stat.assigned += 1;
        if (row.courier_entered_at) stat.confirmed += 1;
        else if (now - new Date(row.assigned_at ?? row.created_at).getTime() > 24 * HOUR) {
          stat.stale += 1;
        }
        break;
      case "shipped":
      case "out_for_delivery":
        stat.shipped += 1;
        break;
      case "delivered":
        stat.delivered += 1;
        break;
      case "returned":
        stat.returned += 1;
        break;
    }
  }

  const throughput = [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .slice(0, THROUGHPUT_DAYS)
    .reverse()
    .map(([day, v]) => ({ day, ...v }));

  return {
    totals,
    // Busiest first — whoever is carrying the most is who the day depends on.
    agents: [...byAgent.values()].sort(
      (a, b) => b.assigned - a.assigned || a.name.localeCompare(b.name)
    ),
    ageing: { over24h, over48h, oldestUnshipped },
    throughput,
    // From the pager, which knows whether it stopped early — a full page
    // is not the same thing as more rows existing.
    sampled: truncated,
  };
});

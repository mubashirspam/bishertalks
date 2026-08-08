import { supabaseAdmin } from "@/lib/supabase/admin";
import { istDayStartUTC, istDayEndUTC } from "@/lib/format-date";
import {
  TRAFFIC_SOURCES,
  isTrafficSource,
  type TrafficSource,
} from "@/lib/attribution";

export interface ChannelStat {
  source: TrafficSource;
  /** Everyone who reached the checkout form — the top of the funnel. */
  leads: number;
  paid: number;
  revenuePaise: number;
  /** paid / leads, as a percentage. */
  conversion: number;
}

export interface CampaignStat {
  campaign: string;
  source: TrafficSource;
  leads: number;
  paid: number;
  revenuePaise: number;
}

export interface Insights {
  channels: ChannelStat[];
  campaigns: CampaignStat[];
  totals: { leads: number; paid: number; revenuePaise: number; conversion: number };
}

const isDate = (s?: string): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

/**
 * Channel and campaign performance over a date range.
 *
 * One query, aggregated in memory rather than in SQL. That's a deliberate
 * trade: the alternative is a set of Postgres views or an RPC per breakdown,
 * and at this volume (thousands of orders, not millions) the whole range fits
 * comfortably in a single fetch. If it ever stops fitting, the LIMIT below
 * will make that obvious rather than silently returning half the truth.
 */
export async function getInsights(filters: {
  from?: string;
  to?: string;
}): Promise<Insights> {
  let query = supabaseAdmin
    .from("orders")
    .select("source,utm_campaign,payment_status,amount_paise,discount_paise")
    .order("created_at", { ascending: false })
    .limit(20000);

  if (isDate(filters.from)) query = query.gte("created_at", istDayStartUTC(filters.from));
  if (isDate(filters.to)) query = query.lt("created_at", istDayEndUTC(filters.to));

  const { data, error } = await query;
  if (error) {
    console.error("[Insights] query failed:", error.message);
  }

  const rows = (data ?? []) as unknown as {
    source: string | null;
    utm_campaign: string | null;
    payment_status: string;
    amount_paise: number | null;
  }[];

  const blank = () => ({ leads: 0, paid: 0, revenuePaise: 0 });
  const byChannel = new Map<TrafficSource, ReturnType<typeof blank>>();
  const byCampaign = new Map<string, CampaignStat>();

  for (const row of rows) {
    // Rows written before attribution existed were backfilled to 'direct';
    // anything unrecognised is treated the same way rather than dropped, so
    // the totals here always match the orders list.
    const source: TrafficSource = isTrafficSource(row.source) ? row.source : "direct";
    const isPaid = row.payment_status === "paid";
    const revenue = isPaid ? (row.amount_paise ?? 0) : 0;

    const channel = byChannel.get(source) ?? blank();
    channel.leads += 1;
    if (isPaid) channel.paid += 1;
    channel.revenuePaise += revenue;
    byChannel.set(source, channel);

    if (row.utm_campaign) {
      const key = `${source}::${row.utm_campaign}`;
      const c = byCampaign.get(key) ?? {
        campaign: row.utm_campaign,
        source,
        leads: 0,
        paid: 0,
        revenuePaise: 0,
      };
      c.leads += 1;
      if (isPaid) c.paid += 1;
      c.revenuePaise += revenue;
      byCampaign.set(key, c);
    }
  }

  const pct = (paid: number, leads: number) =>
    leads ? Math.round((paid / leads) * 1000) / 10 : 0;

  const channels: ChannelStat[] = TRAFFIC_SOURCES.map((source) => {
    const s = byChannel.get(source) ?? blank();
    return { source, ...s, conversion: pct(s.paid, s.leads) };
  })
    // Revenue first: the question this page answers is "where should the next
    // hour of effort go", and that's ordered by money, not alphabet.
    .sort((a, b) => b.revenuePaise - a.revenuePaise || b.leads - a.leads);

  const totals = rows.reduce(
    (acc, r) => {
      acc.leads += 1;
      if (r.payment_status === "paid") {
        acc.paid += 1;
        acc.revenuePaise += r.amount_paise ?? 0;
      }
      return acc;
    },
    { leads: 0, paid: 0, revenuePaise: 0, conversion: 0 }
  );
  totals.conversion = pct(totals.paid, totals.leads);

  return {
    channels,
    campaigns: [...byCampaign.values()].sort(
      (a, b) => b.revenuePaise - a.revenuePaise || b.leads - a.leads
    ),
    totals,
  };
}

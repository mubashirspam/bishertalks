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

/**
 * One real way in, as it actually happened.
 *
 * The channel and campaign tables answer "which channel earns", but neither
 * can tell you whether a row came from a link you built or from someone
 * finding the site on their own — a Google search and a Google Ads campaign
 * both land in the "google" channel. This separates the two.
 */
export interface EntryPoint {
  /** Campaign name, referring site, or the fact that there was no signal. */
  label: string;
  /** The link itself, where there is one to show. */
  url: string | null;
  source: TrafficSource;
  /** True when it carries UTM tags — meaning someone built this link. */
  tagged: boolean;
  landingPath: string | null;
  leads: number;
  paid: number;
  revenuePaise: number;
  /** ISO timestamp of the most recent order through this entry point. */
  lastSeen: string;
}

/** What loads with the page. */
export interface Insights {
  channels: ChannelStat[];
  totals: { leads: number; paid: number; revenuePaise: number; conversion: number };
}

/** What loads only when the panel is opened. */
export interface LinkBreakdown {
  campaigns: CampaignStat[];
  entryPoints: EntryPoint[];
}

const isDate = (s?: string): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Where the site lives, for rebuilding tagged links as clickable URLs. */
const SITE_ORIGIN = (
  process.env.NEXT_PUBLIC_APP_URL || "https://bishertalks.com"
).replace(/\/$/, "");

/** Just the hostname, or null if the stored referrer isn't parseable. */
function referrerHost(referrer: string | null): string | null {
  if (!referrer) return null;
  try {
    return new URL(referrer).host.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Rebuild the tagged link that produced this order.
 *
 * The UTM values are stored individually, so the link someone pasted into a
 * bio or an ad can be put back together and clicked to check it still works.
 */
function taggedUrl(row: {
  landing_path: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
}): string {
  const params = new URLSearchParams();
  if (row.utm_source) params.set("utm_source", row.utm_source);
  if (row.utm_medium) params.set("utm_medium", row.utm_medium);
  if (row.utm_campaign) params.set("utm_campaign", row.utm_campaign);
  if (row.utm_content) params.set("utm_content", row.utm_content);

  const query = params.toString();
  return `${SITE_ORIGIN}${row.landing_path ?? "/"}${query ? `?${query}` : ""}`;
}

const pct = (paid: number, leads: number) =>
  leads ? Math.round((paid / leads) * 1000) / 10 : 0;

/** Newest first, and a ceiling that fails loudly rather than silently halving. */
const SCAN_LIMIT = 20000;

/**
 * Channel performance over a date range — the part of the page that always
 * loads.
 *
 * Three columns only. The campaign and link breakdowns need six more, and they
 * sit behind a collapsed panel, so most page loads never ask for them.
 *
 * Aggregated in memory rather than in SQL: at this volume (thousands of orders,
 * not millions) the range fits in a single fetch, and the alternative is a
 * Postgres view per breakdown. If it ever stops fitting, SCAN_LIMIT will make
 * that obvious rather than quietly returning half the truth.
 */
export async function getInsights(filters: {
  from?: string;
  to?: string;
}): Promise<Insights> {
  let query = supabaseAdmin
    .from("orders")
    .select("source,payment_status,amount_paise")
    .order("created_at", { ascending: false })
    .limit(SCAN_LIMIT);

  if (isDate(filters.from)) query = query.gte("created_at", istDayStartUTC(filters.from));
  if (isDate(filters.to)) query = query.lt("created_at", istDayEndUTC(filters.to));

  const { data, error } = await query;
  if (error) {
    console.error("[Insights] channel query failed:", error.message);
  }

  const rows = (data ?? []) as unknown as {
    source: string | null;
    payment_status: string;
    amount_paise: number | null;
  }[];

  const blank = () => ({ leads: 0, paid: 0, revenuePaise: 0 });
  const byChannel = new Map<TrafficSource, ReturnType<typeof blank>>();

  for (const row of rows) {
    // Rows written before attribution existed were backfilled to 'direct';
    // anything unrecognised is treated the same way rather than dropped, so
    // the totals here always match the orders list.
    const source: TrafficSource = isTrafficSource(row.source) ? row.source : "direct";
    const isPaid = row.payment_status === "paid";

    const channel = byChannel.get(source) ?? blank();
    channel.leads += 1;
    if (isPaid) {
      channel.paid += 1;
      channel.revenuePaise += row.amount_paise ?? 0;
    }
    byChannel.set(source, channel);
  }

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

  return { channels, totals };
}

/**
 * Campaigns and entry points — only read when the panel is actually opened.
 *
 * This is the expensive half: six more columns per row, and two groupings over
 * them. Keeping it out of the default page load is the whole point of the panel
 * being collapsed, so don't call this from anywhere that renders unconditionally.
 */
export async function getLinkBreakdown(filters: {
  from?: string;
  to?: string;
}): Promise<LinkBreakdown> {
  let query = supabaseAdmin
    .from("orders")
    .select(
      "source,utm_source,utm_medium,utm_campaign,utm_content,referrer_url," +
        "landing_path,created_at,payment_status,amount_paise"
    )
    .order("created_at", { ascending: false })
    .limit(SCAN_LIMIT);

  if (isDate(filters.from)) query = query.gte("created_at", istDayStartUTC(filters.from));
  if (isDate(filters.to)) query = query.lt("created_at", istDayEndUTC(filters.to));

  const { data, error } = await query;
  if (error) {
    console.error("[Insights] link query failed:", error.message);
  }

  const rows = (data ?? []) as unknown as {
    source: string | null;
    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
    utm_content: string | null;
    referrer_url: string | null;
    landing_path: string | null;
    created_at: string;
    payment_status: string;
    amount_paise: number | null;
  }[];

  const byCampaign = new Map<string, CampaignStat>();
  const byEntry = new Map<string, EntryPoint>();

  for (const row of rows) {
    const source: TrafficSource = isTrafficSource(row.source) ? row.source : "direct";
    const isPaid = row.payment_status === "paid";
    const revenue = isPaid ? (row.amount_paise ?? 0) : 0;

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

    // ── Entry point ────────────────────────────────────────────────────────
    // Three kinds, in order of how much they tell you: a link someone built,
    // a site that linked to us, or no signal at all.
    const tagged = !!(
      row.utm_source ||
      row.utm_medium ||
      row.utm_campaign ||
      row.utm_content
    );
    const host = referrerHost(row.referrer_url);

    let entryKey: string;
    let label: string;
    let url: string | null;

    if (tagged) {
      url = taggedUrl(row);
      // Group on the URL itself, so the same link tagged two different ways
      // stays two rows — that difference is the thing being measured.
      entryKey = `tagged:${url}`;
      label = row.utm_campaign || row.utm_source || "Tagged link";
    } else if (host) {
      // Grouped by site, not by full URL: a hundred distinct Google result
      // pages are one answer — "they found us on Google".
      entryKey = `site:${host}`;
      label = host;
      url = row.referrer_url;
    } else {
      entryKey = "direct";
      label = "No link — typed, bookmarked, or an app that hides it";
      url = null;
    }

    const entry = byEntry.get(entryKey) ?? {
      label,
      url,
      source,
      tagged,
      landingPath: row.landing_path,
      leads: 0,
      paid: 0,
      revenuePaise: 0,
      lastSeen: row.created_at,
    };
    entry.leads += 1;
    if (isPaid) entry.paid += 1;
    entry.revenuePaise += revenue;
    // Rows arrive newest first, so the first one to create the entry already
    // holds the latest timestamp — but don't rely on that ordering here.
    if (row.created_at > entry.lastSeen) entry.lastSeen = row.created_at;
    byEntry.set(entryKey, entry);
  }

  const byRevenue = <T extends { revenuePaise: number; leads: number }>(a: T, b: T) =>
    b.revenuePaise - a.revenuePaise || b.leads - a.leads;

  return {
    campaigns: [...byCampaign.values()].sort(byRevenue),
    entryPoints: [...byEntry.values()].sort(byRevenue),
  };
}

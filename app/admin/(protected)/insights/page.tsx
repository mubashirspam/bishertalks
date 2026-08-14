import Link from "next/link";
import { TrendingUp, Info, ChevronDown, ChevronRight } from "lucide-react";
import { getInsights, getLinkBreakdown } from "@/lib/db/insights";
import { SOURCE_LABELS, SOURCE_BADGE } from "@/lib/attribution";
import { Suspense } from "react";
import DateRange from "./DateRange";
import { SkeletonStats, SkeletonTable } from "@/components/admin/Skeleton";
import { NavigationPending, StaleWhileRevalidating } from "@/components/admin/Revalidating";
import LinkBuilder from "./LinkBuilder";
import { requirePageAccess } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

const rupees = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; links?: string }>;
}) {
  await requirePageAccess("insights.view");

  const { from, to, links } = await searchParams;
  const linksOpen = links === "1";

  return (
    <NavigationPending>
      <div className="mb-6">
        <h1 className="text-2xl font-black flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-primary-500" /> Where sales come from
        </h1>
        <p className="text-neutral-500 text-sm mt-1">
          Every order is tagged with the channel it arrived from. Use this to
          decide where the next hour of effort goes.
        </p>
      </div>

      <DateRange />

      {/* The aggregate scans the whole date range, which is the slow part of
          this page. The controls above are usable while it runs, and changing
          the range keeps the previous figures on screen rather than blanking
          them. */}
      <StaleWhileRevalidating>
        <Suspense
          fallback={
            <>
              <SkeletonStats />
              <SkeletonTable rows={8} columns={5} />
            </>
          }
        >
          <InsightsBody from={from} to={to} />
        </Suspense>
      </StaleWhileRevalidating>

      {/* Campaigns and links, behind a toggle.

          The toggle is a link, not a button, and that's the point: the panel
          being shut isn't a CSS state with the data already fetched behind it,
          it's a page that never ran the query. Opening it navigates, the server
          reads the extra columns, and closing it stops paying for them again.
          Most visits to this page only want the channel table at the top. */}
      <div className="mt-5">
        <Link
          href={linkHref({ from, to, links: linksOpen ? undefined : "1" })}
          scroll={false}
          className="w-full flex items-center justify-between gap-2 bg-white border border-neutral-200 rounded-2xl px-4 py-3 shadow-sm hover:bg-neutral-50 transition-colors"
        >
          <span className="text-left">
            <span className="block font-bold text-sm text-neutral-700">
              Which links brought the orders
            </span>
            <span className="block text-xs text-neutral-500 mt-0.5">
              Campaign totals, and every link that produced an order — including
              the ones you never tagged.
            </span>
          </span>
          {linksOpen ? (
            <ChevronDown className="w-4 h-4 text-neutral-400 flex-shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 text-neutral-400 flex-shrink-0" />
          )}
        </Link>

        {linksOpen && (
          <Suspense fallback={<SkeletonTable rows={6} columns={5} />}>
            <LinkBreakdownBody from={from} to={to} />
          </Suspense>
        )}
      </div>

      {/* Needs no data — render it now, not after the aggregate. */}
      <div className="mt-5">
        <LinkBuilder />
      </div>
    </NavigationPending>
  );
}

/** Rebuild the page's own URL, keeping the date range across a toggle. */
function linkHref(params: { from?: string; to?: string; links?: string }): string {
  const q = new URLSearchParams();
  if (params.from) q.set("from", params.from);
  if (params.to) q.set("to", params.to);
  if (params.links) q.set("links", params.links);
  const s = q.toString();
  return s ? `/admin/insights?${s}` : "/admin/insights";
}

/** Enough to see what's working; the tail is one-order links. */
const ENTRY_POINT_LIMIT = 25;

const dayMonth = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "Asia/Kolkata",
  });

async function InsightsBody({ from, to }: { from?: string; to?: string }) {
  const { channels, totals } = await getInsights({ from, to });
  const maxRevenue = Math.max(...channels.map((c) => c.revenuePaise), 1);

  return (
    <div>
      {/* Totals */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        {[
          { label: "Leads", value: totals.leads.toLocaleString("en-IN") },
          { label: "Paid orders", value: totals.paid.toLocaleString("en-IN") },
          { label: "Revenue", value: rupees(totals.revenuePaise) },
          { label: "Lead → paid", value: `${totals.conversion}%` },
        ].map((s) => (
          <div key={s.label} className="bg-white border border-neutral-200 rounded-2xl p-4 shadow-sm">
            <p className="text-xs text-neutral-500">{s.label}</p>
            <p className="text-2xl font-black text-neutral-900 mt-1">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Channels */}
      <div className="bg-white border border-neutral-200 rounded-2xl overflow-hidden shadow-sm mb-5">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left bg-neutral-50">
                {["Channel", "Revenue", "Paid", "Leads", "Lead → paid"].map((h) => (
                  <th key={h} className="px-4 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {channels.map((c) => (
                <tr key={c.source} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50 transition-colors">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/orders?source=${c.source}`}
                      className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium border ${SOURCE_BADGE[c.source]}`}
                    >
                      {SOURCE_LABELS[c.source]}
                    </Link>
                  </td>
                  <td className="px-4 py-3 min-w-[160px]">
                    <p className="text-neutral-900 font-semibold">{rupees(c.revenuePaise)}</p>
                    {/* Bar rather than a chart: one dimension, read at a glance,
                        no library. */}
                    <div className="h-1.5 bg-neutral-100 rounded-full mt-1.5 overflow-hidden">
                      <div
                        className="h-full bg-primary-500 rounded-full"
                        style={{ width: `${(c.revenuePaise / maxRevenue) * 100}%` }}
                      />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-neutral-900">{c.paid}</td>
                  <td className="px-4 py-3 text-neutral-500">{c.leads}</td>
                  <td className="px-4 py-3">
                    <span className={c.conversion >= totals.conversion ? "text-green-600 font-medium" : "text-neutral-500"}>
                      {c.conversion}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* The honest caveat, on the page rather than buried in a doc. */}
      <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 mb-5 text-sm">
        <Info className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
        <p className="text-blue-900">
          Instagram and Facebook open links in their own browser and hide where
          the visitor came from; WhatsApp sends nothing at all. Untagged traffic
          from those apps lands in <strong>Direct</strong>. Use the tagged links
          below everywhere and Direct will shrink to people who typed the address.
        </p>
      </div>

    </div>
  );
}

/**
 * The half that only runs when someone opens the panel.
 *
 * Its own query, so a page load with the panel shut costs the three-column
 * channel scan and nothing more.
 */
async function LinkBreakdownBody({ from, to }: { from?: string; to?: string }) {
  const { campaigns, entryPoints } = await getLinkBreakdown({ from, to });

  if (!campaigns.length && !entryPoints.length) {
    return (
      <p className="mt-3 text-sm text-neutral-500 bg-white border border-neutral-200 rounded-2xl px-4 py-6 text-center">
        No orders in this date range.
      </p>
    );
  }

  return (
    <div>
      {/* Campaigns */}
      {campaigns.length > 0 && (
        <div className="mt-3">
          <h2 className="font-bold text-sm text-neutral-700 mb-3">By campaign</h2>
          <div className="bg-white border border-neutral-200 rounded-2xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 text-left bg-neutral-50">
                    {["Campaign", "Channel", "Revenue", "Paid", "Leads"].map((h) => (
                      <th key={h} className="px-4 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((c) => (
                    <tr key={`${c.source}-${c.campaign}`} className="border-b border-neutral-100 last:border-0">
                      <td className="px-4 py-3 text-neutral-900 font-medium">{c.campaign}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium border ${SOURCE_BADGE[c.source]}`}>
                          {SOURCE_LABELS[c.source]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-neutral-900 font-semibold">{rupees(c.revenuePaise)}</td>
                      <td className="px-4 py-3 text-neutral-900">{c.paid}</td>
                      <td className="px-4 py-3 text-neutral-500">{c.leads}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Entry points — every real way in, tagged or not. */}
      {entryPoints.length > 0 && (
        <div className="mt-5">
          <h2 className="font-bold text-sm text-neutral-700 mb-1">Every link</h2>
          <p className="text-xs text-neutral-500 mb-3">
            Rows marked <strong>Built</strong> came from a tagged link you made.
            Rows marked <strong>Found us</strong> arrived on their own — someone
            searched, or another site linked to you. Nothing to set up, and
            nothing missing if you don&apos;t recognise the link.
          </p>
          <div className="bg-white border border-neutral-200 rounded-2xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 text-left bg-neutral-50">
                    {["Link", "Channel", "How", "Revenue", "Paid", "Leads", "Last"].map((h) => (
                      <th key={h} className="px-4 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {entryPoints.slice(0, ENTRY_POINT_LIMIT).map((e) => (
                    <tr
                      key={`${e.label}-${e.url ?? "none"}`}
                      className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50 transition-colors"
                    >
                      <td className="px-4 py-3 max-w-[320px]">
                        <p className="text-neutral-900 font-medium truncate">{e.label}</p>
                        {e.url && (
                          // rel=noreferrer because this is an untrusted URL that
                          // arrived from a visitor's browser, not something we set.
                          <a
                            href={e.url}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="text-[11px] text-neutral-500 hover:text-primary-600 hover:underline break-all"
                          >
                            {e.url}
                          </a>
                        )}
                        {!e.url && e.landingPath && (
                          <p className="text-[11px] text-neutral-400">
                            landed on {e.landingPath}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium border ${SOURCE_BADGE[e.source]}`}>
                          {SOURCE_LABELS[e.source]}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium border ${
                            e.tagged
                              ? "bg-primary-50 text-primary-700 border-primary-200"
                              : "bg-neutral-100 text-neutral-600 border-neutral-200"
                          }`}
                        >
                          {e.tagged ? "Built" : "Found us"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-neutral-900 font-semibold">{rupees(e.revenuePaise)}</td>
                      <td className="px-4 py-3 text-neutral-900">{e.paid}</td>
                      <td className="px-4 py-3 text-neutral-500">{e.leads}</td>
                      <td className="px-4 py-3 text-neutral-500 whitespace-nowrap">{dayMonth(e.lastSeen)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Every Meta ad creative is its own link, so this list grows fast.
                The tail is all single orders — say it's there rather than
                printing a hundred rows nobody scrolls to. */}
            {entryPoints.length > ENTRY_POINT_LIMIT && (
              <p className="px-4 py-3 text-xs text-neutral-500 border-t border-neutral-100 bg-neutral-50">
                Showing the top {ENTRY_POINT_LIMIT} by revenue.{" "}
                {entryPoints.length - ENTRY_POINT_LIMIT} more link
                {entryPoints.length - ENTRY_POINT_LIMIT === 1 ? "" : "s"} brought
                fewer orders. Narrow the date range to see them.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

import Link from "next/link";
import { TrendingUp, Info } from "lucide-react";
import { getInsights } from "@/lib/db/insights";
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
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  await requirePageAccess("insights.view");

  const { from, to } = await searchParams;

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

      {/* Needs no data — render it now, not after the aggregate. */}
      <div className="mt-5">
        <LinkBuilder />
      </div>
    </NavigationPending>
  );
}

async function InsightsBody({ from, to }: { from?: string; to?: string }) {
  const { channels, campaigns, totals } = await getInsights({ from, to });
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

      {/* Campaigns */}
      {campaigns.length > 0 && (
        <div className="mt-5">
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
    </div>
  );
}

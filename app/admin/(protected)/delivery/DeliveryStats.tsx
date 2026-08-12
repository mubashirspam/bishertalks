import { AlertTriangle, Clock } from "lucide-react";
import type { DeliveryStats } from "@/lib/db/delivery-stats";
import { DELIVERY_SHORT, type DeliveryStage } from "@/lib/delivery-stage";
import { timeAgo } from "@/lib/format-date";

/**
 * The shape of the delivery operation, above the queue itself.
 *
 * Four questions, in the order they get asked: what's in the pipeline, who is
 * carrying it, what has stalled, and are we getting faster or slower. A server
 * component — none of it is interactive, and the numbers arrive with the page.
 *
 * Bars are hand-rolled with pixel heights, matching RevenueCharts: no chart
 * library in the admin bundle, and percentage heights inside auto-height flex
 * columns collapse to zero.
 */

/** Plot height in px. Half the revenue chart's — this is a strip, not a page. */
const BAR_H = 44;

/** Pipeline tiles, left to right in the order work moves. */
const PIPELINE: DeliveryStage[] = [
  "new",
  "assigned",
  "shipped",
  "delivered",
  "returned",
];

const TILE_TONE: Record<string, string> = {
  new: "text-orange-600",
  assigned: "text-blue-600",
  shipped: "text-purple-600",
  delivered: "text-green-600",
  returned: "text-rose-600",
};

/** "12 Aug" from a YYYY-MM-DD IST day. */
function dayLabel(day: string): string {
  const [, m, d] = day.split("-");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${Number(d)} ${months[Number(m) - 1]}`;
}

export default function DeliveryStatsStrip({ stats }: { stats: DeliveryStats }) {
  const { totals, agents, ageing, throughput } = stats;
  const maxDay = Math.max(...throughput.map((t) => t.shipped + t.delivered), 1);
  const stalled = ageing.over24h + ageing.over48h;

  return (
    <div className="bg-white border border-neutral-200 rounded-2xl shadow-sm mb-5 overflow-hidden">
      {/* ── Pipeline ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 divide-x divide-y lg:divide-y-0 divide-neutral-100">
        {PIPELINE.map((stage) => (
          <div key={stage} className="px-4 py-3">
            <p className={`text-2xl font-black ${TILE_TONE[stage]}`}>
              {totals[stage] ?? 0}
            </p>
            <p className="text-[11px] text-neutral-500 uppercase tracking-wider mt-0.5">
              {DELIVERY_SHORT[stage]}
            </p>
          </div>
        ))}
      </div>

      {/* ── Stalled work ─────────────────────────────────────────────────── */}
      {(stalled > 0 || ageing.oldestUnshipped) && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 px-4 py-2.5 border-t border-neutral-100 bg-amber-50/40 text-xs">
          {ageing.over48h > 0 && (
            <span className="flex items-center gap-1.5 text-rose-700 font-semibold">
              <AlertTriangle className="w-3.5 h-3.5" />
              {ageing.over48h} assigned over 48h without going to the courier
            </span>
          )}
          {ageing.over24h > 0 && (
            <span className="flex items-center gap-1.5 text-amber-700">
              <Clock className="w-3.5 h-3.5" />
              {ageing.over24h} waiting over 24h
            </span>
          )}
          {ageing.oldestUnshipped && (
            <span className="text-neutral-500">
              Oldest assigned parcel still unshipped:{" "}
              {timeAgo(ageing.oldestUnshipped)}
            </span>
          )}
        </div>
      )}

      <div className="grid lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-neutral-100 border-t border-neutral-100">
        {/* ── Who is carrying what ───────────────────────────────────────── */}
        <div className="p-4">
          <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2.5">
            By agent
          </h3>
          {!agents.length ? (
            <p className="text-xs text-neutral-400">
              Nothing assigned yet in this view.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-neutral-400 text-left">
                    <th className="font-medium pb-1.5 pr-3">Agent</th>
                    <th className="font-medium pb-1.5 px-2 text-right" title="Holding, not yet with the courier">Holding</th>
                    <th className="font-medium pb-1.5 px-2 text-right" title="Of those, entered into the courier's system">Confirmed</th>
                    <th className="font-medium pb-1.5 px-2 text-right">Shipped</th>
                    <th className="font-medium pb-1.5 px-2 text-right">Delivered</th>
                    <th className="font-medium pb-1.5 pl-2 text-right">Returned</th>
                  </tr>
                </thead>
                <tbody>
                  {agents.map((a) => (
                    <tr key={a.id} className="border-t border-neutral-100">
                      <td className="py-1.5 pr-3 font-medium text-neutral-800 whitespace-nowrap">
                        {a.name}
                        {a.stale > 0 && (
                          <span
                            title={`${a.stale} sitting over 24h without being entered`}
                            className="ml-1.5 inline-flex items-center px-1.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold"
                          >
                            {a.stale} late
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 px-2 text-right font-semibold text-blue-600">{a.assigned}</td>
                      <td className="py-1.5 px-2 text-right text-neutral-600">{a.confirmed}</td>
                      <td className="py-1.5 px-2 text-right text-purple-600">{a.shipped}</td>
                      <td className="py-1.5 px-2 text-right text-green-600">{a.delivered}</td>
                      <td className="py-1.5 pl-2 text-right text-rose-600">{a.returned}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Throughput ─────────────────────────────────────────────────── */}
        <div className="p-4">
          <div className="flex items-baseline justify-between mb-2.5">
            <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">
              Shipped &amp; delivered
            </h3>
            <p className="text-[10px] text-neutral-400 flex items-center gap-2">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-sm bg-purple-500" /> shipped
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-sm bg-green-500" /> delivered
              </span>
            </p>
          </div>

          {!throughput.length ? (
            <p className="text-xs text-neutral-400">
              Nothing has shipped in this view yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[360px]">
                <div className="flex gap-1 items-end" style={{ height: BAR_H }}>
                  {throughput.map((t) => (
                    <div
                      key={t.day}
                      className="flex-1 min-w-0 flex flex-col justify-end gap-px"
                      title={`${dayLabel(t.day)}: ${t.shipped} shipped, ${t.delivered} delivered`}
                    >
                      {t.delivered > 0 && (
                        <div
                          className="w-full rounded-t-sm bg-green-500"
                          style={{ height: Math.max((t.delivered / maxDay) * BAR_H, 3) }}
                        />
                      )}
                      {t.shipped > 0 && (
                        <div
                          className={`w-full bg-purple-500 ${t.delivered > 0 ? "" : "rounded-t-sm"}`}
                          style={{ height: Math.max((t.shipped / maxDay) * BAR_H, 3) }}
                        />
                      )}
                      {!t.shipped && !t.delivered && (
                        <div className="w-full bg-neutral-200" style={{ height: 3 }} />
                      )}
                    </div>
                  ))}
                </div>
                <div className="flex gap-1 mt-1.5 border-t border-neutral-200 pt-1.5">
                  {throughput.map((t) => (
                    <span
                      key={t.day}
                      className="flex-1 text-center text-[9px] text-neutral-400 truncate"
                    >
                      {dayLabel(t.day)}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {stats.sampled && (
        <p className="text-[11px] text-neutral-400 px-4 py-2 border-t border-neutral-100">
          Figures cover the most recent 5,000 orders matching these filters —
          narrow the dates for an exact count.
        </p>
      )}
    </div>
  );
}

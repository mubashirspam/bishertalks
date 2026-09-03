import Link from "@/components/admin/AdminLink";
import { AlertTriangle } from "lucide-react";
import { reportHref, type ReportFilters } from "@/lib/report-filters";
import type { ReportSummary } from "@/lib/db/parcel-report";

/**
 * The counts, above everything.
 *
 * Seven numbers in the order a parcel moves through them, so reading left to
 * right is reading the pipeline. Late sits at the end in its own colour
 * because it is not a stage — it is a judgement about the ones before it, and
 * a parcel counted as Late is also counted as Not shipped or In transit.
 *
 * Every tile is a link that narrows the table below to exactly what it counted.
 * A count you cannot open is a number somebody has to go and rebuild by hand.
 *
 * The tiles deliberately ignore the stage chips, the ageing bucket and the
 * late-only switch — they are the breakdown those three select from, and a
 * breakdown narrowed to one of its own rows would read 100% of itself. Same
 * rule the delivery screen's stats strip follows.
 */

const rupees = (paise: number) =>
  `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;

const n = (v: number) => v.toLocaleString("en-IN");

function Tile({
  label,
  value,
  sub,
  href,
  tone = "neutral",
  active = false,
}: {
  label: string;
  value: string;
  sub?: string;
  href: string;
  tone?: "neutral" | "warn" | "bad" | "good" | "muted";
  active?: boolean;
}) {
  const valueTone = {
    neutral: "text-neutral-900",
    warn: "text-amber-600",
    bad: "text-rose-600",
    good: "text-green-600",
    muted: "text-neutral-400",
  }[tone];

  return (
    <Link
      href={href}
      className={`block px-4 py-3 transition-colors hover:bg-neutral-50 ${
        active ? "bg-neutral-50" : ""
      }`}
    >
      <p className={`text-2xl font-black ${valueTone}`}>{value}</p>
      <p className="text-[11px] text-neutral-500 uppercase tracking-wider mt-0.5">
        {label}
      </p>
      {sub && <p className="text-[11px] text-neutral-400 mt-0.5">{sub}</p>}
    </Link>
  );
}

export default function SummaryTiles({
  summary,
  filters,
}: {
  summary: ReportSummary;
  filters: ReportFilters;
}) {
  const h = summary.headline;

  // Of the parcels that have finished their journey, how many arrived. Counted
  // against delivered + returned rather than against everything, because a
  // parcel still in transit has not failed — including it would make the rate
  // climb on its own as a busy week's parcels land, which reads as improvement
  // where there was none.
  const finished = h.delivered + h.returned;
  const rate = finished ? Math.round((h.delivered / finished) * 100) : null;

  const stageHref = (stages: string) => reportHref(filters, { stage: stages });

  return (
    <div className="bg-white border border-neutral-200 rounded-2xl shadow-sm mb-5 overflow-hidden">
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 divide-x divide-y lg:divide-y-0 divide-neutral-100">
        <Tile
          label="Parcels"
          value={n(h.parcels)}
          sub={`${n(h.books)} books · ${rupees(h.revenue_paise)}`}
          href={reportHref(filters, { stage: null, only_late: null, age_min: null, age_max: null })}
          active={!filters.stages.length && !filters.onlyLate}
        />
        <Tile
          label="Not shipped"
          value={n(h.not_shipped)}
          sub="waiting to go"
          tone={h.not_shipped > 0 ? "warn" : "muted"}
          href={stageHref("new,assigned")}
          active={filters.stages.join(",") === "new,assigned"}
        />
        <Tile
          label="In transit"
          value={n(h.in_transit)}
          sub="on the road"
          href={stageHref("shipped,out_for_delivery")}
          active={filters.stages.join(",") === "shipped,out_for_delivery"}
        />
        <Tile
          label="Delivered"
          value={n(h.delivered)}
          sub={rate === null ? undefined : `${rate}% of finished`}
          tone="good"
          href={stageHref("delivered")}
          active={filters.stages.join(",") === "delivered"}
        />
        <Tile
          label="Returned"
          value={n(h.returned)}
          tone={h.returned > 0 ? "bad" : "muted"}
          href={stageHref("returned")}
          active={filters.stages.join(",") === "returned"}
        />
        <Tile
          label="Cancelled"
          value={n(h.cancelled)}
          tone="muted"
          href={stageHref("cancelled")}
          active={filters.stages.join(",") === "cancelled"}
        />
        <Tile
          label={`Late > ${filters.late}d`}
          value={n(h.late)}
          sub={`since ${filters.lateFrom === "ordered" ? "ordered" : filters.lateFrom === "shipped" ? "shipped" : "assigned"}`}
          tone={h.late > 0 ? "bad" : "muted"}
          href={reportHref(filters, { only_late: "1", stage: null })}
          active={filters.onlyLate}
        />
      </div>

      {/* How long delivery actually takes, under whatever is filtered above.
          Two numbers rather than one: the average is dragged up by a handful
          of parcels that took a month, and the median is what most customers
          actually experienced. */}
      {(h.avg_days !== null || h.median_days !== null) && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2.5 border-t border-neutral-100 bg-neutral-50/60 text-xs text-neutral-600">
          {h.median_days !== null && (
            <span>
              Half of delivered parcels arrived within{" "}
              <strong className="text-neutral-900">
                {Math.round(h.median_days)} days
              </strong>
            </span>
          )}
          {h.avg_days !== null && (
            <span className="text-neutral-500">
              average {h.avg_days} days, order to doorstep
            </span>
          )}
        </div>
      )}

      {h.late > 0 && !filters.onlyLate && (
        <Link
          href={reportHref(filters, { only_late: "1", stage: null })}
          className="flex items-center gap-2 px-4 py-2.5 border-t border-neutral-100 bg-rose-50/60 text-xs text-rose-700 hover:bg-rose-50 transition-colors"
        >
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>
            <strong>{n(h.late)}</strong> parcels have been waiting more than{" "}
            {filters.late} days and have not been delivered — open the list
          </span>
        </Link>
      )}
    </div>
  );
}

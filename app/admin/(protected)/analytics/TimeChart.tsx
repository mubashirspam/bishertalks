import type { ReportSummary } from "@/lib/db/parcel-report";

/**
 * Parcels out and parcels arrived, over time.
 *
 * Two series rather than one, side by side in each column: shipped is what we
 * did, delivered is what happened. A month where the two bars are level is a
 * month that cleared; a month where shipping runs ahead of delivery is either
 * a busy end of month or a backlog forming, and the ageing bars above say
 * which.
 *
 * Days or months, chosen by the range's width — a fortnight of daily bars is
 * readable, a year of monthly ones is too, and a year of days is 365 slivers.
 * The caller decides in `bucketFor`; this only renders what it is handed.
 *
 * Hand-rolled with pixel heights, matching RevenueCharts and the delivery
 * stats strip: no chart library in the admin bundle, and percentage heights
 * inside auto-height flex columns collapse to zero.
 */

const BAR_H = 96;

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "Aug" from 2026-08, "12 Aug" from 2026-08-12. */
function bucketLabel(bucket: string, unit: "day" | "month"): string {
  const [, m, d] = bucket.split("-");
  const month = MONTHS[Number(m) - 1] ?? m;
  return unit === "day" ? `${Number(d)} ${month}` : month;
}

/** "August 2026" / "12 August 2026", for the hover title. */
function bucketTitle(bucket: string, unit: "day" | "month"): string {
  const [y, m, d] = bucket.split("-");
  const month = MONTHS[Number(m) - 1] ?? m;
  return unit === "day" ? `${Number(d)} ${month} ${y}` : `${month} ${y}`;
}

export default function TimeChart({ summary }: { summary: ReportSummary }) {
  const { buckets, bucketUnit } = summary;

  if (!buckets.length) {
    return (
      <div className="bg-white border border-neutral-200 rounded-2xl p-4 shadow-sm">
        <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">
          Shipped and delivered
        </h3>
        <p className="text-xs text-neutral-400">
          Nothing has shipped in this view yet.
        </p>
      </div>
    );
  }

  const max = Math.max(...buckets.map((b) => Math.max(b.shipped, b.delivered)), 1);
  const totalShipped = buckets.reduce((a, b) => a + b.shipped, 0);
  const totalDelivered = buckets.reduce((a, b) => a + b.delivered, 0);

  // Below this many columns the labels fit under every bar; above it they
  // would overlap into a grey smear, so only every other one is drawn.
  const everyOther = buckets.length > 20;

  return (
    <div className="bg-white border border-neutral-200 rounded-2xl p-4 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">
          Shipped and delivered, by {bucketUnit}
        </h3>
        <p className="text-[11px] text-neutral-500 flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-purple-500" />
            {totalShipped.toLocaleString("en-IN")} shipped
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-green-500" />
            {totalDelivered.toLocaleString("en-IN")} delivered
          </span>
        </p>
      </div>

      <div className="overflow-x-auto">
        <div style={{ minWidth: Math.max(buckets.length * 28, 320) }}>
          <div className="flex gap-1.5 items-end" style={{ height: BAR_H }}>
            {buckets.map((b) => (
              <div
                key={b.bucket}
                className="flex-1 min-w-0 flex items-end justify-center gap-px"
                title={`${bucketTitle(b.bucket, bucketUnit)}: ${b.shipped} shipped, ${b.delivered} delivered`}
              >
                <div
                  className="flex-1 rounded-t-sm bg-purple-500"
                  style={{ height: Math.max((b.shipped / max) * BAR_H, b.shipped ? 3 : 1) }}
                />
                <div
                  className="flex-1 rounded-t-sm bg-green-500"
                  style={{ height: Math.max((b.delivered / max) * BAR_H, b.delivered ? 3 : 1) }}
                />
              </div>
            ))}
          </div>

          <div className="flex gap-1.5 mt-1.5 border-t border-neutral-200 pt-1.5">
            {buckets.map((b, i) => (
              <span
                key={b.bucket}
                className="flex-1 min-w-0 text-center text-[9px] text-neutral-400 truncate"
              >
                {everyOther && i % 2 === 1 ? "" : bucketLabel(b.bucket, bucketUnit)}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

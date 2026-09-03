import Link from "@/components/admin/AdminLink";
import { AGE_BUCKETS, reportHref, type ReportFilters } from "@/lib/report-filters";
import type { ReportSummary } from "@/lib/db/parcel-report";

/**
 * How long the parcels still owed to somebody have been waiting.
 *
 * Undelivered and unreturned only — a delivered parcel's age is history, and
 * mixing the two would make these bars sum to more than the pipeline while
 * hiding the shape that matters: whether the waiting is a tail of a few old
 * parcels or a wall of them.
 *
 * The boundaries are 2, 5, 10 and 15 days, matching the late chips, so the
 * bucket a parcel sits in and the threshold that flags it as late tell the
 * same story instead of two slightly different ones.
 *
 * Bars are divs with pixel widths — no chart library in the admin bundle,
 * matching RevenueCharts and the delivery stats strip.
 */

/** Widest bar, in pixels. Horizontal because the labels are words, not dates. */
const BAR_MAX = 240;

/** Warm as the wait gets longer. The last two are the ones to act on. */
const TONE: Record<string, { bar: string; text: string }> = {
  "0-2": { bar: "bg-green-500", text: "text-green-700" },
  "3-5": { bar: "bg-lime-500", text: "text-lime-700" },
  "6-10": { bar: "bg-amber-500", text: "text-amber-700" },
  "11-15": { bar: "bg-orange-500", text: "text-orange-700" },
  "16+": { bar: "bg-rose-500", text: "text-rose-700" },
};

export default function AgeingBuckets({
  summary,
  filters,
}: {
  summary: ReportSummary;
  filters: ReportFilters;
}) {
  const rows = AGE_BUCKETS.map((b) => ({
    ...b,
    n: summary.ageing[b.key] ?? 0,
  }));

  const total = rows.reduce((a, b) => a + b.n, 0);
  const max = Math.max(...rows.map((r) => r.n), 1);

  if (!total) {
    return (
      <div className="bg-white border border-neutral-200 rounded-2xl p-4 shadow-sm">
        <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">
          How long they have been waiting
        </h3>
        <p className="text-xs text-neutral-400">
          Nothing is waiting in this view — every parcel has been delivered,
          returned or cancelled.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-neutral-200 rounded-2xl p-4 shadow-sm">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">
          How long they have been waiting
        </h3>
        <p className="text-[11px] text-neutral-400">
          {total.toLocaleString("en-IN")} parcels not yet delivered, by days
          since the order
        </p>
      </div>

      <div className="space-y-1.5">
        {rows.map((r) => {
          const tone = TONE[r.key];
          const selected =
            filters.ageMin === r.min &&
            (r.max === null ? filters.ageMax === undefined : filters.ageMax === r.max);

          return (
            <Link
              key={r.key}
              // The open-ended top bucket sends no maximum, which is what makes
              // "16+" mean 16 and up rather than 16 to nothing.
              href={reportHref(filters, {
                age_min: selected ? null : String(r.min),
                age_max: selected || r.max === null ? null : String(r.max),
                stage: null,
              })}
              className={`flex items-center gap-3 rounded-lg px-2 py-1 -mx-2 transition-colors hover:bg-neutral-50 ${
                selected ? "bg-neutral-50" : ""
              }`}
            >
              <span className="w-20 shrink-0 text-xs text-neutral-600">
                {r.label}
              </span>
              <span className="flex-1 min-w-0">
                <span
                  className={`block h-3 rounded-sm ${tone.bar}`}
                  style={{
                    width: Math.max((r.n / max) * BAR_MAX, r.n ? 4 : 1),
                    // Capped at the container so a single dominant bucket
                    // cannot push the count off the right edge.
                    maxWidth: "100%",
                  }}
                />
              </span>
              <span
                className={`w-14 shrink-0 text-right text-xs font-bold ${
                  r.n ? tone.text : "text-neutral-300"
                }`}
              >
                {r.n.toLocaleString("en-IN")}
              </span>
              <span className="w-10 shrink-0 text-right text-[11px] text-neutral-400">
                {total ? Math.round((r.n / total) * 100) : 0}%
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

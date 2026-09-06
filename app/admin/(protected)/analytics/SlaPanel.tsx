import Link from "@/components/admin/AdminLink";
import { ArrowRight, Clock, AlertTriangle } from "lucide-react";
import type { SlaReport } from "@/lib/db/delivery-sla";

/**
 * The delivery promise, and who is not keeping it.
 *
 * Three legs, each with its own target, because they point at three different
 * people: routing is ours, handover is the packing bench, transit is the
 * courier. One "days since the order" number blames all three at once and
 * tells nobody what to do.
 *
 * Every card carries two numbers that must not be blended:
 *
 *   PAST     of the legs that finished, how many came in on target. A
 *            scoreboard. It moves slowly and it is the one to judge by.
 *   NOW      how many parcels are sitting on this leg already past target.
 *            An action. It is the big number, and it is a link, because
 *            reading it without being able to open the list is useless.
 *
 * The link hands the parcel table below the exact filters behind the number —
 * the same stages, the same basis, the same threshold — so the count on the
 * card and the rows you land on always agree. They are computed by different
 * code in different languages (lib/db/delivery-sla.ts here, `report_scope` in
 * migration 0058 there), so both count WHOLE IST DAYS and both treat "late" as
 * strictly more than the target. Exactly two days is on time in both.
 */

function pct(part: number, whole: number): number | null {
  return whole ? Math.round((part / whole) * 100) : null;
}

/** Green when the promise is being kept, amber when it is slipping, red when not. */
function tone(percentage: number | null): {
  text: string;
  bar: string;
  chip: string;
} {
  if (percentage === null) return { text: "text-neutral-400", bar: "bg-neutral-200", chip: "bg-neutral-100 text-neutral-500" };
  if (percentage >= 90) return { text: "text-green-700", bar: "bg-green-500", chip: "bg-green-50 text-green-700" };
  if (percentage >= 70) return { text: "text-amber-700", bar: "bg-amber-500", chip: "bg-amber-50 text-amber-700" };
  return { text: "text-red-700", bar: "bg-red-500", chip: "bg-red-50 text-red-700" };
}

export default function SlaPanel({ report }: { report: SlaReport }) {
  const totalBreaching = report.legs.reduce((n, l) => n + l.breachingNow, 0);

  return (
    <section className="mb-5">
      <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-bold text-neutral-800">
          <Clock className="h-4 w-4 text-primary-500" />
          Delivery promise
        </h2>
        <p className="text-xs text-neutral-500">
          {totalBreaching > 0 ? (
            <>
              <strong className="tabular-nums text-red-700">{totalBreaching}</strong>{" "}
              parcels are past target right now
            </>
          ) : (
            "Every parcel is inside its target"
          )}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {report.legs.map((l) => {
          const within = pct(l.withinTarget, l.completed);
          const t = tone(within);

          // The same query this card's number was counted from.
          const chase = new URLSearchParams({
            stage: l.leg.stages.join(","),
            late: String(l.leg.target),
            late_from: l.leg.basis,
            only_late: "1",
            sort: "age",
          });

          return (
            <div
              key={l.leg.key}
              className="flex flex-col rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-neutral-900">{l.leg.label}</p>
                  <p className="mt-0.5 text-xs text-neutral-400">{l.leg.blurb}</p>
                </div>
                <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-neutral-600">
                  ≤ {l.leg.target}d
                </span>
              </div>

              {/* ── The scoreboard ─────────────────────────────────────── */}
              <div className="mt-4">
                <div className="flex items-baseline gap-2">
                  <span className={`text-2xl font-black tabular-nums ${t.text}`}>
                    {within === null ? "—" : `${within}%`}
                  </span>
                  <span className="text-xs text-neutral-500">on target</span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-neutral-100">
                  <div
                    className={`h-full rounded-full ${t.bar}`}
                    style={{ width: `${within ?? 0}%` }}
                  />
                </div>
                <p className="mt-1.5 text-[11px] tabular-nums text-neutral-400">
                  {l.completed.toLocaleString("en-IN")} finished
                  {l.medianDays !== null && ` · median ${l.medianDays}d`}
                  {l.p90Days !== null && ` · 9 in 10 within ${l.p90Days}d`}
                </p>
              </div>

              {/* ── The action ─────────────────────────────────────────── */}
              <div className="mt-4 border-t border-neutral-100 pt-3">
                {l.breachingNow > 0 ? (
                  <Link
                    href={`/admin/analytics?${chase.toString()}`}
                    className="group flex items-center gap-2 text-sm"
                  >
                    <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" />
                    <span className="min-w-0 flex-1">
                      <strong className="tabular-nums text-red-700">
                        {l.breachingNow}
                      </strong>
                      <span className="text-neutral-600">
                        {" "}
                        of {l.openNow} past target
                      </span>
                      {l.worstDays !== null && (
                        <span className="block text-[11px] tabular-nums text-neutral-400">
                          worst is {l.worstDays} days
                        </span>
                      )}
                    </span>
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-neutral-400 transition group-hover:translate-x-0.5 group-hover:text-neutral-700" />
                  </Link>
                ) : (
                  <p className="text-sm text-neutral-500">
                    <span className="tabular-nums">{l.openNow}</span> in progress, none
                    past target
                  </p>
                )}

                {/* Said plainly rather than hidden. A compliance figure quietly
                    computed over part of the data is worse than no figure. */}
                {l.unmeasurable > 0 && (
                  <p className="mt-2 text-[11px] text-neutral-400">
                    {l.unmeasurable.toLocaleString("en-IN")} parcels can&apos;t be scored
                    on this leg — no start timestamp.
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

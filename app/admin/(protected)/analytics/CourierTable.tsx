import Link from "@/components/admin/AdminLink";
import { reportHref, type ReportFilters } from "@/lib/report-filters";
import type { ReportSummary, CourierStat } from "@/lib/db/parcel-report";

/**
 * What each courier is carrying, and how it is going.
 *
 * The table this screen was asked for. Reading across a row says whether a
 * partner is moving parcels or sitting on them; reading down the Late column
 * says which partner to ring. Neither is visible from a per-courier total,
 * which is all the delivery screen could ever show.
 *
 * "Nobody — not routed yet" is a row, not an omission. It is usually the
 * largest pile and it is the one most worth clicking, because every parcel in
 * it is waiting on a decision nobody has made.
 *
 * Every cell with anything in it is a link: the count is the question and the
 * list at the bottom of the page is the answer.
 */

const NONE = "none";

/** Column definitions, in pipeline order. Each one filters differently. */
const COLUMNS: {
  key: keyof CourierStat;
  label: string;
  stages: string | null;
  tone: string;
  title: string;
}[] = [
  {
    key: "not_shipped",
    label: "Not shipped",
    stages: "new,assigned",
    tone: "text-amber-600",
    title: "Routed or not, and still with us",
  },
  {
    key: "in_transit",
    label: "In transit",
    stages: "shipped,out_for_delivery",
    tone: "text-purple-600",
    title: "Shipped or out for delivery",
  },
  {
    key: "delivered",
    label: "Delivered",
    stages: "delivered",
    tone: "text-green-600",
    title: "Arrived",
  },
  {
    key: "returned",
    label: "Returned",
    stages: "returned",
    tone: "text-rose-600",
    title: "Went out and came back",
  },
  {
    key: "cancelled",
    label: "Cancelled",
    stages: "cancelled",
    tone: "text-neutral-400",
    title: "Stopped before it went",
  },
];

export default function CourierTable({
  summary,
  names,
  filters,
}: {
  summary: ReportSummary;
  /** Courier id to name, including switched-off partners. */
  names: Map<string, string>;
  filters: ReportFilters;
}) {
  const rows = summary.couriers;

  if (!rows.length) {
    return (
      <div className="bg-white border border-neutral-200 rounded-2xl p-8 text-center text-sm text-neutral-500 shadow-sm">
        No parcels match these filters.
      </div>
    );
  }

  const th =
    "px-3 py-2.5 font-semibold text-neutral-500 uppercase tracking-wider whitespace-nowrap text-right";
  const cell = "px-3 py-2 text-right whitespace-nowrap";

  /** Totals summed here, so the footer can never disagree with the rows. */
  const sum = (k: keyof CourierStat) =>
    rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);

  const cellLink = (r: CourierStat, stages: string | null) =>
    reportHref(filters, {
      courier: r.id,
      stage: stages,
      only_late: null,
      age_min: null,
      age_max: null,
    });

  return (
    <div className="bg-white border border-neutral-200 rounded-2xl shadow-sm overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b border-neutral-100">
        <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">
          By courier
        </h3>

        {/* Picking a courier narrows this whole screen to that courier, tiles
            and chart included — so this table collapses to one row, which is
            correct and briefly confusing. Said out loud, with the way back,
            rather than left for someone to work out. */}
        {filters.courier && (
          <Link
            href={reportHref(filters, { courier: null })}
            className="text-[11px] text-neutral-500 hover:text-neutral-900 underline underline-offset-2 transition-colors"
          >
            Narrowed to one courier — show all
          </Link>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-neutral-50 border-b border-neutral-100">
            <tr>
              <th className={`${th} text-left`}>Courier</th>
              <th className={th}>Parcels</th>
              {COLUMNS.map((c) => (
                <th key={c.key} className={th} title={c.title}>
                  {c.label}
                </th>
              ))}
              <th className={th} title={`Not delivered, and more than ${filters.late} days since ${filters.lateFrom === "ordered" ? "the order" : filters.lateFrom === "shipped" ? "shipping" : "assignment"}`}>
                Late
              </th>
              <th className={th} title="Average days from order to doorstep, delivered parcels only">
                Avg days
              </th>
            </tr>
          </thead>

          <tbody>
            {rows.map((r) => {
              const name =
                r.id === NONE
                  ? "Nobody — not routed yet"
                  : (names.get(r.id) ?? "Unknown courier");
              const selected = filters.courier === r.id;

              return (
                <tr
                  key={r.id}
                  className={`border-b border-neutral-100 last:border-0 hover:bg-neutral-50/70 ${
                    selected ? "bg-neutral-50" : ""
                  }`}
                >
                  <td className="px-3 py-2 text-left whitespace-nowrap">
                    <Link
                      href={reportHref(filters, {
                        courier: selected ? null : r.id,
                        stage: null,
                      })}
                      className={`font-semibold hover:underline underline-offset-2 ${
                        r.id === NONE ? "text-orange-700" : "text-neutral-900"
                      }`}
                    >
                      {name}
                    </Link>
                  </td>

                  <td className={`${cell} font-bold text-neutral-900`}>
                    <Link href={cellLink(r, null)} className="hover:underline underline-offset-2">
                      {r.parcels.toLocaleString("en-IN")}
                    </Link>
                  </td>

                  {COLUMNS.map((c) => {
                    const v = Number(r[c.key]) || 0;
                    return (
                      <td key={c.key} className={cell}>
                        {v ? (
                          <Link
                            href={cellLink(r, c.stages)}
                            className={`${c.tone} font-medium hover:underline underline-offset-2`}
                          >
                            {v.toLocaleString("en-IN")}
                          </Link>
                        ) : (
                          <span className="text-neutral-300">–</span>
                        )}
                      </td>
                    );
                  })}

                  <td className={cell}>
                    {r.late ? (
                      <Link
                        href={reportHref(filters, {
                          courier: r.id,
                          only_late: "1",
                          stage: null,
                        })}
                        className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700 font-bold hover:bg-rose-200 transition-colors"
                      >
                        {r.late.toLocaleString("en-IN")}
                      </Link>
                    ) : (
                      <span className="text-neutral-300">–</span>
                    )}
                  </td>

                  <td className={`${cell} text-neutral-600`}>
                    {r.avg_days === null ? (
                      <span className="text-neutral-300">–</span>
                    ) : (
                      r.avg_days
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>

          <tfoot className="bg-neutral-50 border-t border-neutral-200">
            <tr>
              <td className="px-3 py-2 text-left font-semibold text-neutral-600">
                All couriers
              </td>
              <td className={`${cell} font-bold text-neutral-900`}>
                {sum("parcels").toLocaleString("en-IN")}
              </td>
              {COLUMNS.map((c) => (
                <td key={c.key} className={`${cell} font-semibold text-neutral-600`}>
                  {sum(c.key).toLocaleString("en-IN")}
                </td>
              ))}
              <td className={`${cell} font-semibold text-rose-700`}>
                {sum("late").toLocaleString("en-IN")}
              </td>
              <td className={cell} />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

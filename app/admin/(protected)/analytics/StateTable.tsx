import Link from "@/components/admin/AdminLink";
import { reportHref, type ReportFilters } from "@/lib/report-filters";
import type { ReportSummary } from "@/lib/db/parcel-report";

/**
 * Where the parcels go, and whether they get there.
 *
 * Ten rows, because this is a hint about geography rather than a census — a
 * table of every state in India would push the parcel list off the screen to
 * say something about two parcels in Tripura.
 *
 * The column worth reading is not Parcels, it is Returned against Avg days:
 * a state that takes twice as long and sends twice as many back is a
 * serviceability problem, and it is invisible in any national total.
 */
export default function StateTable({
  summary,
  filters,
}: {
  summary: ReportSummary;
  filters: ReportFilters;
}) {
  const rows = summary.states;

  const th =
    "px-3 py-2 font-semibold text-neutral-500 uppercase tracking-wider whitespace-nowrap text-right";
  const cell = "px-3 py-2 text-right whitespace-nowrap";

  return (
    <div className="bg-white border border-neutral-200 rounded-2xl shadow-sm overflow-hidden">
      <div className="px-4 py-2.5 border-b border-neutral-100">
        <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">
          Top states
        </h3>
      </div>

      {!rows.length ? (
        <p className="px-4 py-6 text-xs text-neutral-400">
          No addresses in this view carry a state.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-neutral-50 border-b border-neutral-100">
              <tr>
                <th className={`${th} text-left`}>State</th>
                <th className={th}>Parcels</th>
                <th className={th}>Delivered</th>
                <th className={th}>Returned</th>
                <th className={th}>Late</th>
                <th className={th} title="Average days from order to doorstep">
                  Avg days
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const selected =
                  filters.state?.trim().toLowerCase() === s.name.trim().toLowerCase();
                return (
                  <tr
                    key={s.name}
                    className={`border-b border-neutral-100 last:border-0 hover:bg-neutral-50/70 ${
                      selected ? "bg-neutral-50" : ""
                    }`}
                  >
                    <td className="px-3 py-2 text-left whitespace-nowrap">
                      <Link
                        href={reportHref(filters, {
                          state: selected ? null : s.name,
                          stage: null,
                        })}
                        className="font-semibold text-neutral-900 hover:underline underline-offset-2"
                      >
                        {s.name}
                      </Link>
                    </td>
                    <td className={`${cell} font-bold text-neutral-900`}>
                      {s.parcels.toLocaleString("en-IN")}
                    </td>
                    <td className={`${cell} text-green-600`}>
                      {s.delivered || <span className="text-neutral-300">–</span>}
                    </td>
                    <td className={`${cell} text-rose-600`}>
                      {s.returned || <span className="text-neutral-300">–</span>}
                    </td>
                    <td className={`${cell} text-amber-700`}>
                      {s.late || <span className="text-neutral-300">–</span>}
                    </td>
                    <td className={`${cell} text-neutral-600`}>
                      {s.avg_days === null ? (
                        <span className="text-neutral-300">–</span>
                      ) : (
                        s.avg_days
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

import Link from "@/components/admin/AdminLink";
import { reportHref, type ReportFilters } from "@/lib/report-filters";
import type { ReportSummary } from "@/lib/db/parcel-report";

/**
 * Who is carrying what.
 *
 * The other half of "by courier": a parcel is handed to an agent, and the
 * agent takes it to the courier. When parcels stall between those two people
 * this is the table that says whose pile they are stalling in.
 *
 * An agent switched off since still owns whatever they were given — their row
 * has to stay legible or those parcels look orphaned, which is why the caller
 * passes every staff member rather than only the assignable ones.
 */
export default function AgentTable({
  summary,
  names,
  filters,
}: {
  summary: ReportSummary;
  names: Map<string, string>;
  filters: ReportFilters;
}) {
  const rows = summary.agents;

  const th =
    "px-3 py-2 font-semibold text-neutral-500 uppercase tracking-wider whitespace-nowrap text-right";
  const cell = "px-3 py-2 text-right whitespace-nowrap";

  return (
    <div className="bg-white border border-neutral-200 rounded-2xl shadow-sm overflow-hidden">
      <div className="px-4 py-2.5 border-b border-neutral-100">
        <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">
          By delivery agent
        </h3>
      </div>

      {!rows.length ? (
        <p className="px-4 py-6 text-xs text-neutral-400">
          No parcel in this view has been handed to an agent.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-neutral-50 border-b border-neutral-100">
              <tr>
                <th className={`${th} text-left`}>Agent</th>
                <th className={th}>Parcels</th>
                <th className={th} title="Not shipped yet — still theirs to move">
                  Holding
                </th>
                <th className={th}>Transit</th>
                <th className={th}>Delivered</th>
                <th className={th}>Late</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => {
                const selected = filters.agent === a.id;
                return (
                  <tr
                    key={a.id}
                    className={`border-b border-neutral-100 last:border-0 hover:bg-neutral-50/70 ${
                      selected ? "bg-neutral-50" : ""
                    }`}
                  >
                    <td className="px-3 py-2 text-left whitespace-nowrap">
                      <Link
                        href={reportHref(filters, {
                          agent: selected ? null : a.id,
                          stage: null,
                        })}
                        className="font-semibold text-neutral-900 hover:underline underline-offset-2"
                      >
                        {names.get(a.id) ?? "Removed agent"}
                      </Link>
                    </td>
                    <td className={`${cell} font-bold text-neutral-900`}>
                      {a.parcels.toLocaleString("en-IN")}
                    </td>
                    <td className={`${cell} text-amber-600 font-medium`}>
                      {a.holding || <span className="text-neutral-300">–</span>}
                    </td>
                    <td className={`${cell} text-purple-600`}>
                      {a.in_transit || <span className="text-neutral-300">–</span>}
                    </td>
                    <td className={`${cell} text-green-600`}>
                      {a.delivered || <span className="text-neutral-300">–</span>}
                    </td>
                    <td className={cell}>
                      {a.late ? (
                        <Link
                          href={reportHref(filters, {
                            agent: a.id,
                            only_late: "1",
                            stage: null,
                          })}
                          className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700 font-bold hover:bg-rose-200 transition-colors"
                        >
                          {a.late}
                        </Link>
                      ) : (
                        <span className="text-neutral-300">–</span>
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

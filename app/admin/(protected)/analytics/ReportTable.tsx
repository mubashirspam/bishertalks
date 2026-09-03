import Link from "@/components/admin/AdminLink";
import { formatISTDate } from "@/lib/format-date";
import { DELIVERY_SHORT, DELIVERY_BADGE } from "@/lib/delivery-stage";
import { isHandoverState, HANDOVER_LABELS } from "@/lib/delivery/handover";
import { type ReportFilters } from "@/lib/report-filters";
import type { ReportRow } from "@/lib/db/parcel-report";
import ReportDownload from "./ReportDownload";

/**
 * The parcels themselves.
 *
 * Every count on this page ends here — the tiles, the courier cells, the
 * ageing bars and the chart all link into this table with the filters that
 * produced them, so the list is always exactly the number that was clicked.
 * That is the property the whole screen rests on: a drill-down that disagrees
 * with its own count teaches people to distrust both.
 *
 * Five date columns, which is unusual and deliberate. The question this screen
 * gets asked is where the time went, and the only way to answer it is to put
 * the ordering, the routing, the shipping and the delivery next to each other
 * on one line. The gap between two of them is the answer.
 */

/** A date cell, or a dash that does not pretend to be one. */
function DateCell({ iso }: { iso: string | null }) {
  if (!iso) return <span className="text-neutral-300">–</span>;
  return <span className="text-neutral-700">{formatISTDate(iso)}</span>;
}

export default function ReportTable({
  rows,
  count,
  courierNames,
  agentNames,
  filters,
  canExport,
}: {
  rows: ReportRow[];
  count: number;
  courierNames: Map<string, string>;
  agentNames: Map<string, string>;
  filters: ReportFilters;
  canExport: boolean;
}) {
  const th =
    "px-3 py-2.5 font-semibold text-neutral-500 uppercase tracking-wider whitespace-nowrap text-left";
  const cell = "px-3 py-2 whitespace-nowrap";

  return (
    <div className="bg-white border border-neutral-200 rounded-2xl shadow-sm overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-neutral-100">
        <div>
          <p className="text-sm font-bold text-neutral-900">
            {count.toLocaleString("en-IN")} parcel{count === 1 ? "" : "s"}
          </p>
          <p className="text-[11px] text-neutral-500 mt-0.5">
            {filters.onlyLate
              ? `Not delivered, more than ${filters.late} days since ${
                  filters.lateFrom === "ordered"
                    ? "the order"
                    : filters.lateFrom === "shipped"
                      ? "shipping"
                      : "the courier was assigned"
                }`
              : "Everything matching the filters above"}
          </p>
        </div>

        {/* Hidden rather than disabled for someone without the permission: a
            control that is only ever going to say no is noise. Same rule the
            delivery breakdown's download follows. */}
        {canExport && <ReportDownload />}
      </div>

      {!rows.length ? (
        <div className="px-4 py-12 text-center text-sm text-neutral-500">
          No parcels match these filters.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-neutral-50 border-b border-neutral-100">
              <tr>
                <th className={th}>Order</th>
                <th className={th}>Customer</th>
                <th className={th}>Ordered</th>
                <th className={th} title="When a courier was chosen for it">
                  Assigned
                </th>
                <th className={th}>Shipped</th>
                <th className={th}>Delivered</th>
                <th className={th}>Courier</th>
                <th className={th}>Where</th>
                <th className={`${th} text-right`} title="Days from the order to delivery, or to now">
                  Days
                </th>
                <th className={`${th} text-right`} title="Days since it shipped">
                  Transit
                </th>
              </tr>
            </thead>

            <tbody>
              {rows.map((r) => {
                const courier = r.courier_id
                  ? (courierNames.get(r.courier_id) ?? "Unknown")
                  : null;
                const agent = r.assigned_agent_id
                  ? agentNames.get(r.assigned_agent_id)
                  : null;

                return (
                  <tr
                    key={r.order_number}
                    className={`border-b border-neutral-100 last:border-0 hover:bg-neutral-50/70 ${
                      r.is_late ? "bg-rose-50/40" : ""
                    }`}
                  >
                    <td className={cell}>
                      <Link
                        href={`/admin/orders/${r.order_number}`}
                        className="font-mono font-medium text-neutral-900 hover:text-primary-600 hover:underline underline-offset-2"
                      >
                        {r.order_number}
                      </Link>
                      {r.is_late && (
                        <span
                          title={`Not delivered, ${r.days_pending} days after the order`}
                          className="ml-1.5 inline-flex items-center px-1.5 rounded-full bg-rose-100 text-rose-700 text-[10px] font-bold"
                        >
                          late
                        </span>
                      )}
                    </td>

                    <td className={cell}>
                      <span className="font-medium text-neutral-800">
                        {r.buyer_name ?? <span className="text-neutral-400">—</span>}
                      </span>
                      <span className="block text-[11px] text-neutral-400">
                        {[r.city, r.pincode].filter(Boolean).join(" · ") || "—"}
                      </span>
                    </td>

                    <td className={cell}>
                      <DateCell iso={r.ordered_at} />
                    </td>
                    <td className={cell}>
                      <DateCell iso={r.courier_assigned_at} />
                    </td>
                    <td className={cell}>
                      <DateCell iso={r.shipped_at} />
                    </td>
                    <td className={cell}>
                      <DateCell iso={r.delivered_at} />
                    </td>

                    <td className={cell}>
                      {courier ? (
                        <>
                          <span className="text-neutral-800">{courier}</span>
                          {agent && (
                            <span className="block text-[11px] text-neutral-400">
                              via {agent}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-orange-600 font-medium">
                          Not routed
                        </span>
                      )}
                    </td>

                    <td className={cell}>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-semibold ${
                          DELIVERY_BADGE[r.delivery_stage]
                        }`}
                      >
                        {DELIVERY_SHORT[r.delivery_stage]}
                      </span>
                      {isHandoverState(r.handover_state) && (
                        <span className="block text-[11px] text-neutral-400 mt-0.5">
                          {HANDOVER_LABELS[r.handover_state]}
                        </span>
                      )}
                    </td>

                    <td className={`${cell} text-right`}>
                      <span
                        className={`font-bold ${
                          r.delivered_at
                            ? "text-neutral-500"
                            : r.days_pending > 10
                              ? "text-rose-600"
                              : r.days_pending > 5
                                ? "text-amber-600"
                                : "text-neutral-700"
                        }`}
                      >
                        {r.days_pending}
                      </span>
                    </td>

                    <td className={`${cell} text-right text-neutral-600`}>
                      {r.days_in_transit === null ? (
                        <span className="text-neutral-300">–</span>
                      ) : (
                        r.days_in_transit
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

import Link from "@/components/admin/AdminLink";
import {
  STATUS_COLUMNS,
  STATUS_COLUMN_LABELS,
  NO_COURIER,
  courierStatusCounts,
  extraStatuses,
  type StatusCountable,
} from "@/lib/db/courier-status";

/**
 * Where every paid parcel is, by courier and status.
 *
 * The dashboard could already say how much money came in and what happened
 * today. What it could not say is the thing that goes wrong quietly: a whole
 * column of one courier's parcels sitting in Confirmed for a fortnight while
 * the totals look healthy, because the money arrived long ago and the parcels
 * are somebody else's problem now. Reading down a column shows that in a
 * glance; no per-courier total ever could.
 *
 * Every cell with anything in it is a link — the count is the question and the
 * list behind it is the answer, and having to go and rebuild the same filter by
 * hand on another screen is where people give up.
 */
export default function CourierStatusTable({
  rows,
  courierNames,
}: {
  /** Paid orders, status and courier only. */
  rows: StatusCountable[];
  /** Courier id to name. Ids with no row here are shown as their id. */
  courierNames: Map<string, string>;
}) {
  const counts = courierStatusCounts(rows);

  // Fixed columns first so an empty one still appears — "nothing is Returned"
  // is worth being able to see — then anything the data holds that they do not
  // name, which is how a status added by a later migration shows up instead of
  // being silently dropped from the totals.
  const columns = [...STATUS_COLUMNS, ...extraStatuses(rows)];

  // Couriers in the order they were listed (their own sort_order), with the
  // unrouted pile last: it is not a courier, and it is the one row that means
  // "nobody has decided yet".
  const courierKeys = [
    ...[...courierNames.keys()].filter((id) => counts.has(id)),
    ...(counts.has(NO_COURIER) ? [NO_COURIER] : []),
  ];

  const cellCount = (key: string, status: string) => counts.get(key)?.get(status) ?? 0;
  const rowTotal = (key: string) =>
    [...(counts.get(key)?.values() ?? [])].reduce((a, b) => a + b, 0);
  const columnTotal = (status: string) =>
    courierKeys.reduce((a, key) => a + cellCount(key, status), 0);

  const href = (key: string, status: string) =>
    `/admin/delivery-breakdown?courier=${encodeURIComponent(key)}&status=${encodeURIComponent(status)}`;

  const th =
    "px-3 py-2.5 font-semibold text-neutral-500 uppercase tracking-wider whitespace-nowrap text-right";

  return (
    <div className="bg-white border border-neutral-200 rounded-2xl shadow-sm overflow-hidden mb-6">
      <div className="px-5 py-4 border-b border-neutral-100">
        <h2 className="font-semibold text-sm">Parcels by courier</h2>
        <p className="text-xs text-neutral-500 mt-0.5">
          Every paid order. Click a number to see those parcels and download them.
        </p>
      </div>

      {/* Wide on purpose — seven statuses is the shape of the pipeline. It
          scrolls inside this box rather than pushing the page sideways. */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-neutral-50 border-b border-neutral-100">
            <tr>
              <th className={`${th} text-left`}>Courier</th>
              {columns.map((s) => (
                <th key={s} className={th}>
                  {STATUS_COLUMN_LABELS[s] ?? s}
                </th>
              ))}
              <th className={`${th} border-l border-neutral-200`}>Total</th>
            </tr>
          </thead>

          <tbody>
            {courierKeys.map((key) => (
              <tr key={key} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50/70">
                <td className="px-3 py-2 font-medium text-neutral-900 whitespace-nowrap">
                  {key === NO_COURIER ? (
                    <span className="text-neutral-500">No courier yet</span>
                  ) : (
                    courierNames.get(key) ?? key
                  )}
                </td>

                {columns.map((s) => {
                  const n = cellCount(key, s);
                  return (
                    <td key={s} className="px-3 py-2 text-right tabular-nums">
                      {n === 0 ? (
                        // A dash, not a nothing: an empty cell in a wide table
                        // reads as a rendering fault rather than a zero.
                        <span className="text-neutral-300">—</span>
                      ) : (
                        <Link
                          href={href(key, s)}
                          className="text-neutral-900 hover:text-primary-600 hover:underline underline-offset-2 font-medium"
                        >
                          {n.toLocaleString("en-IN")}
                        </Link>
                      )}
                    </td>
                  );
                })}

                <td className="px-3 py-2 text-right tabular-nums font-semibold border-l border-neutral-200">
                  {rowTotal(key).toLocaleString("en-IN")}
                </td>
              </tr>
            ))}
          </tbody>

          <tfoot className="bg-neutral-50 border-t border-neutral-200">
            <tr>
              <td className="px-3 py-2 font-semibold text-neutral-500 uppercase tracking-wider">
                Total
              </td>
              {columns.map((s) => (
                <td key={s} className="px-3 py-2 text-right tabular-nums font-semibold">
                  {columnTotal(s).toLocaleString("en-IN")}
                </td>
              ))}
              <td className="px-3 py-2 text-right tabular-nums font-black border-l border-neutral-200">
                {rows.length.toLocaleString("en-IN")}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

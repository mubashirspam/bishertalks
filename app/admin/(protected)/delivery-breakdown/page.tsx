import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import Link from "@/components/admin/AdminLink";
import { requirePageAccess } from "@/lib/admin-auth";
import { can } from "@/lib/permissions";
import { listCouriers } from "@/lib/db/couriers";
import {
  fetchStatusContacts,
  STATUS_COLUMN_LABELS,
  NO_COURIER,
} from "@/lib/db/courier-status";
import { SkeletonTable } from "@/components/admin/Skeleton";
import ContactDownload from "@/components/admin/ContactDownload";

export const dynamic = "force-dynamic";

/**
 * One cell of the dashboard's courier x status table, opened up.
 *
 * Deliberately the same five columns the download has — name, mobile,
 * reference, order number, pincode — so what is on screen and what lands in
 * Excel are visibly the same thing. A list that shows more than it exports
 * invites someone to copy the difference out by hand.
 *
 * Not the delivery portal, on purpose. The portal is a working screen with a
 * narrower scope: it excludes cancelled orders and anything nobody has routed
 * or assigned, and it has no chip for "out for delivery". Sending a dashboard
 * count there would land people on a list that disagrees with the number they
 * clicked, which is the one thing a drill-down must never do.
 */
export default async function DeliveryBreakdownPage({
  searchParams,
}: {
  searchParams: Promise<{ courier?: string; status?: string }>;
}) {
  const staff = await requirePageAccess("orders.view");
  const params = await searchParams;

  const couriers = await listCouriers();
  const courierName =
    params.courier === NO_COURIER
      ? "No courier yet"
      : couriers.find((c) => c.id === params.courier)?.name ?? "All couriers";
  const statusLabel = params.status
    ? STATUS_COLUMN_LABELS[params.status] ?? params.status
    : "All statuses";

  return (
    <div>
      <Link
        href="/admin"
        className="inline-flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-900 transition-colors mb-3"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Dashboard
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-black">{courierName}</h1>
          <p className="text-sm text-neutral-500 mt-0.5">{statusLabel}</p>
        </div>

        {/* Top right, same place and same button as the portal's. Hidden rather
            than disabled for someone without the export permission: a control
            that is only ever going to say no is noise. */}
        {can(staff, "orders.export") && <ContactDownload mode="breakdown" />}
      </div>

      <Suspense fallback={<SkeletonTable rows={12} columns={5} />}>
        <BreakdownRows courier={params.courier ?? null} status={params.status ?? null} />
      </Suspense>
    </div>
  );
}

async function BreakdownRows({
  courier,
  status,
}: {
  courier: string | null;
  status: string | null;
}) {
  const { rows, truncated } = await fetchStatusContacts(courier, status);

  if (!rows.length) {
    return (
      <div className="bg-white border border-neutral-200 rounded-2xl p-12 text-center text-neutral-500 shadow-sm">
        No parcels here.
      </div>
    );
  }

  const cell = "px-3 py-2 whitespace-nowrap";
  const th =
    "px-3 py-2.5 font-semibold text-neutral-500 uppercase tracking-wider whitespace-nowrap text-left";

  return (
    <div className="bg-white border border-neutral-200 rounded-2xl shadow-sm overflow-hidden">
      <div className="px-4 py-2.5 border-b border-neutral-100 bg-neutral-50/60 text-xs text-neutral-600">
        {rows.length.toLocaleString("en-IN")} parcel{rows.length === 1 ? "" : "s"}
        {truncated && (
          <span className="text-amber-700">
            {" "}
            — too many to read in one go, so this list is partial.
          </span>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-neutral-50 border-b border-neutral-100">
            <tr>
              <th className={th}>Name</th>
              <th className={th}>Mobile</th>
              <th className={th}>Reference ID</th>
              <th className={th}>Order number</th>
              <th className={th}>Pincode</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.order_number}
                className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50/70"
              >
                <td className={`${cell} font-medium text-neutral-900`}>
                  {r.buyer_name ?? <span className="text-neutral-400">—</span>}
                </td>
                <td className={`${cell} text-neutral-700`}>
                  {r.buyer_phone ?? <span className="text-neutral-400">—</span>}
                </td>
                <td className={`${cell} font-mono text-neutral-600`}>
                  {r.courier_reference ?? <span className="text-neutral-400">—</span>}
                </td>
                <td className={cell}>
                  <Link
                    href={`/admin/orders/${r.order_number}`}
                    className="font-mono text-neutral-900 hover:text-primary-600 hover:underline underline-offset-2"
                  >
                    {r.order_number}
                  </Link>
                </td>
                <td className={`${cell} text-neutral-700`}>
                  {r.pincode ?? <span className="text-neutral-400">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

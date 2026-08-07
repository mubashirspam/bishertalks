import Link from "next/link";
import { Printer } from "lucide-react";
import {
  buildDeliveryQuery,
  deliveryStageCounts,
  parseDeliveryFilters,
  type DeliveryRow,
} from "@/lib/db/delivery-query";
import DeliveryFilters from "./DeliveryFilters";
import DeliveryTable from "./DeliveryTable";

export const dynamic = "force-dynamic";

/** Bigger than the funnel list: this page is worked in batches, not read. */
const PER_PAGE = 50;

export default async function AdminDeliveryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const filters = parseDeliveryFilters(params);
  const pageNum = Math.max(0, parseInt(params.page ?? "1") - 1);

  const [{ data, count }, counts] = await Promise.all([
    buildDeliveryQuery(filters).range(
      pageNum * PER_PAGE,
      (pageNum + 1) * PER_PAGE - 1
    ),
    deliveryStageCounts(filters),
  ]);

  const rows = (data ?? []) as unknown as DeliveryRow[];
  const total = count ?? 0;
  const totalPages = Math.ceil(total / PER_PAGE);

  const pageLink = (p: number) => {
    const next = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v) as [string, string][]
    );
    next.set("page", String(p));
    return `/admin/delivery?${next}`;
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-black flex items-center gap-2">
          <Printer className="w-5 h-5 text-primary-500" /> Delivery
        </h1>
        <p className="text-neutral-500 text-sm mt-1">
          Paid orders with a delivery address. Print labels, ship, mark
          delivered. Everything before payment lives in{" "}
          <Link href="/admin/orders" className="text-primary-600 hover:underline">
            Orders
          </Link>
          .
        </p>
      </div>

      <DeliveryFilters counts={counts} />

      <DeliveryTable rows={rows} matching={total} />

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-neutral-500 text-xs">
            Page {pageNum + 1} of {totalPages} · {total} orders
          </p>
          <div className="flex gap-2">
            {pageNum > 0 && (
              <Link
                href={pageLink(pageNum)}
                className="px-3 py-1.5 rounded-lg bg-white border border-neutral-200 text-sm hover:border-neutral-300 transition-all"
              >
                ← Prev
              </Link>
            )}
            {pageNum + 1 < totalPages && (
              <Link
                href={pageLink(pageNum + 2)}
                className="px-3 py-1.5 rounded-lg bg-white border border-neutral-200 text-sm hover:border-neutral-300 transition-all"
              >
                Next →
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

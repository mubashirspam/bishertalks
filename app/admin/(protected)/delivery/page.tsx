import { Suspense } from "react";
import Link from "next/link";
import { Printer } from "lucide-react";
import {
  deliveryStageCounts,
  parseDeliveryFilters,
  type DeliveryRow,
} from "@/lib/db/delivery-query";
import { fetchDeliveryPage } from "@/lib/db/orders-page";
import { SkeletonTable, SkeletonTabs } from "@/components/admin/Skeleton";
import {
  NavigationPending,
  StaleWhileRevalidating,
} from "@/components/admin/Revalidating";
import DeliveryFilters from "./DeliveryFilters";
import DeliveryTable from "./DeliveryTable";
import { requirePageAccess } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

/** Bigger than the funnel list: this page is worked in batches, not read. */
const PER_PAGE = 50;

interface Args {
  stage?: string;
  q?: string;
  from?: string;
  to?: string;
  sort?: string;
  pageNum: number;
  params: Record<string, string | undefined>;
}

export default async function AdminDeliveryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requirePageAccess("delivery.view");

  const params = await searchParams;
  const args: Args = {
    stage: params.stage,
    q: params.q,
    from: params.from,
    to: params.to,
    sort: params.sort,
    pageNum: Math.max(0, parseInt(params.page ?? "1") - 1),
    params,
  };

  return (
    <NavigationPending>
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

      {/* The tab counts are seven separate count queries, and they used to be
          awaited alongside the rows — so the parcels you came here to work on
          waited for numbers you may not even look at. Own boundary now. */}
      <Suspense fallback={<SkeletonTabs />}>
        <QueueTabs {...args} />
      </Suspense>

      <StaleWhileRevalidating>
        <Suspense fallback={<SkeletonTable rows={10} columns={6} />}>
          <QueueTable {...args} />
        </Suspense>
      </StaleWhileRevalidating>
    </NavigationPending>
  );
}

/** Queue tabs, filters, and the per-stage counts behind them. */
async function QueueTabs(args: Args) {
  const counts = await deliveryStageCounts(parseDeliveryFilters(args.params));
  return <DeliveryFilters counts={counts} />;
}

/** The worklist itself, plus paging. */
async function QueueTable(args: Args) {
  const { rows, count } = await fetchDeliveryPage(
    args.stage,
    args.q,
    args.from,
    args.to,
    args.sort,
    args.pageNum,
    PER_PAGE
  );

  const orders = rows as unknown as DeliveryRow[];
  const totalPages = Math.ceil(count / PER_PAGE);
  const pageNum = args.pageNum;

  const pageLink = (p: number) => {
    const next = new URLSearchParams(
      Object.entries(args.params).filter(([, v]) => v) as [string, string][]
    );
    next.set("page", String(p));
    return `/admin/delivery?${next}`;
  };

  return (
    <>
      <DeliveryTable rows={orders} matching={count} />

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-neutral-500 text-xs">
            Page {pageNum + 1} of {totalPages} · {count} orders
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
    </>
  );
}

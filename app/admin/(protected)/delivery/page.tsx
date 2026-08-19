import { Suspense } from "react";
import Link from "@/components/admin/AdminLink";
import { Printer } from "lucide-react";
import {
  deliveryStageCounts,
  parseDeliveryFilters,
  type DeliveryRow,
} from "@/lib/db/delivery-query";
import { deliveryStats } from "@/lib/db/delivery-stats";
import { fetchDeliveryPage, deliveryFilterKey } from "@/lib/db/orders-page";
import { listDeliveryAgents, listStaff } from "@/lib/db/staff";
import { listCouriers } from "@/lib/db/couriers";
import { canSendAutomatically } from "@/lib/couriers";
import { SkeletonTable, SkeletonTabs } from "@/components/admin/Skeleton";
import {
  NavigationPending,
  StaleWhileRevalidating,
} from "@/components/admin/Revalidating";
import DeliveryFilters from "./DeliveryFilters";
import DeliveryStatsStrip from "./DeliveryStats";
import DeliveryTable from "./DeliveryTable";
import ExceptionImport from "./ExceptionImport";
import { requirePageAccess } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

/** Bigger than the funnel list: this page is worked in batches, not read. */
const PER_PAGE = 50;

/**
 * What the three boundaries below need.
 *
 * Deliberately not one field per filter. That is what this used to be, and the
 * list fell behind `DeliveryFilters` twice — `courier` and `handover` were
 * never added, so choosing either moved the tab counts and left the rows alone.
 * Everything now travels as the raw params or as the key derived from them, and
 * a new filter needs no change here at all.
 */
interface Args {
  pageNum: number;
  /** Every filter as one canonical string — see deliveryFilterKey. */
  filterKey: string;
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
    pageNum: Math.max(0, parseInt(params.page ?? "1") - 1),
    filterKey: deliveryFilterKey(params),
    params,
  };

  return (
    <NavigationPending>
      <div className="mb-6">
        <h1 className="text-2xl font-black flex items-center gap-2">
          <Printer className="w-5 h-5 text-primary-500" /> Delivery
        </h1>
        <p className="text-neutral-500 text-sm mt-1">
          Paid orders with a delivery address. Hand them to a delivery agent and
          print the labels; the agent ticks off packing and shipping in the{" "}
          <Link href="/admin/delivery-portal" className="text-primary-600 hover:underline">
            portal
          </Link>
          . Everything before payment lives in{" "}
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

      {/* Its own boundary for the same reason, and after the tabs: the numbers
          are the thing you read, the queue is the thing you use. */}
      <Suspense fallback={<div className="h-40 rounded-2xl bg-neutral-100 animate-pulse mb-5" />}>
        <Stats {...args} />
      </Suspense>

      <StaleWhileRevalidating>
        <Suspense fallback={<SkeletonTable rows={10} columns={8} />}>
          <QueueTable {...args} />
        </Suspense>
      </StaleWhileRevalidating>
    </NavigationPending>
  );
}

/** Queue tabs, filters, and the per-stage counts behind them. */
async function QueueTabs(args: Args) {
  const [counts, agents, couriers] = await Promise.all([
    deliveryStageCounts(parseDeliveryFilters(args.params)),
    listDeliveryAgents(),
    listCouriers(),
  ]);
  return (
    <DeliveryFilters
      counts={counts}
      agents={agents}
      couriers={couriers.map((c) => ({ id: c.id, name: c.name }))}
    />
  );
}

/** Pipeline, per-agent load, stalled work and throughput. */
async function Stats(args: Args) {
  const stats = await deliveryStats(parseDeliveryFilters(args.params));
  return <DeliveryStatsStrip stats={stats} />;
}

/** The worklist itself, plus paging. */
async function QueueTable(args: Args) {
  const [{ rows, count }, agents, staff, couriers] = await Promise.all([
    // Every filter travels in one string, so the rows can never disagree with
    // the tab counts and the stats strip above them — all three now read the
    // same set through parseDeliveryFilters.
    fetchDeliveryPage(args.filterKey, args.pageNum, PER_PAGE),
    listDeliveryAgents(),
    // Every staff member, not just assignable ones: a parcel assigned to
    // someone since switched off still has to show their name.
    listStaff(),
    // Same reasoning for couriers — the inactive ones still name history.
    listCouriers(),
  ]);

  const agentNames = Object.fromEntries(staff.map((s) => [s.id, s.name]));
  const courierNames = Object.fromEntries(couriers.map((c) => [c.id, c.name]));

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
      <div className="mb-4">
        <ExceptionImport />
      </div>

      <DeliveryTable
        rows={orders}
        matching={count}
        agents={agents}
        agentNames={agentNames}
        couriers={couriers
          .filter((c) => c.is_active)
          .map((c) => ({
            id: c.id,
            name: c.name,
            // Whether routing to this one also hands the parcel over. Only an
            // integrated courier does; everyone else gets a spreadsheet, which
            // is reversible and needs no confirmation.
            dispatches: canSendAutomatically(c),
          }))}
        courierNames={courierNames}
      />

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

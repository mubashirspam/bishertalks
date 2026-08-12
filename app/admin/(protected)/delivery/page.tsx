import { Suspense } from "react";
import Link from "next/link";
import { Printer } from "lucide-react";
import {
  deliveryStageCounts,
  parseDeliveryFilters,
  type DeliveryRow,
} from "@/lib/db/delivery-query";
import { deliveryStats } from "@/lib/db/delivery-stats";
import { fetchDeliveryPage } from "@/lib/db/orders-page";
import { listDeliveryAgents, listStaff } from "@/lib/db/staff";
import { SkeletonTable, SkeletonTabs } from "@/components/admin/Skeleton";
import {
  NavigationPending,
  StaleWhileRevalidating,
} from "@/components/admin/Revalidating";
import DeliveryFilters from "./DeliveryFilters";
import DeliveryStatsStrip from "./DeliveryStats";
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
  /** A staff id, or "none" — whose parcels we're looking at. */
  agent?: string;
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
    agent: params.agent,
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
  const [counts, agents] = await Promise.all([
    deliveryStageCounts(parseDeliveryFilters(args.params)),
    listDeliveryAgents(),
  ]);
  return <DeliveryFilters counts={counts} agents={agents} />;
}

/** Pipeline, per-agent load, stalled work and throughput. */
async function Stats(args: Args) {
  const stats = await deliveryStats(parseDeliveryFilters(args.params));
  return <DeliveryStatsStrip stats={stats} />;
}

/** The worklist itself, plus paging. */
async function QueueTable(args: Args) {
  const [{ rows, count }, agents, staff] = await Promise.all([
    fetchDeliveryPage(
      args.stage,
      args.q,
      args.from,
      args.to,
      args.sort,
      args.pageNum,
      PER_PAGE,
      args.agent
    ),
    listDeliveryAgents(),
    // Every staff member, not just assignable ones: a parcel assigned to
    // someone since switched off still has to show their name.
    listStaff(),
  ]);

  const agentNames = Object.fromEntries(staff.map((s) => [s.id, s.name]));
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
      <DeliveryTable
        rows={orders}
        matching={count}
        agents={agents}
        agentNames={agentNames}
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

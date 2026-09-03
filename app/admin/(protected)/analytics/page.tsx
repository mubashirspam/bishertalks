import { Suspense } from "react";
import Link from "@/components/admin/AdminLink";
import { BarChart3 } from "lucide-react";
import { requirePageAccess } from "@/lib/admin-auth";
import { can } from "@/lib/permissions";
import { parseReportFilters, type ReportFilters } from "@/lib/report-filters";
import { reportSummary, fetchReportPage } from "@/lib/db/parcel-report";
import { listCouriers } from "@/lib/db/couriers";
import { listDeliveryAgents, listStaff } from "@/lib/db/staff";
import { SkeletonStats, SkeletonTable } from "@/components/admin/Skeleton";
import {
  NavigationPending,
  StaleWhileRevalidating,
} from "@/components/admin/Revalidating";
import ReportFilterBar from "./ReportFilters";
import SummaryTiles from "./SummaryTiles";
import AgeingBuckets from "./AgeingBuckets";
import CourierTable from "./CourierTable";
import TimeChart from "./TimeChart";
import AgentTable from "./AgentTable";
import StateTable from "./StateTable";
import ReportTable from "./ReportTable";

export const dynamic = "force-dynamic";

/** The table is read, not worked — a screenful at a time is right. */
const PER_PAGE = 50;

/**
 * Everything that happened to the parcels, and everything that has not.
 *
 * The delivery screen answers "what do I do next": one stage at a time, always
 * by order date, sorted for picking work off the top. This screen answers the
 * other question — how many parcels each courier is holding, which ones have
 * been sitting too long, what went out in August, what has shipped this year —
 * and hands any of those answers over as a spreadsheet.
 *
 * Every number here is a link into the table at the bottom, because a count
 * without the list behind it is a number you have to go and rebuild by hand
 * somewhere else, which is where people give up and start keeping their own
 * spreadsheet.
 *
 * Four Suspense boundaries, in the order the screen is read: the tiles are the
 * headline, the breakdowns are the diagnosis, and the table is the evidence.
 * The table's own query is the expensive one and it must not hold up the
 * numbers above it.
 */
export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const staff = await requirePageAccess("delivery.view");

  const params = await searchParams;
  const filters = parseReportFilters(params);
  const pageNum = Math.max(0, parseInt(params.page ?? "1") - 1);

  return (
    <NavigationPending>
      <div className="mb-6">
        <h1 className="text-2xl font-black flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-primary-500" /> Reports
        </h1>
        <p className="text-neutral-500 text-sm mt-1">
          Where every parcel is, how long it has been there, and what each
          courier is carrying. Narrow it with the filters, then download exactly
          what you are looking at.
        </p>
      </div>

      {/* Not inside a boundary: the bar has to be usable while the numbers
          behind it are still being counted, and it only needs the courier and
          agent lists, both of which are cached per request. */}
      <Suspense fallback={<div className="h-48 rounded-2xl bg-neutral-100 animate-pulse mb-5" />}>
        <Filters filters={filters} />
      </Suspense>

      {/* Changing a filter keeps the previous figures on screen rather than
          blanking them, so the page does not flash empty on every click. */}
      <StaleWhileRevalidating>
        <Suspense fallback={<SkeletonStats count={6} />}>
          <Headline filters={filters} />
        </Suspense>

        <Suspense
          fallback={<div className="h-64 rounded-2xl bg-neutral-100 animate-pulse mb-5" />}
        >
          <Breakdowns filters={filters} />
        </Suspense>

        <Suspense fallback={<SkeletonTable rows={10} columns={8} />}>
          <Rows
            filters={filters}
            params={params}
            pageNum={pageNum}
            canExport={can(staff, "orders.export")}
          />
        </Suspense>
      </StaleWhileRevalidating>
    </NavigationPending>
  );
}

/** The controls. Needs the two pickers' contents and nothing else. */
async function Filters({ filters }: { filters: ReportFilters }) {
  const [couriers, agents] = await Promise.all([listCouriers(), listDeliveryAgents()]);

  return (
    <ReportFilterBar
      filters={filters}
      couriers={couriers.map((c) => ({ id: c.id, name: c.name, active: c.is_active }))}
      agents={agents.map((a) => ({ id: a.id, name: a.name }))}
    />
  );
}

/** The seven tiles. */
async function Headline({ filters }: { filters: ReportFilters }) {
  const summary = await reportSummary(filters);
  return <SummaryTiles summary={summary} filters={filters} />;
}

/**
 * Ageing, couriers, throughput, agents, states.
 *
 * One `reportSummary` call feeds all five — it is memoised per request, so
 * this costs the same round trip the tiles above already paid for.
 */
async function Breakdowns({ filters }: { filters: ReportFilters }) {
  const [summary, couriers, staff] = await Promise.all([
    reportSummary(filters),
    // Every courier, including the switched-off ones: a parcel that went out
    // last month under a partner we have since stopped using still has to be
    // named, or its whole row reads as an unexplained id.
    listCouriers(),
    // Same for staff — an agent removed since still owns what they carried.
    listStaff(),
  ]);

  const courierNames = new Map(couriers.map((c) => [c.id, c.name]));
  const agentNames = new Map(staff.map((s) => [s.id, s.name]));

  return (
    <div className="space-y-5 mb-5">
      <AgeingBuckets summary={summary} filters={filters} />
      <CourierTable summary={summary} names={courierNames} filters={filters} />
      <TimeChart summary={summary} />
      <div className="grid lg:grid-cols-2 gap-5">
        <AgentTable summary={summary} names={agentNames} filters={filters} />
        <StateTable summary={summary} filters={filters} />
      </div>
    </div>
  );
}

/** The parcels themselves, plus paging and the download buttons. */
async function Rows({
  filters,
  params,
  pageNum,
  canExport,
}: {
  filters: ReportFilters;
  params: Record<string, string | undefined>;
  pageNum: number;
  canExport: boolean;
}) {
  const [{ rows, count }, couriers, staff] = await Promise.all([
    fetchReportPage(filters, pageNum, PER_PAGE),
    listCouriers(),
    listStaff(),
  ]);

  const courierNames = new Map(couriers.map((c) => [c.id, c.name]));
  const agentNames = new Map(staff.map((s) => [s.id, s.name]));

  const totalPages = Math.ceil(count / PER_PAGE);

  const pageLink = (p: number) => {
    const next = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v) as [string, string][]
    );
    next.set("page", String(p));
    return `/admin/analytics?${next}`;
  };

  return (
    <>
      <ReportTable
        rows={rows}
        count={count}
        courierNames={courierNames}
        agentNames={agentNames}
        filters={filters}
        canExport={canExport}
      />

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-neutral-500 text-xs">
            Page {pageNum + 1} of {totalPages} ·{" "}
            {count.toLocaleString("en-IN")} parcels
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

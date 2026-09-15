import { Suspense } from "react";
import { PhoneCall } from "lucide-react";
import Link from "@/components/admin/AdminLink";
import { requirePageAccessAny, type CurrentStaff } from "@/lib/admin-auth";
import { can } from "@/lib/permissions";
import { SkeletonHeader, SkeletonTabs, SkeletonTable } from "@/components/admin/Skeleton";
import { NavigationPending, StaleWhileRevalidating } from "@/components/admin/Revalidating";
import { listStaff } from "@/lib/db/staff";
import { callScope, listCalls, callCounts } from "@/lib/db/calls";
import { parseCallFilters, callsHref, type CallFilters } from "@/lib/calls";
import CallFilterBar from "./CallFilters";
import CallList from "./CallList";

export const dynamic = "force-dynamic";

const PER_PAGE = 30;

/**
 * The customer care portal: the calls somebody has been given from the
 * reports screen, each with the customer's number, where the parcel is and
 * what the courier last said — and a place to record how the call went.
 */
export default async function CallsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const staff = await requirePageAccessAny(["calls.view", "calls.manage"]);
  const params = await searchParams;
  const filters = parseCallFilters(params);
  const pageNum = Math.max(0, parseInt(params.page ?? "1") - 1);

  return (
    <NavigationPending>
      <div className="mb-5">
        <h1 className="text-2xl font-black flex items-center gap-2">
          <PhoneCall className="w-5 h-5 text-primary-500" /> Customer care
        </h1>
        <p className="text-neutral-500 text-sm mt-1">
          {can(staff, "calls.manage")
            ? "Every calling list. Assign new ones from Reports — filter, then Assign calls."
            : "The customers you've been asked to call. Log every call, flag anything that needs a follow-up."}
        </p>
      </div>

      <Suspense
        fallback={
          <>
            <SkeletonHeader />
            <SkeletonTabs count={6} />
            <SkeletonTable rows={8} columns={4} />
          </>
        }
      >
        <Body staff={staff} filters={filters} page={pageNum} />
      </Suspense>
    </NavigationPending>
  );
}

async function Body({
  staff,
  filters,
  page,
}: {
  staff: CurrentStaff;
  filters: CallFilters;
  page: number;
}) {
  const scope = callScope(staff);
  const canManage = scope.seesEveryone;

  const [allStaff, counts, { rows, count }] = await Promise.all([
    canManage ? listStaff() : Promise.resolve([]),
    callCounts(filters, scope),
    listCalls(filters, scope, page, PER_PAGE),
  ]);

  const callStaff = allStaff
    .filter((s) => s.is_active && (can(s, "calls.view") || can(s, "calls.manage")))
    .map((s) => ({ id: s.id, name: s.name, email: s.email }));

  const totalPages = Math.ceil(count / PER_PAGE);

  return (
    <>
      <CallFilterBar
        filters={filters}
        counts={counts}
        staff={callStaff}
        canManage={canManage}
      />

      <StaleWhileRevalidating>
        <CallList
          calls={rows}
          staff={callStaff}
          canManage={canManage}
          canDeliver={can(staff, "calls.deliver") || can(staff, "delivery.complete")}
          canViewOrders={can(staff, "orders.view")}
          canEditOrders={can(staff, "orders.edit")}
        />
      </StaleWhileRevalidating>

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-xs text-neutral-500">
            Page {page + 1} of {totalPages} · {count.toLocaleString("en-IN")} calls
          </p>
          <div className="flex gap-2">
            {page > 0 && (
              <Link
                href={callsHref(filters, { page: page > 1 ? String(page) : null })}
                className="px-3 py-1.5 rounded-lg bg-white border border-neutral-200 text-sm text-neutral-700 hover:border-neutral-300"
              >
                ← Prev
              </Link>
            )}
            {page + 1 < totalPages && (
              <Link
                href={callsHref(filters, { page: String(page + 2) })}
                className="px-3 py-1.5 rounded-lg bg-white border border-neutral-200 text-sm text-neutral-700 hover:border-neutral-300"
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

import { Suspense } from "react";
import { cookies } from "next/headers";
import { PhoneCall } from "lucide-react";
import Link from "@/components/admin/AdminLink";
import { requirePageAccessAny, type CurrentStaff } from "@/lib/admin-auth";
import { can } from "@/lib/permissions";
import { SkeletonHeader, SkeletonTabs, SkeletonTable } from "@/components/admin/Skeleton";
import { NavigationPending, StaleWhileRevalidating } from "@/components/admin/Revalidating";
import { listStaff } from "@/lib/db/staff";
import { callScope, listCalls, callCounts, listBatches } from "@/lib/db/calls";
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
        <Body staff={staff} filters={filters} rawBatch={params.batch} page={pageNum} />
      </Suspense>
    </NavigationPending>
  );
}

async function Body({
  staff,
  filters: urlFilters,
  rawBatch,
  page,
}: {
  staff: CurrentStaff;
  filters: CallFilters;
  /** `batch` exactly as it came in the URL — "all" is a choice, not a filter. */
  rawBatch: string | undefined;
  page: number;
}) {
  const scope = callScope(staff);
  const canManage = scope.seesEveryone;

  // Which batch to show. The list is worked one batch at a time, so the page
  // opens on the batch this person last picked (remembered in a cookie by
  // CallFilters), not on everything:
  //   URL says "all"             → every batch
  //   URL names a batch          → that batch (a shared link wins)
  //   nothing in the URL         → the remembered choice, if it still exists
  //   nothing remembered / stale → the newest batch
  const batches = await listBatches(scope, canManage ? urlFilters.assignee : undefined);
  const batchCookie = `calls_batch_${staff.id ?? "owner"}`;
  let batch: string | undefined;
  if (rawBatch === "all") {
    batch = undefined;
  } else if (urlFilters.batch) {
    batch = urlFilters.batch;
  } else {
    const saved = (await cookies()).get(batchCookie)?.value;
    if (saved === "all") batch = undefined;
    else if (saved && batches.some((b) => b.key === saved)) batch = saved;
    else batch = batches[0]?.key;
  }
  const filters: CallFilters = { ...urlFilters, batch };

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
        batches={batches}
        batchCookie={`calls_batch_${staff.id ?? "owner"}`}
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

import { Suspense } from "react";
import Link from "next/link";
import { requirePageAccess } from "@/lib/admin-auth";
import { can } from "@/lib/permissions";
import { fetchPortalPage } from "@/lib/db/delivery-portal";
import { listDeliveryAgents, listStaff } from "@/lib/db/staff";
import { SkeletonTable } from "@/components/admin/Skeleton";
import { NavigationPending, StaleWhileRevalidating } from "@/components/admin/Revalidating";
import PortalFilters from "./PortalFilters";
import PortalGrid from "./PortalGrid";

export const dynamic = "force-dynamic";

/** A day of parcels fits on one screen; scrolling beats paging when copying. */
const PER_PAGE = 100;

interface Args {
  date?: string;
  status?: string;
  /** "1" = only parcels not yet entered with the courier. */
  pending?: string;
  pageNum: number;
  /**
   * Whose parcels to show. An agent's own id, always — it is not read from the
   * URL for them, so there is no parameter to edit. null means "everyone",
   * which only someone who can see the whole delivery queue ever gets.
   */
  agentId: string | null;
  /** Whether that id came from the filter (shareable) or from who they are. */
  seesEveryone: boolean;
}

/**
 * The delivery portal.
 *
 * A spreadsheet, on purpose. The agent's job is to read an address off the
 * screen, copy it into a courier's own system, and tick what they've done —
 * so this is a dense grid with copy buttons and checkboxes, not the card-based
 * queue at /admin/delivery. No printing, no labels, no bulk selection.
 */
export default async function DeliveryPortalPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const staff = await requirePageAccess("delivery.portal");

  // Owners and managers hold delivery.view — they run the queue, so they see
  // every agent's parcels and can narrow to one. Everyone else sees exactly
  // what was handed to them, and the filter isn't offered because there is
  // nothing for them to choose between.
  const seesEveryone = can(staff, "delivery.view");
  const agents = seesEveryone ? await listDeliveryAgents() : [];

  const params = await searchParams;
  const picked = seesEveryone && params.agent ? params.agent : null;

  const args: Args = {
    date: params.date,
    status: params.status,
    pending: params.pending,
    pageNum: Math.max(0, parseInt(params.page ?? "1") - 1),
    agentId: seesEveryone ? picked : staff.id,
    seesEveryone,
  };

  return (
    <NavigationPending>
      <PortalFilters
        agents={agents}
        countSlot={
          <Suspense fallback={<span className="text-neutral-400">Counting…</span>}>
            <PortalCount {...args} />
          </Suspense>
        }
      />

      <StaleWhileRevalidating>
        <Suspense fallback={<SkeletonTable rows={12} columns={11} />}>
          <PortalRows {...args} />
        </Suspense>
      </StaleWhileRevalidating>
    </NavigationPending>
  );
}

/** Streamed into the filter bar so it can paint before the query resolves. */
async function PortalCount(args: Args) {
  const { count } = await fetchPortalPage(args.date, args.status, args.pending, args.pageNum, PER_PAGE, args.agentId);
  return (
    <>
      {count} parcel{count === 1 ? "" : "s"}
    </>
  );
}

async function PortalRows(args: Args) {
  const [{ rows, count }, staff] = await Promise.all([
    fetchPortalPage(args.date, args.status, args.pending, args.pageNum, PER_PAGE, args.agentId),
    // Every staff member, not just assignable ones: a parcel assigned to
    // someone since switched off still has to show a name.
    listStaff(),
  ]);

  const agentNames = Object.fromEntries(staff.map((s) => [s.id, s.name]));
  const totalPages = Math.ceil(count / PER_PAGE);

  if (!rows.length) {
    return (
      <div className="bg-white border border-neutral-200 rounded-2xl p-12 text-center text-neutral-500 shadow-sm">
        No parcels here.
      </div>
    );
  }

  const pageLink = (p: number) => {
    const sp = new URLSearchParams();
    if (args.date) sp.set("date", args.date);
    if (args.status) sp.set("status", args.status);
    if (args.pending) sp.set("pending", args.pending);
    // Only when it's a filter someone chose. An agent's own id is who they
    // are, not where they are, and has no business in a shareable link.
    if (args.seesEveryone && args.agentId) sp.set("agent", args.agentId);
    if (p > 1) sp.set("page", String(p));
    const qs = sp.toString();
    return `/admin/delivery-portal${qs ? `?${qs}` : ""}`;
  };

  return (
    <>
      <PortalGrid
        rows={rows}
        startIndex={args.pageNum * PER_PAGE}
        agentNames={agentNames}
      />

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-neutral-500 text-xs">
            Page {args.pageNum + 1} of {totalPages}
          </p>
          <div className="flex gap-2">
            {args.pageNum > 0 && (
              <Link
                href={pageLink(args.pageNum)}
                className="px-3 py-1.5 rounded-lg bg-white border border-neutral-200 text-sm hover:border-neutral-300 transition-all"
              >
                ← Prev
              </Link>
            )}
            {args.pageNum + 1 < totalPages && (
              <Link
                href={pageLink(args.pageNum + 2)}
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

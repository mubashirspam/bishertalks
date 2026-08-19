import { Suspense } from "react";
import Link from "@/components/admin/AdminLink";
import { requirePageAccess } from "@/lib/admin-auth";
import { can } from "@/lib/permissions";
import {
  fetchPortalPage,
  portalSort,
  portalTracking,
  type PortalSort,
  type PortalTracking,
} from "@/lib/db/delivery-portal";
import { listDeliveryAgents } from "@/lib/db/staff";
import { listCouriers } from "@/lib/db/couriers";
import { canTrack } from "@/lib/couriers";
import { isHandoverState } from "@/lib/delivery/handover";
import { delhiveryReadiness } from "@/lib/delhivery/config";
import { SkeletonTable } from "@/components/admin/Skeleton";
import { NavigationPending, StaleWhileRevalidating } from "@/components/admin/Revalidating";
import PortalFilters from "./PortalFilters";
import PortalGrid from "./PortalGrid";

export const dynamic = "force-dynamic";

/** A day of parcels fits on one screen; scrolling beats paging when copying. */
const PER_PAGE = 100;

interface Args {
  date?: string;
  /** A PORTAL_FILTERS value — "new" is the not-yet-entered to-do list. */
  status?: string;
  /** Which end of the queue is on top — it applies on top of the filters. */
  sort: PortalSort;
  /** Which courier's parcels, or null for all of them. */
  courierId: string | null;
  /** Whether the courier has a record of it, or null for either. */
  tracking: PortalTracking | null;
  /** A handover state to narrow to, or null for all of them. */
  handover: string | null;
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

  // Owners and managers hold delivery.view — they run the queue, so they get
  // the agent filter. Everyone else does not, and is no longer scoped to rows
  // bearing their own staff id.
  //
  // That scoping was correct when a parcel was handed to a person. It is wrong
  // now that a parcel is handed to a courier: assigning only the courier — the
  // whole point of the new flow — left KKR's own login staring at an empty
  // portal, and the only way to fix it was to also assign an agent, which is
  // exactly the duplicate decision this was meant to remove.
  const seesEveryone = can(staff, "delivery.view");
  const [agents, couriers] = await Promise.all([
    seesEveryone ? listDeliveryAgents() : Promise.resolve([]),
    listCouriers(),
  ]);

  const params = await searchParams;
  const picked = seesEveryone && params.agent ? params.agent : null;

  const args: Args = {
    date: params.date,
    status: params.status,
    sort: portalSort(params.sort),
    courierId: params.courier || null,
    tracking: portalTracking(params.tracking),
    handover: isHandoverState(params.handover) ? params.handover : null,
    pageNum: Math.max(0, parseInt(params.page ?? "1") - 1),
    // null for an agent: they see every parcel routed to a courier, which
    // with one partner is precisely their work. If a second delivery company
    // is ever added, this becomes "parcels for the courier this login belongs
    // to" and needs a staff-to-courier link.
    agentId: seesEveryone ? picked : null,
    seesEveryone,
  };

  return (
    <NavigationPending>
      <PortalFilters
        agents={agents}
        couriers={couriers.filter((c) => c.is_active).map((c) => ({ id: c.id, name: c.name }))}
        trackedCourierIds={couriers.filter(canTrack).map((c) => c.id)}
        countSlot={
          <Suspense fallback={<span className="text-neutral-400">Counting…</span>}>
            <PortalCount {...args} />
          </Suspense>
        }
      />

      <StaleWhileRevalidating>
        <Suspense fallback={<SkeletonTable rows={12} columns={12} />}>
          <PortalRows {...args} />
        </Suspense>
      </StaleWhileRevalidating>
    </NavigationPending>
  );
}

/** Streamed into the filter bar so it can paint before the query resolves. */
async function PortalCount(args: Args) {
  // Same arguments as PortalRows, in the same order — fetchPortalPage is
  // memoised per request, and an argument that differs is a second query.
  const { count } = await fetchPortalPage(
    args.date,
    args.status,
    args.pageNum,
    PER_PAGE,
    args.agentId,
    args.sort,
    args.courierId,
    args.tracking,
    args.handover
  );
  return (
    <>
      {count} parcel{count === 1 ? "" : "s"}
    </>
  );
}

async function PortalRows(args: Args) {
  const { rows, count } = await fetchPortalPage(
    args.date,
    args.status,
    args.pageNum,
    PER_PAGE,
    args.agentId,
    args.sort,
    args.courierId,
    args.tracking,
    args.handover
  );

  // Names only — the grid shows which courier a parcel is routed to, so an
  // agent can tell at a glance which ones they still have to hand over.
  const couriers = await listCouriers();
  const courierNames = Object.fromEntries(couriers.map((c) => [c.id, c.name]));

  // Is the courier being looked at one we can ask for live status? Worked out
  // on the server because it needs the API token, which must not reach the
  // browser. When true the grid shows waybills and the courier's own scans
  // instead of asking someone to keep a spreadsheet in their head.
  const chosen = args.courierId ? couriers.find((c) => c.id === args.courierId) : null;
  const live = !!chosen && canTrack(chosen) && delhiveryReadiness(chosen.config).ready;

  // Whichever active courier can actually be asked. Independent of the filter,
  // so "sync everything" is offered even on "All couriers" — which is where
  // most people land, and where the button used to vanish.
  const syncCourier = couriers.find(
    (c) => c.is_active && canTrack(c) && delhiveryReadiness(c.config).ready
  );

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
    // "newest" is the default, so it stays out of the URL — same as the
    // filter bar writes it, or Next would treat the two as different pages.
    if (args.sort === "oldest") sp.set("sort", args.sort);
    if (args.courierId) sp.set("courier", args.courierId);
    if (args.tracking) sp.set("tracking", args.tracking);
    if (args.handover) sp.set("handover", args.handover);
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
        courierNames={courierNames}
        courierId={args.courierId}
        syncCourierId={syncCourier?.id ?? null}
        live={live}
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

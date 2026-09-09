import { Suspense } from "react";
import Link from "@/components/admin/AdminLink";
import { requirePageAccess } from "@/lib/admin-auth";
import {
  fetchPortalPage,
  withPostalBarcodes,
  portalSort,
  portalTracking,
  portalPacking,
  portalSearch,
  portalDeliveryMode,
  type PortalSort,
  type PortalTracking,
  type PortalPacking,
  type PortalSearch,
  type CourierScope,
} from "@/lib/db/delivery-portal";
import type { DeliveryMode } from "@/lib/delivery-mode";
import { portalScope } from "@/lib/delivery/scope";
import { can } from "@/lib/permissions";
import { listCouriers } from "@/lib/db/couriers";
import { canTrack, trackingIdLabel } from "@/lib/couriers";
import { isHandoverState } from "@/lib/delivery/handover";
import { delhiveryReadiness } from "@/lib/delhivery/config";
import { SkeletonTable } from "@/components/admin/Skeleton";
import { NavigationPending, StaleWhileRevalidating } from "@/components/admin/Revalidating";
import ContactDownload from "@/components/admin/ContactDownload";
import PortalFilters from "./PortalFilters";
import PortalGrid from "./PortalGrid";

export const dynamic = "force-dynamic";

/** A day of parcels fits on one screen; scrolling beats paging when copying. */
const PER_PAGE = 100;

interface Args {
  date?: string;
  /** The last day of the range, inclusive. Absent means `date` is one day. */
  dateTo?: string;
  /** A PORTAL_FILTERS value — "new" is the not-yet-entered to-do list. */
  status?: string;
  /** Which end of the queue is on top — it applies on top of the filters. */
  sort: PortalSort;
  /**
   * What actually restricts the query — one id, several (an unfiltered
   * multi-courier partner login, 0071), or null for no restriction.
   */
  courierId: CourierScope;
  /**
   * The one courier explicitly picked from the dropdown, if any — by an
   * owner narrowing the whole queue, or by a multi-courier partner narrowing
   * their own. Distinct from `courierId` because live-tracking only makes
   * sense once a single courier is in view, and a partner scoped to several
   * couriers with no filter set has no single one of them "chosen".
   */
  filterCourierId: string | null;
  /** Whether the courier has a record of it, or null for either. */
  tracking: PortalTracking | null;
  /** A handover state to narrow to, or null for all of them. */
  handover: string | null;
  /** Gift / signed / neither, or null for all of them. */
  packing: PortalPacking | null;
  /** 'normal' | 'cod', or null for both. */
  deliveryMode: DeliveryMode | null;
  /** Show only urgent parcels — never a reason to hide one otherwise. */
  urgentOnly: boolean;
  pageNum: number;
  /**
   * One order number, mobile or name to narrow to, or null for everything.
   *
   * A filter like the rest, and in the URL like the rest, so a link to "that
   * customer's parcel" is something someone can paste into WhatsApp.
   */
  search: PortalSearch | null;
  /** Whether the filters came from the URL (shareable) or from who they are. */
  seesEveryone: boolean;
  /** May they tick Delivered? False for a partner login — see the grid. */
  mayComplete: boolean;
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

  // Who this login is allowed to see. Owners and managers run the queue and get
  // every courier plus the filters; a partner login is pinned to its own
  // courier and cannot widen that from the URL.
  //
  // The second delivery company the old comment here anticipated has arrived,
  // and with it the staff-to-courier link it said would be needed (0047).
  const scope = portalScope(staff);
  const seesEveryone = scope.seesEveryone;

  const couriers = await listCouriers();

  const params = await searchParams;

  // A single courier explicitly picked from the dropdown — by an owner
  // narrowing the whole queue, or by a multi-courier partner (0071) narrowing
  // their own. Ignored if it names a courier that login cannot see: the URL
  // is not proof of anything, and this is the one place that would otherwise
  // let a partner widen their own scope by editing it.
  const filterCourierId =
    params.courier && (seesEveryone || scope.courierIds.includes(params.courier))
      ? params.courier
      : null;

  const args: Args = {
    date: params.date,
    dateTo: params.to,
    // "New" — the not-yet-routed to-do list — is what the portal opens on. An
    // explicit `?status=all` (written by the dropdown's All option, not by
    // clearing the param) is what actually asks for everything.
    status: params.status ?? "new",
    sort: portalSort(params.sort),
    // The explicit pick if there is one; otherwise every courier for an
    // owner, or every courier this partner login is linked to.
    courierId: filterCourierId ?? (seesEveryone ? null : scope.courierIds),
    filterCourierId,
    tracking: portalTracking(params.tracking),
    handover: isHandoverState(params.handover) ? params.handover : null,
    packing: portalPacking(params.packing),
    deliveryMode: portalDeliveryMode(params.mode),
    urgentOnly: params.urgent === "1",
    pageNum: Math.max(0, parseInt(params.page ?? "1") - 1),
    // Not gated on `seesEveryone`: a partner searching their own queue is
    // narrowing rows they were already being shown, and the scope above still
    // pins them to their own courier whatever they type.
    search: portalSearch(params.q),
    seesEveryone,
    mayComplete: can(staff, "delivery.complete"),
  };

  // A partner login nobody has linked to a courier yet. It is scoped to
  // nothing, and an empty grid would read as "no work today" — which is the
  // one wrong thing to tell somebody whose parcels are sitting on a shelf.
  if (!seesEveryone && !scope.courierIds.length) {
    return (
      <div className="bg-white border border-neutral-200 rounded-2xl p-12 text-center shadow-sm">
        <p className="font-semibold text-neutral-800">
          Your login isn&apos;t linked to a delivery partner yet.
        </p>
        <p className="text-sm text-neutral-500 mt-2">
          Ask the admin to set your delivery partner — your parcels will appear
          here as soon as they do.
        </p>
      </div>
    );
  }

  return (
    <NavigationPending>
      <PortalFilters
        couriers={
          seesEveryone
            ? couriers.filter((c) => c.is_active).map((c) => ({ id: c.id, name: c.name }))
            // A multi-courier partner (0071) gets the picker too, but only
            // among their own — and only once there is more than one to pick
            // between, or it would be a dropdown offering a single option.
            : scope.courierIds.length > 1
              ? couriers
                  .filter((c) => scope.courierIds.includes(c.id))
                  .map((c) => ({ id: c.id, name: c.name }))
              : []
        }
        trackedCourierIds={couriers.filter(canTrack).map((c) => c.id)}
        // Plain, and offered to everyone the portal is: a partner downloading
        // their own filtered parcels is the same rows they are already looking
        // at, and the route pins them to their own courier whatever the URL
        // says.
        downloadSlot={<ContactDownload />}
        countSlot={
          <Suspense fallback={<span className="text-neutral-400">Counting…</span>}>
            <PortalCount {...args} />
          </Suspense>
        }
      />

      <StaleWhileRevalidating>
        <Suspense fallback={<SkeletonTable rows={12} columns={13} />}>
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
    null,
    args.sort,
    args.courierId,
    args.tracking,
    args.handover,
    args.packing,
    args.dateTo,
    args.search,
    args.deliveryMode,
    args.urgentOnly
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
    null,
    args.sort,
    args.courierId,
    args.tracking,
    args.handover,
    args.packing,
    args.dateTo,
    args.search,
    args.deliveryMode,
    args.urgentOnly
  );

  // The article number for any of these parcels that has one. See
  // withPostalBarcodes for why it is a second lookup and not a column.
  const parcels = await withPostalBarcodes(rows);

  // Names only — the grid shows which courier a parcel is routed to, so an
  // agent can tell at a glance which ones they still have to hand over.
  const couriers = await listCouriers();
  const courierNames = Object.fromEntries(couriers.map((c) => [c.id, c.name]));
  // What THIS courier calls its own tracking number — Waybill, Article
  // number, DTDC number — so the input asks for the right thing instead of a
  // generic "Tracking ID" whatever the parcel is routed to. See trackingIdLabel().
  const courierTrackingLabels = Object.fromEntries(
    couriers.map((c) => [c.id, trackingIdLabel(c)])
  );

  // Is the courier being looked at one we can ask for live status? Worked out
  // on the server because it needs the API token, which must not reach the
  // browser. When true the grid shows waybills and the courier's own scans
  // instead of asking someone to keep a spreadsheet in their head.
  const chosen = args.filterCourierId
    ? couriers.find((c) => c.id === args.filterCourierId)
    : null;
  const live = !!chosen && canTrack(chosen) && delhiveryReadiness(chosen.config).ready;

  // Whichever courier the sweep should ask. The one being looked at wherever
  // there is one, falling back to the first askable courier on "All couriers"
  // — which is where most people land, and where the button used to vanish.
  //
  // The fallback used to be the whole rule, and it was wrong in the one case
  // that mattered: two couriers share the Delhivery account, and `find` always
  // returned the API one. Someone filtered to the sheet courier pressed "Sync
  // everything", waited three minutes, and swept the OTHER courier's parcels —
  // the sweep scopes to `courier_id.eq.<target>`, so theirs were never in
  // range. Every one of the 674 parcels KKR had uploaded stayed "Not with
  // them", however many times it was pressed.
  // The couriers whose parcels carry an India Post article number. Sent to the
  // grid so the Allot button appears only where the number means something —
  // a Delhivery parcel must never take one.
  const postalCourierIds = couriers
    .filter((c) => c.config?.tracking === "india-post")
    .map((c) => c.id);

  // The two rows a parcel can move between with the channel switch — KKR
  // Logistics' own default (Delhivery, DTDC or Trackon) and the separate
  // India Post channel (0068). Sent down so the grid only offers the switch
  // where it means something; see setCourierChannel for why it refuses
  // everywhere else anyway.
  const kkrChannelCourierIds = couriers
    .filter((c) => c.slug === "delhivery-sheet" || c.slug === "kkr-india-post")
    .map((c) => c.id);

  const askable = (c: (typeof couriers)[number]) =>
    c.is_active && canTrack(c) && delhiveryReadiness(c.config).ready;
  const syncCourier = (chosen && askable(chosen) ? chosen : null) ?? couriers.find(askable);

  const totalPages = Math.ceil(count / PER_PAGE);

  if (!rows.length) {
    return (
      <div className="bg-white border border-neutral-200 rounded-2xl p-12 text-center text-neutral-500 shadow-sm">
        {args.search
          ? // Naming the search, because the likeliest reason for no rows is
            // that it is narrowing inside a date filter somebody forgot was on.
            `No parcel here matches “${args.search.raw}”. It may be outside the
             dates or the filters above.`
          : "No parcels here."}
      </div>
    );
  }

  const pageLink = (p: number) => {
    const sp = new URLSearchParams();
    if (args.date) sp.set("date", args.date);
    if (args.dateTo) sp.set("to", args.dateTo);
    if (args.status) sp.set("status", args.status);
    // "newest" is the default, so it stays out of the URL — same as the
    // filter bar writes it, or Next would treat the two as different pages.
    if (args.sort === "oldest") sp.set("sort", args.sort);
    if (args.filterCourierId) sp.set("courier", args.filterCourierId);
    if (args.tracking) sp.set("tracking", args.tracking);
    if (args.handover) sp.set("handover", args.handover);
    if (args.packing) sp.set("packing", args.packing);
    if (args.deliveryMode) sp.set("mode", args.deliveryMode);
    if (args.urgentOnly) sp.set("urgent", "1");
    if (args.search) sp.set("q", args.search.raw);
    if (p > 1) sp.set("page", String(p));
    const qs = sp.toString();
    return `/admin/delivery-portal${qs ? `?${qs}` : ""}`;
  };

  return (
    <>
      <PortalGrid
        rows={parcels}
        startIndex={args.pageNum * PER_PAGE}
        courierNames={courierNames}
        courierTrackingLabels={courierTrackingLabels}
        courierId={args.filterCourierId}
        syncCourierId={syncCourier?.id ?? null}
        postalCourierIds={postalCourierIds}
        kkrChannelCourierIds={kkrChannelCourierIds}
        live={live}
        mayComplete={args.mayComplete}
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

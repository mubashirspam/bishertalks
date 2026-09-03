import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/admin-auth";
import { countUnassignedParcels } from "@/lib/db/delivery-query";
import { stockWarning } from "@/lib/db/inventory";
import { can } from "@/lib/permissions";
import { hasNavigation } from "@/lib/admin-nav";
import LogoutButton from "@/components/admin/LogoutButton";
import PageTitle from "@/components/admin/PageTitle";
import AdminSidebar from "./AdminSidebar";
import AdminMain from "./AdminMain";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The one thing that genuinely has to block: we can't render an admin panel
  // without knowing who's looking at it. Memoised per request (see
  // getCurrentStaff), so the page guard below reuses this result instead of
  // paying for a second auth round trip.
  const staff = await getCurrentStaff();
  if (!staff) redirect("/admin/login");

  /**
   * A delivery agent can open exactly one screen. A sidebar whose only link is
   * the page you are already on is a column of empty space beside the thing
   * they came to use — and on the portal, which is a wide spreadsheet, it is
   * space with a real cost. So they get no sidebar and the whole window.
   *
   * The header stays, at every size rather than desktop-only: it carries the
   * way out. Without a sidebar there is no other logout button, and an agent
   * works from a phone.
   */
  const navigable = hasNavigation(staff);

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 lg:flex">
      {/* Counts are streamed, not awaited. They're two more database round
          trips, and nothing on the page depends on them — waiting would delay
          every screen to render a badge. The sidebar paints immediately and the
          numbers appear a moment later. */}
      {navigable && (
        <Suspense
          fallback={
            <AdminSidebar
              email={staff.email}
              name={staff.name}
              role={staff.role}
              permissions={staff.permissions}
              unassigned={0}
              lowStock={null}
            />
          }
        >
          <SidebarWithCounts
            email={staff.email}
            name={staff.name}
            role={staff.role}
            permissions={staff.permissions}
            canSeeDelivery={can(staff, "delivery.view")}
            canSeeStock={can(staff, "inventory.view")}
          />
        </Suspense>
      )}

      <div className="flex-1 min-w-0">
        {/* The page heading lives here rather than at the top of each body, so
            the content starts at the top of the viewport instead of below two
            lines of text that repeat what the sidebar already highlights. */}
        <header
          className={`items-center justify-between gap-4 border-b border-neutral-200 bg-white px-4 lg:px-8 py-2 ${
            navigable ? "hidden lg:flex" : "flex sticky top-0 z-40"
          }`}
        >
          <Suspense fallback={null}>
            <PageTitle />
          </Suspense>
          <LogoutButton />
        </header>
        <AdminMain wide={!navigable}>{children}</AdminMain>
      </div>
    </div>
  );
}

/**
 * The sidebar again, once the work counts are known.
 *
 * Only counts what this person can act on — a delivery agent being told "12
 * orders need an address" would be nagged about work they can't open.
 */
async function SidebarWithCounts({
  canSeeDelivery,
  canSeeStock,
  ...props
}: {
  email: string;
  name: string;
  role: Parameters<typeof AdminSidebar>[0]["role"];
  permissions: string[];
  canSeeDelivery: boolean;
  canSeeStock: boolean;
}) {
  // Both cached and both short-lived, so this is two tag reads rather than two
  // queries on most page views. Asked in parallel: they answer to different
  // tags and neither waits on the other.
  const [unassigned, stock] = await Promise.all([
    canSeeDelivery ? countUnassignedParcels() : Promise.resolve(0),
    canSeeStock ? stockWarning() : Promise.resolve(null),
  ]);

  return (
    <AdminSidebar
      {...props}
      unassigned={unassigned}
      // Only when it is worth interrupting for. A badge that is always there
      // is furniture, and stops being read on the day it matters.
      lowStock={stock && (stock.low || stock.oversold) ? stock.free : null}
    />
  );
}

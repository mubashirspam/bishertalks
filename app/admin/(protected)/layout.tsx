import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/admin-auth";
import { buildDeliveryQuery } from "@/lib/db/delivery-query";
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
            />
          }
        >
          <SidebarWithCounts
            email={staff.email}
            name={staff.name}
            role={staff.role}
            permissions={staff.permissions}
            canSeeDelivery={can(staff, "delivery.view")}
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
  ...props
}: {
  email: string;
  name: string;
  role: Parameters<typeof AdminSidebar>[0]["role"];
  permissions: string[];
  canSeeDelivery: boolean;
}) {
  const unassigned = canSeeDelivery ? await countUnassigned() : 0;

  return <AdminSidebar {...props} unassigned={unassigned} />;
}

/**
 * Parcels nobody is carrying yet — the New tab of the delivery queue.
 *
 * This used to count parcels with no label printed, which was the same thing
 * back when printing a sheet was how a batch got handed over. It is not any
 * more: a parcel can be assigned to an agent straight from the list, without a
 * PDF ever coming out, and those stayed in the badge for good — the number
 * only ever went up, and stopped meaning anything.
 *
 * Built from the delivery queue's own definition of "new" so the badge and the
 * tab it links to can never disagree.
 */
async function countUnassigned(): Promise<number> {
  const { count, error } = await buildDeliveryQuery(
    { stage: "new" },
    { countOnly: true }
  );

  if (error) {
    console.error("[Sidebar] new-parcel count failed:", error.message);
    return 0;
  }
  return count ?? 0;
}

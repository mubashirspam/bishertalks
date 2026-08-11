import { Suspense } from "react";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentStaff } from "@/lib/admin-auth";
import { can } from "@/lib/permissions";
import LogoutButton from "@/components/admin/LogoutButton";
import PageTitle from "@/components/admin/PageTitle";
import AdminSidebar from "./AdminSidebar";

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

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 lg:flex">
      {/* Counts are streamed, not awaited. They're two more database round
          trips, and nothing on the page depends on them — waiting would delay
          every screen to render a badge. The sidebar paints immediately and the
          numbers appear a moment later. */}
      <Suspense
        fallback={
          <AdminSidebar
            email={staff.email}
            name={staff.name}
            role={staff.role}
            permissions={staff.permissions}
            toPrint={0}
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

      <div className="flex-1 min-w-0">
        {/* The page heading lives here rather than at the top of each body, so
            the content starts at the top of the viewport instead of below two
            lines of text that repeat what the sidebar already highlights. */}
        <header className="hidden lg:flex items-center justify-between gap-4 border-b border-neutral-200 bg-white px-8 py-2">
          <Suspense fallback={null}>
            <PageTitle />
          </Suspense>
          <LogoutButton />
        </header>
        <main className="px-4 lg:px-8 py-4 lg:py-5 max-w-7xl">{children}</main>
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
  const toPrint = canSeeDelivery ? await countToPrint() : 0;

  return <AdminSidebar {...props} toPrint={toPrint} />;
}

/** Shippable and waiting for a label — the daily job. */
async function countToPrint(): Promise<number> {
  const { count } = await supabaseAdmin
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("payment_status", "paid")
    .not("address_line1", "is", null)
    .in("status", ["confirmed", "processing"])
    .is("label_downloaded_at", null);
  return count ?? 0;
}

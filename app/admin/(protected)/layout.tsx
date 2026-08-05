import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import LogoutButton from "@/components/admin/LogoutButton";
import AdminSidebar from "./AdminSidebar";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/admin/login");
  if (user.email !== process.env.ADMIN_EMAIL) redirect("/");

  // Paid orders with no delivery address — money taken, nothing shippable.
  // Counted here so the badge shows on every admin screen, not just Orders.
  const { count: needsAddress } = await supabaseAdmin
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("payment_status", "paid")
    .is("address_line1", null);

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 lg:flex">
      <AdminSidebar email={user.email!} needsAddress={needsAddress ?? 0} />

      <div className="flex-1 min-w-0">
        <header className="hidden lg:flex items-center justify-end border-b border-neutral-200 bg-white px-8 py-3">
          <LogoutButton />
        </header>
        <main className="px-4 lg:px-8 py-6 lg:py-8 max-w-7xl">{children}</main>
      </div>
    </div>
  );
}

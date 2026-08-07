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

  // The two piles of work, counted here so both badges show on every admin
  // screen rather than only on the page that owns them:
  //   needsAddress — paid, but nothing to ship to. Costs money if ignored.
  //   toPrint      — shippable and waiting for a label. The daily job.
  const [{ count: needsAddress }, { count: toPrint }] = await Promise.all([
    supabaseAdmin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("payment_status", "paid")
      .is("address_line1", null),
    supabaseAdmin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("payment_status", "paid")
      .not("address_line1", "is", null)
      .in("status", ["confirmed", "processing"])
      .is("label_downloaded_at", null),
  ]);

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 lg:flex">
      <AdminSidebar
        email={user.email!}
        needsAddress={needsAddress ?? 0}
        toPrint={toPrint ?? 0}
      />

      <div className="flex-1 min-w-0">
        <header className="hidden lg:flex items-center justify-end border-b border-neutral-200 bg-white px-8 py-3">
          <LogoutButton />
        </header>
        <main className="px-4 lg:px-8 py-6 lg:py-8 max-w-7xl">{children}</main>
      </div>
    </div>
  );
}

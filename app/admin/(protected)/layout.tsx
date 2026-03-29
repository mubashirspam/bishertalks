import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import LogoutButton from "@/components/admin/LogoutButton";

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

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <header className="border-b border-white/8 px-6 py-3 flex items-center justify-between sticky top-0 bg-neutral-950/95 backdrop-blur-sm z-50">
        <div className="flex items-center gap-6">
          <Link href="/admin/orders" className="font-bold text-sm">
            Neuro <span className="text-primary-400">Code</span>{" "}
            <span className="text-neutral-500 font-normal">Admin</span>
          </Link>
          <nav className="flex gap-1">
            <Link
              href="/admin/orders"
              className="px-3 py-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/5 text-sm transition-all"
            >
              Orders
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-neutral-600 text-xs hidden md:block">{user.email}</span>
          <LogoutButton />
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-6 py-8">{children}</main>
    </div>
  );
}

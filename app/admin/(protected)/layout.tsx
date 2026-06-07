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

  const navLink =
    "px-3 py-1.5 rounded-lg text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 text-sm transition-all";

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <header className="border-b border-neutral-200 px-6 py-3 flex items-center justify-between sticky top-0 bg-white/95 backdrop-blur-sm z-50">
        <div className="flex items-center gap-6">
          <Link href="/admin/orders" className="font-bold text-sm text-neutral-900">
            Neuro <span className="text-primary-500">Code</span>{" "}
            <span className="text-neutral-400 font-normal">Admin</span>
          </Link>
          <nav className="flex gap-1">
            <Link href="/admin/orders" className={navLink}>Orders</Link>
            <Link href="/admin/users" className={navLink}>Users</Link>
            <Link href="/admin/courses" className={navLink}>Courses</Link>
            <Link href="/admin/promos" className={navLink}>Promos</Link>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-neutral-400 text-xs hidden md:block">{user.email}</span>
          <LogoutButton />
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-6 py-8">{children}</main>
    </div>
  );
}

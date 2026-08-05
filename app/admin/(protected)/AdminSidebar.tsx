"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard, ShoppingBag, Users, BookOpen, Tag, Menu, X, AlertCircle,
} from "lucide-react";

const NAV = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/admin/orders", label: "Orders", icon: ShoppingBag },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/courses", label: "Courses", icon: BookOpen },
  { href: "/admin/promos", label: "Promos", icon: Tag },
];

/**
 * Left navigation. Client-side so the active item can be highlighted from the
 * pathname and so it can collapse on mobile.
 *
 * `needsAddress` is passed from the server layout and surfaced as a badge —
 * paid orders with no delivery address are the one thing that costs money if
 * it goes unnoticed, so it's visible from every screen.
 */
export default function AdminSidebar({
  email,
  needsAddress,
}: {
  email: string;
  needsAddress: number;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname.startsWith(href);

  const nav = (
    <nav className="flex flex-col gap-1 px-3">
      {NAV.map(({ href, label, icon: Icon, exact }) => {
        const active = isActive(href, exact);
        return (
          <Link
            key={href}
            href={href}
            onClick={() => setOpen(false)}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
              active
                ? "bg-primary-500 text-white shadow-sm shadow-primary-500/25"
                : "text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100"
            }`}
          >
            <Icon className="w-4 h-4 flex-shrink-0" />
            <span className="flex-1">{label}</span>
            {href === "/admin/orders" && needsAddress > 0 && (
              <span
                className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full ${
                  active ? "bg-white/25 text-white" : "bg-orange-100 text-orange-700"
                }`}
                title="Paid orders with no delivery address"
              >
                {needsAddress}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <>
      {/* Mobile bar */}
      <div className="lg:hidden sticky top-0 z-50 flex items-center justify-between border-b border-neutral-200 bg-white/95 backdrop-blur-sm px-4 py-3">
        <button onClick={() => setOpen(!open)} className="p-1.5 -ml-1.5 text-neutral-600">
          {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
        <span className="font-bold text-sm">
          Neuro <span className="text-primary-500">Code</span>{" "}
          <span className="text-neutral-400 font-normal">Admin</span>
        </span>
        {needsAddress > 0 ? (
          <span className="flex items-center gap-1 text-orange-600 text-xs font-bold">
            <AlertCircle className="w-3.5 h-3.5" /> {needsAddress}
          </span>
        ) : (
          <span className="w-8" />
        )}
      </div>

      {open && (
        <div className="lg:hidden border-b border-neutral-200 bg-white py-3">{nav}</div>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-60 flex-shrink-0 flex-col border-r border-neutral-200 bg-white h-screen sticky top-0">
        <div className="px-6 py-5 border-b border-neutral-100">
          <Link href="/admin" className="font-bold text-sm">
            Neuro <span className="text-primary-500">Code</span>
            <span className="block text-neutral-400 font-normal text-xs mt-0.5">
              Admin panel
            </span>
          </Link>
        </div>

        <div className="py-4 flex-1 overflow-y-auto">{nav}</div>

        <div className="px-5 py-4 border-t border-neutral-100">
          <p className="text-neutral-400 text-xs truncate" title={email}>{email}</p>
        </div>
      </aside>
    </>
  );
}

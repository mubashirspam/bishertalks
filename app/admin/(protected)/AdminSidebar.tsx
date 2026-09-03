"use client";

import Link from "@/components/admin/AdminLink";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Truck, Menu, X } from "lucide-react";
import { ROLE_LABELS, ROLE_BADGE, type StaffRole } from "@/lib/permissions";
import { visibleNav } from "@/lib/admin-nav";
import LogoutButton from "@/components/admin/LogoutButton";

/**
 * Left navigation. Client-side so the active item can be highlighted from the
 * pathname and so it can collapse on mobile.
 *
 * Items the signed-in person can't use are not rendered — this is presentation
 * only; the actual enforcement is `requirePermission` in the API routes. Nav
 * items live in lib/admin-nav.ts because the layout counts them before it
 * decides whether to render this at all: someone with one screen gets no
 * sidebar.
 *
 * `unassigned` comes from the server layout and is surfaced as a badge, so the
 * parcels nobody is carrying yet are visible from every screen.
 */
export default function AdminSidebar({
  email,
  name,
  role,
  permissions,
  unassigned,
  lowStock,
}: {
  email: string;
  name: string;
  role: StaffRole;
  permissions: string[];
  unassigned: number;
  /**
   * Books free to sell, when that number is low enough to say so — null when
   * there is nothing to warn about, when stock is not set up, or when the
   * viewer cannot see it.
   */
  lowStock: number | null;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const items = visibleNav({ role, permissions });

  /**
   * Match on a path segment, not a string prefix.
   *
   * A plain `startsWith` lit up "Delivery" whenever you were on
   * /admin/delivery-portal, because one href is a literal prefix of the other.
   * Requiring the next character to be a "/" means only a real child route
   * counts — /admin/orders/ORD-1 still highlights Orders.
   */
  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  const badges: Record<string, { count: number; title: string; tone: string }> = {
    "/admin/delivery": {
      count: unassigned,
      title: "Parcels not yet handed to a delivery agent",
      tone: "bg-blue-100 text-blue-700",
    },
    ...(lowStock !== null
      ? {
          "/admin/inventory": {
            count: lowStock,
            title:
              lowStock < 0
                ? "More books are sold than exist"
                : "Books left to sell — running low",
            // Red for oversold, amber for low. The two are different problems:
            // one is a forecast, the other has already happened.
            tone:
              lowStock < 0
                ? "bg-red-100 text-red-700"
                : "bg-amber-100 text-amber-800",
          },
        }
      : {}),
  };

  /**
   * Who you are signed in as, and the way out.
   *
   * One block used by both layouts rather than two copies: the desktop footer
   * had the identity and no sign-out, the mobile menu had neither, and the
   * header that carried the only sign-out is `hidden lg:flex` whenever this
   * sidebar renders. So on a phone an owner could not sign out at all — and on
   * a desktop the only way out was a 12px grey word in the far corner.
   */
  const identity = (
    <>
      <p className="truncate text-xs font-medium text-neutral-700">{name}</p>
      <p className="truncate text-[11px] text-neutral-400" title={email}>
        {email}
      </p>
      <span
        className={`mt-1.5 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${ROLE_BADGE[role]}`}
      >
        {ROLE_LABELS[role]}
      </span>
      <LogoutButton variant="block" />
    </>
  );

  const nav = (
    <nav className="flex flex-col gap-1 px-3">
      {items.map(({ href, label, icon: Icon, exact }) => {
        const active = isActive(href, exact);
        const badge = badges[href];
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
            {badge && badge.count > 0 && (
              <span
                className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full ${
                  active ? "bg-white/25 text-white" : badge.tone
                }`}
                title={badge.title}
              >
                {badge.count}
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
        <span className="flex items-center gap-2 min-w-8 justify-end">
          {unassigned > 0 && (
            <span
              className="flex items-center gap-1 text-blue-600 text-xs font-bold"
              title="Parcels not yet handed to a delivery agent"
            >
              <Truck className="w-3.5 h-3.5" /> {unassigned}
            </span>
          )}
        </span>
      </div>

      {open && (
        <div className="lg:hidden border-b border-neutral-200 bg-white py-3">
          {nav}
          <div className="mt-3 border-t border-neutral-100 px-6 pt-3">{identity}</div>
        </div>
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

        {/* Who you're signed in as, and with what. Worth showing once more
            than one person uses the panel — "why can't I see Orders?" is
            answered by looking at the badge. The way out belongs here too:
            it is where you look for it once your own name is on the screen. */}
        <div className="px-5 py-4 border-t border-neutral-100">{identity}</div>
      </aside>
    </>
  );
}

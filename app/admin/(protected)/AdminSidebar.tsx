"use client";

import Link from "@/components/admin/AdminLink";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Truck, Menu, X, ChevronsLeft, ChevronsRight } from "lucide-react";
import { ROLE_LABELS, ROLE_BADGE, type StaffRole } from "@/lib/permissions";
import { visibleNav, SIDEBAR_COOKIE } from "@/lib/admin-nav";
import LogoutButton from "@/components/admin/LogoutButton";

/** The saved choice, when this is running in a browser — see the initial state. */
function savedCollapsed(): boolean | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${SIDEBAR_COOKIE}=([^;]*)`));
  return match ? match[1] === "collapsed" : false;
}

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
 *
 * On desktop it folds down to an icon rail, for wide screens like the delivery
 * queue and the report. The choice is a cookie the layout reads on the server
 * (`collapsed`), so a page loads already in the right shape instead of
 * snapping into it after paint.
 */
export default function AdminSidebar({
  email,
  name,
  role,
  permissions,
  unassigned,
  lowStock,
  urgentTasks,
  collapsed: initialCollapsed = false,
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
  /** Unsolved and flagged urgent — 0 when there's nothing worth flagging. */
  urgentTasks: number;
  /** Desktop rail state from the cookie, as the server read it. */
  collapsed?: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // The server's reading of the cookie for the first paint. In the browser the
  // cookie itself wins: the layout renders this twice (a fallback, then again
  // once the badge counts arrive), and the second copy mounts fresh — reading
  // the cookie keeps a toggle made in between from being undone. During
  // hydration the two agree, because the server read that same cookie.
  const [collapsed, setCollapsed] = useState<boolean>(
    () => savedCollapsed() ?? initialCollapsed
  );

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = next
      ? `${SIDEBAR_COOKIE}=collapsed; path=/admin; max-age=31536000; samesite=lax`
      : `${SIDEBAR_COOKIE}=; path=/admin; max-age=0; samesite=lax`;
  };

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
    "/admin/tasks": {
      count: urgentTasks,
      title: "Urgent tasks still open",
      tone: "bg-red-100 text-red-700",
    },
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

  /** `rail` is the collapsed desktop form: icons only, labels on hover. */
  const renderNav = (rail: boolean) => (
    <nav className={`flex flex-col gap-1 ${rail ? "px-2" : "px-3"}`}>
      {items.map(({ href, label, icon: Icon, exact }) => {
        const active = isActive(href, exact);
        const badge = badges[href];
        const showBadge = badge && badge.count > 0;
        return (
          <Link
            key={href}
            href={href}
            onClick={() => setOpen(false)}
            title={rail ? (showBadge ? `${label} — ${badge.count}` : label) : undefined}
            className={`relative flex items-center rounded-xl text-sm font-medium transition-all ${
              rail ? "justify-center px-0 py-2.5" : "gap-3 px-3 py-2.5"
            } ${
              active
                ? "bg-primary-500 text-white shadow-sm shadow-primary-500/25"
                : "text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100"
            }`}
          >
            <Icon className="w-4 h-4 flex-shrink-0" />
            {!rail && <span className="flex-1">{label}</span>}
            {showBadge &&
              (rail ? (
                <span
                  className={`absolute -top-0.5 right-0.5 min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold leading-4 text-center ${
                    active ? "bg-white text-primary-600" : badge.tone
                  }`}
                  title={badge.title}
                >
                  {badge.count > 99 ? "99+" : badge.count}
                </span>
              ) : (
                <span
                  className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full ${
                    active ? "bg-white/25 text-white" : badge.tone
                  }`}
                  title={badge.title}
                >
                  {badge.count}
                </span>
              ))}
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
          {renderNav(false)}
          <div className="mt-3 border-t border-neutral-100 px-6 pt-3">{identity}</div>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside
        className={`hidden lg:flex flex-shrink-0 flex-col border-r border-neutral-200 bg-white h-screen sticky top-0 transition-[width] duration-200 ${
          collapsed ? "w-16" : "w-60"
        }`}
      >
        <div
          className={`flex items-center border-b border-neutral-100 ${
            collapsed ? "flex-col gap-2 px-2 py-4" : "justify-between gap-2 pl-6 pr-3 py-5"
          }`}
        >
          <Link href="/admin" className="font-bold text-sm" title="Neuro Code admin">
            {collapsed ? (
              <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-primary-50 text-primary-600 text-xs font-black">
                NC
              </span>
            ) : (
              <>
                Neuro <span className="text-primary-500">Code</span>
                <span className="block text-neutral-400 font-normal text-xs mt-0.5">
                  Admin panel
                </span>
              </>
            )}
          </Link>
          <button
            onClick={toggleCollapsed}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100 transition-colors"
          >
            {collapsed ? <ChevronsRight className="w-4 h-4" /> : <ChevronsLeft className="w-4 h-4" />}
          </button>
        </div>

        <div className="py-4 flex-1 overflow-y-auto overflow-x-hidden">{renderNav(collapsed)}</div>

        {/* Who you're signed in as, and with what. Worth showing once more
            than one person uses the panel — "why can't I see Orders?" is
            answered by looking at the badge. The way out belongs here too:
            it is where you look for it once your own name is on the screen.
            Folded to an initial on the rail; sign-out is still in the header. */}
        {collapsed ? (
          <div className="flex justify-center py-4 border-t border-neutral-100">
            <button
              onClick={toggleCollapsed}
              title={`${name} — ${email} · ${ROLE_LABELS[role]}`}
              className="flex items-center justify-center w-9 h-9 rounded-full bg-neutral-100 text-neutral-700 text-sm font-bold hover:bg-neutral-200"
            >
              {(name || email).trim().charAt(0).toUpperCase()}
            </button>
          </div>
        ) : (
          <div className="px-5 py-4 border-t border-neutral-100">{identity}</div>
        )}
      </aside>
    </>
  );
}

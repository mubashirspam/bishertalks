import {
  LayoutDashboard, ShoppingBag, Truck, TrendingUp, Users, BookOpen, Tag,
  Shield, Gift, LayoutTemplate, ClipboardCheck, Calculator, PackageCheck,
  MessageSquare, Inbox,
} from "lucide-react";
import { can, type Permission, type PermissionHolder } from "@/lib/permissions";

/**
 * The admin's left navigation.
 *
 * Lives here rather than inside AdminSidebar because the layout has to know
 * how many items a person can actually see before it decides whether to draw a
 * sidebar at all — and the layout is a server component, so it can't ask the
 * client one. Two copies of this list would disagree the first time an item
 * was added.
 *
 * The dashboard is gated on `orders.view` because it shows revenue and order
 * counts — a delivery agent has no business on it, and lands on the delivery
 * portal instead. `permission: null` is left available for a genuinely
 * universal screen.
 */
export interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  exact?: boolean;
  permission: Permission | null;
}

export const NAV: NavItem[] = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard, exact: true, permission: "orders.view" },
  { href: "/admin/orders", label: "Orders", icon: ShoppingBag, permission: "orders.view" },
  { href: "/admin/delivery", label: "Delivery", icon: Truck, permission: "delivery.view" },
  // Under Delivery because it configures that screen: who parcels can go to.
  { href: "/admin/couriers", label: "Couriers", icon: PackageCheck, permission: "delivery.assign" },
  { href: "/admin/insights", label: "Insights", icon: TrendingUp, permission: "insights.view" },
  { href: "/admin/reports", label: "Profit & targets", icon: Calculator, permission: "reports.view" },
  { href: "/admin/users", label: "Users", icon: Users, permission: "users.view" },
  { href: "/admin/courses", label: "Courses", icon: BookOpen, permission: "courses.manage" },
  { href: "/admin/landing", label: "Landing page", icon: LayoutTemplate, permission: "landing.manage" },
  // Still /admin/promos — the route is where it always was, but the screen now
  // holds every checkout-time money setting, not only the discount codes.
  { href: "/admin/promos", label: "Checkout", icon: Tag, permission: "promos.manage" },
  { href: "/admin/referrals", label: "Referrals", icon: Gift, permission: "referrals.view" },
  { href: "/admin/staff", label: "Staff", icon: Shield, permission: "staff.manage" },
  // Reference, not configuration: nothing on this screen can be edited from
  // it. Sits next to Staff because it is the other thing you open to answer a
  // question rather than to do the day's work.
  { href: "/admin/crm", label: "WhatsApp CRM", icon: Inbox, permission: "crm.view" },
  { href: "/admin/templates", label: "Message templates", icon: MessageSquare, permission: "templates.view" },
  // Last on purpose: for an agent it's the only item, and for everyone else
  // it's the screen someone else works in, not part of the owner's daily run.
  { href: "/admin/delivery-portal", label: "Delivery portal", icon: ClipboardCheck, permission: "delivery.portal" },
];

/** The screens this person can open. Presentation only — the API routes enforce. */
export function visibleNav(holder: PermissionHolder): NavItem[] {
  return NAV.filter((n) => !n.permission || can(holder, n.permission));
}

/**
 * Is there anywhere to navigate to?
 *
 * A delivery agent has exactly one screen. A sidebar offering one choice is a
 * column of empty space next to the only thing they came to use — so below
 * two items there is no navigation to draw, and the screen takes the window.
 */
export function hasNavigation(holder: PermissionHolder): boolean {
  return visibleNav(holder).length > 1;
}

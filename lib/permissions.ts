/**
 * What someone is allowed to do in the admin panel.
 *
 * One flat list of capabilities, checked by name. Roles below are presets that
 * fill this list in — every actual check is against the permissions array, so
 * an account whose permissions were hand-tuned behaves exactly as the screen
 * showed, not as its role label suggests.
 *
 * The descriptions are the labels shown on the staff form, so a capability
 * can't be added without saying in plain words what it lets someone do.
 */
export const PERMISSIONS = {
  // The front page, and its own capability rather than a free extra with
  // `orders.view`. It is the takings screen — today's revenue, the month, the
  // charts — and somebody given the order list to look things up in was being
  // handed the shop's income along with it.
  "dashboard.view": "See the dashboard — revenue, order counts and charts",

  "orders.view": "See orders and the payment funnel",
  "orders.edit": "Change order details and status",
  // Split from orders.edit. Recording a sale that happened at the counter and
  // changing a sale that came through Razorpay are different jobs: this one
  // writes a new paid order and moves stock, and it is grantable to somebody
  // who is not allowed to re-status the order book.
  "orders.create": "Add a direct sale — counter, UPI, cash or bank transfer",
  "orders.export": "Download customer data as CSV/Excel",

  "delivery.view": "See the delivery queue",
  "delivery.print": "Print address labels",
  "delivery.assign": "Hand parcels to a delivery agent",
  "delivery.portal": "Use the delivery portal — tick off packing and delivery",
  // Deliberately split out of delivery.portal. Delivered approves the
  // referrer's commission and sends the customer a WhatsApp; returned voids
  // it. A partner login works the portal all day without ever being the thing
  // that settles our money — so packing and shipping are one capability and
  // finishing is another.
  "delivery.complete": "Mark parcels delivered or returned",

  // The parcel report at /admin/analytics. It used to answer to
  // `delivery.view`, which made it an invisible extra on the delivery queue —
  // grant somebody the queue and they also got every parcel's age, the courier
  // breakdown and the spreadsheet of the lot. Operational, not financial: it
  // counts parcels and days and never margin, which is why it is its own
  // capability rather than part of reports.view.
  "analytics.view": "See the parcel report — where every parcel is and how long it has been there",

  "users.view": "See customers",
  "users.manage": "Add customers and grant course access",

  "courses.manage": "Edit courses, modules and lessons",
  "landing.manage": "Edit the landing page and testimonials",
  "promos.manage": "Create and edit promo codes",

  // Deliberately not folded into insights.view or reports.view. This is the
  // one screen that answers "can we keep selling" — it shows how many books
  // exist, how many are already promised, and how many days are left. Someone
  // packing parcels needs that; the margin structure on /admin/reports is a
  // separate trust.
  "inventory.view": "See how many books are in stock",
  "inventory.manage": "Record print runs and stock corrections",

  "insights.view": "See sales figures and traffic sources",
  // Deliberately separate from insights.view. That screen shows what came in;
  // this one shows what it costs to earn, what each book actually makes, and
  // the salary line divided by the month's volume. Someone can be trusted with
  // revenue without being handed the margin structure.
  "reports.view": "See unit economics, profit and milestone projections",
  "expenses.view": "See what the business has spent and who it owes",
  "expenses.edit": "Record expenses and repay whoever funded them",
  "referrals.view": "See referrers and what they've earned",
  "referrals.payout": "Settle referral commissions",
  "staff.manage": "Add, edit and remove staff",

  // Read-only by design. The screen shows every message the shop can send —
  // automated, hand-sent and email — so support can check what a customer
  // actually received without being able to change the wording. Editing an
  // automated template means a Meta resubmission, which belongs in a commit.
  "templates.view": "Read the message templates — WhatsApp, manual and email",

  // ── CRM ──
  // Split four ways because the consequences are four different sizes. Reading
  // a conversation is nothing; clearing somebody's stop flag undoes a thing
  // they explicitly asked for; a campaign messages hundreds of people at once
  // and is the only action here that can cost the number its rating.
  "crm.view": "Read the WhatsApp inbox, contacts and message log",
  "crm.reply": "Reply to a customer on WhatsApp",
  "crm.consent": "Set or clear a contact's stop flag",
  "crm.campaign": "Create and run bulk campaigns, and use the kill switch",
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export function isPermission(v: string): v is Permission {
  return v in PERMISSIONS;
}

/** Grouping for the staff form — flat checkboxes for twelve items is a wall. */
export const PERMISSION_GROUPS: { label: string; permissions: Permission[] }[] = [
  { label: "Orders", permissions: ["orders.view", "orders.edit", "orders.create", "orders.export"] },
  { label: "Delivery", permissions: ["delivery.view", "delivery.print", "delivery.assign", "delivery.portal", "delivery.complete", "analytics.view"] },
  { label: "Customers", permissions: ["users.view", "users.manage"] },
  { label: "Content", permissions: ["courses.manage", "landing.manage", "promos.manage"] },
  { label: "Stock", permissions: ["inventory.view", "inventory.manage"] },
  { label: "Business", permissions: ["dashboard.view", "insights.view", "reports.view", "expenses.view", "expenses.edit", "referrals.view", "referrals.payout", "staff.manage"] },
  { label: "Reference", permissions: ["templates.view"] },
  { label: "WhatsApp CRM", permissions: ["crm.view", "crm.reply", "crm.consent", "crm.campaign"] },
];

// ── Roles ───────────────────────────────────────────────────────────────────

export type StaffRole = "owner" | "manager" | "delivery" | "support";

export const STAFF_ROLES: StaffRole[] = ["owner", "manager", "delivery", "support"];

export const ROLE_LABELS: Record<StaffRole, string> = {
  owner: "Owner",
  manager: "Manager",
  delivery: "Delivery agent",
  support: "Support",
};

export const ROLE_DESCRIPTIONS: Record<StaffRole, string> = {
  owner: "Full access, including staff management. Cannot be switched off.",
  manager: "Runs the shop day to day — everything except staff management.",
  delivery: "A courier partner's login. Sees only their own courier's parcels — copy addresses, hand over, tick off packing and shipping. No customer list, no revenue, no marking delivered.",
  support: "Read-mostly: can look things up, but not change or download them.",
};

export const ROLE_BADGE: Record<StaffRole, string> = {
  owner: "bg-purple-50 text-purple-700 border-purple-200",
  manager: "bg-blue-50 text-blue-700 border-blue-200",
  delivery: "bg-green-50 text-green-700 border-green-200",
  support: "bg-neutral-100 text-neutral-600 border-neutral-200",
};

/**
 * Starting permissions for each role.
 *
 * The delivery preset is the reason this feature exists: an agent needs to
 * work their own screen and nothing else. No customer list to export, no
 * revenue figures, no way to change prices.
 *
 * It is `delivery.portal` alone — deliberately not the master queue at
 * /admin/delivery, which is the owner's view of every agent's parcels, with
 * label printing and the assignment that decides whose portal they land in.
 */
export const ROLE_PRESETS: Record<StaffRole, Permission[]> = {
  // Owner short-circuits every check (see `can` below), so listing
  // permissions here would be a second source of truth to keep in sync.
  owner: [],

  manager: [
    "dashboard.view",
    "orders.view", "orders.edit", "orders.create", "orders.export",
    "delivery.view", "delivery.print", "delivery.assign", "delivery.portal",
    "delivery.complete", "analytics.view",
    "users.view", "users.manage",
    "courses.manage", "landing.manage", "promos.manage",
    "inventory.view", "inventory.manage",
    "insights.view", "reports.view", "expenses.view", "expenses.edit", "referrals.view",
    "templates.view",
    // Not crm.campaign: bulk sending stays with the owner until enough
    // campaigns have run to know what the opt-out rate looks like.
    "crm.view", "crm.reply", "crm.consent",
  ],

  // Not delivery.complete: a partner ships and hands over, and the parcel is
  // marked delivered by a courier scan or by us. Grantable per account if one
  // partner is ever trusted with it — which is the reason it is a permission
  // and not a role test.
  delivery: ["delivery.portal"],

  support: [
    "orders.view", "users.view", "delivery.view", "templates.view",
    // Support answer customers; they do not decide who may be messaged.
    "crm.view", "crm.reply",
  ],
};

// ── Checking ────────────────────────────────────────────────────────────────

export interface PermissionHolder {
  role: StaffRole;
  permissions: string[];
}

/**
 * The single place a permission decision is made.
 *
 * Owner is unconditional: there must always be someone who can restore access
 * after a bad permission edit, or the panel can be locked shut permanently.
 */
export function can(
  holder: PermissionHolder | null | undefined,
  permission: Permission
): boolean {
  if (!holder) return false;
  if (holder.role === "owner") return true;
  return holder.permissions.includes(permission);
}

/** Does this person have any reason to be in the panel at all? */
export function canAny(
  holder: PermissionHolder | null | undefined,
  permissions: Permission[]
): boolean {
  return permissions.some((p) => can(holder, p));
}

/** Where to send someone after login — the first screen they can actually use. */
export function landingPage(holder: PermissionHolder): string {
  if (can(holder, "orders.view")) return "/admin/orders";
  if (can(holder, "delivery.portal")) return "/admin/delivery-portal";
  if (can(holder, "delivery.view")) return "/admin/delivery";
  if (can(holder, "insights.view")) return "/admin/insights";
  if (can(holder, "reports.view")) return "/admin/reports";
  if (can(holder, "referrals.view")) return "/admin/referrals";
  if (can(holder, "users.view")) return "/admin/users";
  if (can(holder, "courses.manage")) return "/admin/courses";
  if (can(holder, "landing.manage")) return "/admin/landing";
  return "/admin/no-access";
}

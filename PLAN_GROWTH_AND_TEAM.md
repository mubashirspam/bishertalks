# Plan — Attribution, Staff Roles, Referral Program

Three features. They touch the same two places (the order row, the admin
panel), so the order they're built in matters more than usual.

**Recommended order: Attribution → Staff roles → Referral.**

- **Attribution first** because it's the smallest (≈2 days) and it builds the
  "where did this visitor come from" plumbing — cookie, capture, normalisation
  — that the referral program then reuses for free. A referral link is just
  another traffic source with a code attached.
- **Staff roles second** because it's the blocker on hiring: right now there is
  exactly one login (`ADMIN_EMAIL`), so a delivery agent would need the owner's
  password. Everything else can wait; that can't.
- **Referral last** because it's the biggest surface (customer-facing pages,
  commission ledger, payouts) and it wants both of the above: attribution to
  track the click, staff permissions to decide who can approve a payout.

Each feature ships independently. Nothing here needs a new dependency.

---

# A. Purchase attribution — "where did this order come from?"

**Goal:** every order says whether it came from Instagram, Facebook, WhatsApp,
YouTube, Google, a referral, or direct — with date-wise breakdowns in admin, so
you know which channel to put effort into.

### The hard part (worth knowing before designing)

The `Referer` header is unreliable exactly where you need it most. Instagram
and Facebook open links in an in-app browser that often strips or rewrites the
referrer; WhatsApp sends none at all. **You cannot detect these reliably by
sniffing.** The only dependable signal is a tagged link you control.

So the design is two-layer:

1. **Tagged links (primary).** `?utm_source=instagram&utm_campaign=bio_link`.
   Accurate, but only if the team actually uses the tagged URL everywhere.
   That's a discipline problem, so the plan includes a **link builder in admin**
   that generates the tagged URL to copy-paste — nobody hand-writes UTMs.
2. **Referrer sniffing (fallback).** Maps `instagram.com` → `instagram`,
   `l.facebook.com` → `facebook`, `google.*` → `google`, etc. Catches what the
   tags miss. Anything unknown becomes `direct`, honestly labelled.

### Capture

Extend `proxy.ts` (the existing middleware) to match public routes as well as
`/admin`. On any page load carrying UTM params or an external referrer, it
writes two cookies:

- `attr_first` — set once, 90-day life. Never overwritten. This is who
  *introduced* the customer — the number an influencer should be paid on.
- `attr_last` — overwritten every visit. This is what *closed* the sale.

Doing it in middleware rather than a client component means it works before
hydration, needs no JS, and can't be missed by a page that forgot to include
the tracker.

### Storage

New columns on `orders` (migration `0006_attribution.sql`):

| Column | Purpose |
|---|---|
| `source` | Normalised last-touch channel: `instagram`, `facebook`, `whatsapp`, `youtube`, `google`, `referral`, `direct`, `other` |
| `first_source` | Same vocabulary, first touch |
| `utm_source`, `utm_medium`, `utm_campaign`, `utm_content` | Raw tags, for campaign-level detail |
| `referrer_url` | Raw `Referer`, for debugging odd traffic |
| `landing_path` | First page they hit — tells you if the ad points at the right page |

Written at the **lead-capture** step (`/api/leads`), which already creates the
order row the moment a phone number is typed — so attribution survives even if
they never pay. Also written by `/api/orders/create` as a backstop for the
Magic Checkout path.

### New files

- `lib/attribution.ts` — the vocabulary, the normaliser (`utm + referrer →
  source`), cookie read/write helpers. One place, so the middleware, the API
  routes and the admin all agree on what "instagram" means.
- `app/admin/(protected)/insights/page.tsx` — breakdown by source: orders,
  revenue, conversion (leads → paid) per channel, over the date range the rest
  of the admin already uses. Reuses the existing IST date filter.
- `app/admin/(protected)/insights/LinkBuilder.tsx` — pick a channel and a
  campaign name, get a copy-ready tagged URL.

### Changed files

- `proxy.ts` — matcher extended to `/`, `/neuro-code/:path*`, `/courses/:path*`;
  cookie writing.
- `app/api/leads/route.ts`, `app/api/orders/create/route.ts` — persist attribution.
- `lib/db/orders-query.ts` + export route — `source` becomes a filter and a
  CSV/Excel column.
- Orders table — a small source badge per row.

**Effort: ~2 days.** No customer-visible change.

---

# B. Staff roles and permissions

**Goal:** more than one login; a delivery agent who can only see the delivery
queue; the ability to switch someone off instantly.

### Current state

Authentication is Supabase Auth (email + password). Authorisation is one line —
`user.email === process.env.ADMIN_EMAIL` — repeated in three places:
`proxy.ts`, `app/admin/(protected)/layout.tsx`, `lib/admin-auth.ts`. There is no
concept of a second person.

### Model

A `staff` table keyed to the Supabase auth user:

```
staff
  id, auth_user_id (FK to auth.users), email, name, phone,
  role         'owner' | 'manager' | 'delivery' | 'support'
  permissions  TEXT[]          -- the actual source of truth
  is_active    BOOLEAN         -- the on/off switch
  created_at, created_by
```

**Roles are presets, permissions are the truth.** Picking "Delivery agent"
fills in the standard permission set; the owner can then tick or untick
individual capabilities for that person. This is what makes it "manageable"
without inventing a permission-group system nobody will maintain.

Capabilities are a fixed list in `lib/permissions.ts` — readable, greppable,
type-checked:

```
orders.view      orders.edit      orders.export
delivery.view    delivery.print   delivery.status
users.view       users.manage     courses.manage
promos.manage    referrals.view   referrals.payout
insights.view    staff.manage
```

Defaults per role:

| Role | Gets |
|---|---|
| **Owner** | everything, including `staff.manage`. Cannot be disabled or demoted by anyone else. |
| **Manager** | everything except `staff.manage` and `referrals.payout` |
| **Delivery agent** | `delivery.view`, `delivery.print`, `delivery.status` — nothing else. No customer list, no revenue, no exports. |
| **Support** | `orders.view`, `users.view`, `delivery.view` — read-mostly |

### Enforcement — three layers, and only one of them is real

1. **Middleware (`proxy.ts`)** — is there a session, is the staff row active.
   Cheap gate, redirects to login.
2. **Admin layout** — loads the staff record once per page render, hides nav
   items the person can't use, and 404s a route they shouldn't reach. This is
   UX, not security.
3. **Every API route** — `requirePermission('delivery.status')`. **This is the
   real enforcement.** A hidden button is not a permission; a delivery agent
   who opens devtools must still get a 403 from `/api/admin/delivery/bulk`.

`lib/admin-auth.ts` grows from `isAdmin()` to `getStaff()` /
`requirePermission()`. `isAdmin()` stays as a thin wrapper so nothing breaks
mid-migration.

**Safety valve:** `ADMIN_EMAIL` continues to work as an implicit owner even
with no `staff` row. Without that, one bad permission edit locks everyone out
of the panel permanently.

### Creating staff

Admin screen at `/admin/staff`: name, email, phone, role, permission
checkboxes, active toggle. Creating a member calls the Supabase Admin API
server-side to create the auth user with a generated temporary password, shown
once to the owner to pass on (WhatsApp). No email infrastructure needed. A
"reset password" button regenerates it.

Disabling someone flips `is_active`; the next request they make bounces them to
login, because the check is a live DB read rather than a claim baked into their
token.

### Audit trail

Once more than one person can change an order, "who marked this delivered" has
to be answerable. A small `audit_log` table — `actor_id`, `action`, `entity`,
`entity_id`, `meta`, `created_at` — written from the delivery bulk route and
the order update route. Surfaced as a "History" strip on the order detail page.

### New / changed files

- Migration `0007_staff.sql` — `staff`, `audit_log`, indexes.
- `lib/permissions.ts` (capability list, role presets), `lib/db/staff.ts`,
  `lib/audit.ts`.
- `lib/admin-auth.ts`, `proxy.ts`, admin layout + sidebar — permission-aware.
- Every `/api/admin/*` route — swap `isAdmin()` for `requirePermission(...)`.
- `app/admin/(protected)/staff/` — list, create, edit.

**Effort: ~4 days**, most of it in touching every existing admin route.

### Phase 2 (not now)

Assigning specific orders to specific delivery agents (`assigned_staff_id` on
`orders`, agent sees only their own). Worth doing when there's more than one
agent; pointless before that.

---

# C. Referral program

**Goal:** customers and influencers share a link; when someone buys through it,
the referrer earns something and you can see and pay what's owed.

### Model

```
referrers
  id, code (unique, uppercase), name, phone, upi_id,
  type            'customer' | 'affiliate' | 'staff'
  commission_type 'percent' | 'flat'
  commission_value
  is_active, notes, created_at
```

Two kinds of referrer, one table:

- **Customer referrers** — auto-created after a paid order. Everyone who buys
  gets a code. Zero admin work.
- **Affiliates** — created by hand in admin for influencers, with a higher
  commission rate negotiated per person.

### The link and the attribution

`bishertalks.com/neuro-code?ref=PRIYA20` — handled by the **same middleware
from Feature A**. It sets `source = 'referral'` plus a `ref` cookie (90 days,
first-touch wins, so the person who introduced the customer gets paid even if
they buy a week later). This is why attribution is built first: the referral
link needs no new capture code at all.

### Commission lifecycle

New columns on `orders`: `referral_code`, `referrer_id`,
`referral_commission_paise`, `referral_status`.

```
pending  → order paid, commission calculated and locked in
approved → order delivered (or 7 days past delivery, configurable)
paid     → included in a payout batch
void     → order cancelled or refunded
```

**Commission is only approved after delivery**, not after payment. Paying on
payment means paying on parcels that come back. This is the single most
important rule in the design, and the delivery data from the last feature is
what makes it possible.

Guards: a referrer can't use their own code (phone match); the code is
re-validated server-side at order creation, never trusted from the browser; the
commission amount is snapshotted onto the order so changing a referrer's rate
later doesn't rewrite history.

### Reward to the buyer

The person *using* the code can also get a discount — and the promo engine
already does exactly this (`promo_codes`, percent or flat, validated
server-side in `lib/db/promo.ts`).

**Recommendation: keep them separate but let a referral grant a discount.**
When a `ref` code is present, the checkout applies a fixed program-wide
referee discount (one setting, not one promo row per referrer). Reusing
`promo_codes` per referrer would mean a row per customer and a `used_count`
that fights with the referral ledger.

### Payouts

`/admin/referrals` — table of referrers with clicks, orders, conversion,
earned, unpaid. Tick a set of approved commissions → "Mark paid" → creates a
`referral_payouts` row (`referrer_id`, `amount_paise`, `paid_at`, `reference`,
`note`) and flips those orders to `paid`. Gated behind `referrals.payout`, so
a manager can see the numbers without being able to settle them.

Payment itself is manual UPI — an automated payout integration is a much
bigger regulatory surface and not worth it at this volume.

### Customer-facing

- Thank-you page and the order tracking page show **"Your referral code"** with
  a one-tap WhatsApp share button — pre-written message, book link, code. This
  is where nearly all sharing will happen; the WhatsApp share is the feature,
  not the dashboard.
- `/refer/[code]` — a light landing page ("Priya recommended Neuro Code to
  you") that sets the cookie and forwards to `/neuro-code`. Better share
  preview and it makes the referral feel personal.
- A referrer status page keyed by phone + OTP is **Phase 2**. Most referrers
  will ask on WhatsApp long before they'd log in to check.

### New / changed files

- Migration `0008_referrals.sql` — `referrers`, `referral_payouts`, order
  columns, click counter.
- `lib/db/referrals.ts` (code generation, validation, commission calc,
  lifecycle), `lib/referral-code.ts`.
- `app/refer/[code]/route.ts` — cookie + redirect.
- `app/api/orders/create` + webhook — attach and lock the commission.
- Delivery status change → approve commissions (hooks into
  `setDeliveryStatus`, already written).
- `app/admin/(protected)/referrals/` — list, detail, payout.
- Thank-you / track pages — share block.

**Effort: ~4–5 days.**

---

## Cross-cutting

- **Migrations 0006 → 0008**, in order, each self-contained and re-runnable,
  same convention as the existing five. All additive — no destructive changes
  to live order data.
- **Everything date-filtered** through the existing IST helpers in
  `lib/format-date.ts`. No new date logic.
- **Every new list** reuses the query-builder pattern (`buildOrdersQuery`,
  `buildDeliveryQuery`) so screen and export can't disagree.
- **Total: ~10–11 working days** for all three, built in the order above.

---

## Decisions — settled 8 Aug 2026

1. **Referrer earns cash commission**, paid manually via UPI in batches. The
   `referral_payouts` ledger described above is in scope.
2. **Every buyer gets a code automatically** once their order is paid, shown on
   the thank-you and tracking pages with a one-tap WhatsApp share. Affiliates
   are still created by hand on top of that, with their own negotiated rate.
3. **The buyer gets a fixed discount** for using a code — the referrer is doing
   their friend a favour as well as earning, which is what actually drives
   sharing.

### Follow-on: the numbers are settings, not code

The three amounts this implies — default customer commission, affiliate
commission, and referee discount — go in an admin-editable settings row, not
constants. They will be tuned against real margin in the first month, and a
code deploy per adjustment is the wrong shape.

Defaults to launch with, changeable from day one in
`/admin/referrals → Settings`:

| Setting | Default | Note |
|---|---|---|
| Customer commission | ₹75 / delivered order | ~11% of a ₹699 sale |
| Affiliate commission | 15% | Set per affiliate; this is just the default when creating one |
| Referee discount | ₹50 off | Stacks with nothing — a referral code and a promo code are mutually exclusive at checkout |

**Margin check before launch:** at ₹699 with a ₹75 commission and ₹50 discount,
a referred sale nets ₹574 before print, shipping and payment fees. Worth
confirming that's still positive against your unit cost — if it's tight, drop
the referee discount to ₹25 rather than cutting the commission, since the
commission is what creates the sharing.

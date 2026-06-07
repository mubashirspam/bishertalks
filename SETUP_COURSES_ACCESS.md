# Production Setup — Users, Orders & Course Access

This adds a production-grade flow on top of the existing Supabase + Razorpay
setup: users keyed by mobile number, course locking, and admin-managed access.

No new environment variables are required. Cookie signing reuses
`INTERNAL_API_SECRET` (falls back to `SUPABASE_SERVICE_ROLE_KEY`).

## 1. Run the database migration (once)

In **Supabase Dashboard → SQL Editor**, run:

1. `supabase/schema.sql` — only if the `orders` table doesn't exist yet.
2. `supabase/migrations/0001_users_courses_access.sql` — adds `users`,
   `courses`, `modules`, `lessons`, `course_access`, links `orders.user_id`,
   and tightens RLS. Safe to re-run.
3. `supabase/migrations/0002_pricing_promo.sql` — adds course `price` /
   `offer_price`, a `promo_codes` table, and order `promo_code` /
   `discount_paise`. Safe to re-run.

## 2. Seed course content into the DB (once, then whenever code changes)

Course material lives in the database. The source of truth for seeding is
`lib/courses-data.ts`.

1. Log in to the admin panel at `/admin/login`.
2. Go to **Admin → Courses**.
3. Click **Re-seed from code**. This upserts every course and replaces its
   modules + lessons from `lib/courses-data.ts`.

(Equivalent API: `POST /api/admin/seed-courses`, admin-authenticated.)

Re-seeding **preserves** admin-edited thumbnail and pricing — it only refreshes
titles, modules, and lessons from code.

## 3. Set pricing, thumbnails & promo codes (in the admin panel)

Everything below is managed from the **light-themed** admin panel; no code edits.

- **Admin → Courses → Edit** — paste a **thumbnail image URL**, set **Price**
  and an optional **Offer price**. The whole site (course cards, the locked-course
  gate, and the **checkout total**) reads these from the DB. The book/checkout
  amount comes from the bonus course's offer price (or price); it falls back to
  `BOOK_PRICE_PAISE` (default ₹499) until a price is set.
- **Admin → Promos** — create discount codes (**% off** or **₹ flat**), with an
  optional expiry and usage limit. Buyers enter a code on the checkout page; the
  discount is re-validated and atomically redeemed server-side at order time and
  recorded on the order.

## How it works

### Buying the book
- Checkout collects mobile number + address (unchanged UI).
- `POST /api/orders/create` upserts a **user** by phone and links the order.
- On payment **paid** (`/api/orders/verify` and the Razorpay webhook), the buyer
  is auto-granted access to the NLP course (`granted_via = 'purchase'`).

### Viewing a locked course (no user login)
- `/courses/[slug]` is gated. Visitors see a preview + an **unlock** form.
- They enter their mobile number → `POST /api/courses/access` checks the DB.
  - If approved, a **signed, httpOnly cookie** (30 days) remembers the number.
  - Access is re-checked against the DB on every load, so **revoke is instant**.
- The number used must either have **purchased the book** or been **approved by
  an admin**.

### Admin panel
- **Orders** — existing.
- **Users** — list/search by mobile; **Add User** (with optional "approve NLP
  access" in the same step).
- **User detail** — see their orders and **Grant / Revoke** access per course.
- **Courses** — DB course overview + **Re-seed from code**.

## Notes
- The bonus course slug is `nlp` (`BOOK_BONUS_COURSE_SLUG` in `lib/types/db.ts`).
- All app DB access uses the Supabase **service role** server-side; RLS denies
  the public/anon key direct access to these tables.
- The previous permissive "public read" policy on `orders` (which exposed all
  order PII to the anon key) is dropped by the migration; order lookups already
  go through server routes using the service role.

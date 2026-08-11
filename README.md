# BisherTalks

Marketing site, book store and course platform for Bisher KC.

Next.js 16 (App Router) · TypeScript · Tailwind · Supabase (Postgres) ·
Razorpay · WhatsApp via Make.com

## Docs

| | |
|---|---|
| **[PENDING.md](./PENDING.md)** | **Everything outstanding — start here** |
| [MAGIC_CHECKOUT.md](./MAGIC_CHECKOUT.md) | Razorpay Magic Checkout cutover runbook |
| [MAKE_WHATSAPP.md](./MAKE_WHATSAPP.md) | Make.com scenario setup + message templates |

## Getting started

```bash
npm install
cp .env.example .env.local   # then fill in the values
npm run check-env            # verifies config and Razorpay credentials
npm run dev
```

## Commands

| | |
|---|---|
| `npm run dev` | dev server |
| `npm run build` / `npm start` | production build |
| `npm run check-env` | preflight: env vars + live Razorpay credential check |
| `npm run check-env -- --vercel` | same, judged as production values |
| `npm run test-make -- --phone=<phone>` | post a sample event to the Make scenario |

## How it works

**Store.** A customer buys the book through Razorpay. `/api/orders/create`
prices the order server-side from the database — the amount is never taken from
the browser. Payment is confirmed by two independent paths:

- `/api/orders/verify` — the browser handler, fast but only fires if the tab
  survives
- `/api/webhook/razorpay` — server-to-server, and the **source of truth**

Both claim the `pending → paid` transition atomically, so whichever arrives
first does the one-time work (promo redemption, WhatsApp) and the other skips
it. That's what protects a customer whose connection drops after paying.

**Courses.** Access is keyed to a **mobile number**, not a login. A signed
HMAC cookie remembers a verified phone, and access is re-checked against the
database on every page load so an admin revoke takes effect immediately.
Purchasing the book grants the bonus NLP course automatically.

**Checkout mode.** `NEXT_PUBLIC_MAGIC_CHECKOUT` switches between Standard
Checkout (own address form) and Razorpay Magic Checkout (Razorpay collects the
address, we backfill it after payment). Default `false` — see
[MAGIC_CHECKOUT.md](./MAGIC_CHECKOUT.md) before flipping it.

## Layout

```
app/
  api/            orders, webhook, shipping-info, admin, notify
  admin/          protected admin panel (orders, courses, users, promos)
  courses/        course listing + phone-gated player
  neuro-code/     book landing, checkout, thank-you, tracking
lib/
  db/             all database access, one module per concern
  razorpay.ts     client + Magic Checkout customer-details fetch
  make.ts         posts events to the Make.com WhatsApp scenario
  notify.ts       builds those events; owns idempotency
supabase/
  migrations/     source of truth for schema — apply in order
scripts/          check-env, test-make, seed generation
```

## Database

`supabase/migrations/` is authoritative; apply in numeric order via the
Supabase SQL editor. Applied through `0003`.

Catalogue reads are cached and tagged, and every admin mutation flushes the tag
from inside the DB layer (`lib/db/cache-tags.ts`) rather than from the routes —
so a new admin route can't forget to invalidate.

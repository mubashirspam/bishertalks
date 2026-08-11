# WhatsApp via Make.com — integration plan

**Status: implemented.** Phases 1–3 (code side) are done and building; the
Make.com scenario itself is not yet built — the operator procedure for that is
[MAKE_WHATSAPP.md](./MAKE_WHATSAPP.md), which supersedes this document for
day-to-day use. Kept for the design rationale and for the Phase 4–5 work in §7
that is still outstanding.

**Goal:** delete the direct Meta Cloud API integration and replace it with a
single outbound webhook to a Make.com scenario that owns all WhatsApp sending.

---

## 0. Read this first — what Make.com does and does not remove

Make.com's **WhatsApp Business Cloud** app is a thin wrapper over the same Meta
Graph API `lib/whatsapp.ts` calls today. If you connect *that* app, you still
need: a verified Meta Business, a WABA, a registered phone number, a permanent
token, and **Meta-approved templates**. Make would then only be moving where the
HTTP call is made from — a real but modest win.

The setup only becomes genuinely simpler if the Make scenario sends through a
**BSP that supplies its own number and template management** — WATI, AiSensy,
360dialog, Twilio, Interakt. Those have Make apps too, cost money per
month/conversation, but hand you a working number without the Meta Business
verification dance.

**This plan is deliberately provider-agnostic.** Our app emits a *semantic
event* ("this order shipped, here is everything about it"); the Make scenario
decides which app, which template, and what the copy says. Changing from Meta
Cloud → WATI later is then a change inside Make with **zero code deploys**.

Decide the provider before Phase 3 (§7). Everything in Phases 1–2 is identical
either way.

### What we gain

| Today | After |
|---|---|
| Message copy is hardcoded in `lib/notify.ts`, changing it needs a deploy | Copy lives in Make, editable by a non-developer |
| Positional `parameters: string[]` — silently breaks if a template variable is reordered in Meta | Named fields; Make maps them visibly |
| No retry — a Meta 500 loses the message forever | Make retries + "incomplete executions" queue |
| No record that a message was sent | `notification_log` table + delivery callback |
| No visibility — only Vercel logs, `console.error` | Make execution history, per-run, with the payload |
| Adding a new message = code change | Add a route in the scenario |
| Two env vars that are still placeholders | Two env vars, but the credential lives in Make |

### What we lose / accept

- One more third-party in the path (Make outage = no WhatsApp; payments and
  course access are unaffected, exactly as today).
- Make operations quota (see §8 for the arithmetic).
- The webhook URL is a bearer secret — anyone with it can trigger sends. We add
  a shared-secret header on top (§5.3).

---

## 1. Current state — full inventory

Everything that must be touched, found by tracing `sendWhatsApp` outwards.

### Files that will be deleted or rewritten

| File | Fate |
|---|---|
| `lib/whatsapp.ts` | **Delete.** The only Meta Graph caller. |
| `lib/notify.ts` | **Rewrite.** Keeps its exported API; builds Make payloads instead of template params. |
| `app/api/whatsapp/send/route.ts` | **Move** → `app/api/notify/send/route.ts`. |
| `scripts/test-whatsapp.mjs` | **Replace** → `scripts/test-make.mjs`. |
| `WHATSAPP_SETUP.md` | **Replace** → `MAKE_WHATSAPP.md` (operator runbook). |

### Files that need edits

| File | Line(s) | What |
|---|---|---|
| `app/api/orders/verify/route.ts` | 130–140 | Self-`fetch` to `/api/whatsapp/send` → direct call |
| `lib/payment-claim.ts` | 82–93 | Same |
| `app/api/orders/address/route.ts` | 76–87 | Same |
| `lib/db/delivery.ts` | 74–91 | `notifyStatusChange` → one batched Make call |
| `lib/db/access.ts` | 74–79 | Caller of `notifyCourseAccess` — unchanged if the signature holds |
| `scripts/check-env.mjs` | ~135–142 | WhatsApp block → Make block |
| `.env.example` | 34–36 | Swap the two vars |
| `package.json` | `test-whatsapp` script | Rename to `test-make` |
| `README.md`, `PENDING.md` | grep `WHATSAPP_` | Update references |

### Files that must NOT be touched

- **`lib/wa-message.ts`** — this builds `wa.me` deep links for an *admin
  clicking a button* to open a chat manually. It is not automated sending and
  has nothing to do with Meta or Make. Leave it exactly as is.
- `NEXT_PUBLIC_SUPPORT_WHATSAPP` — a display number on the thank-you page.
- Admin UI (`orders/`, `delivery/`) beyond what §4.6 adds.

### The five events currently sent

| Event | Fired from | Currently |
|---|---|---|
| `payment_received` | `/api/orders/verify`, `claimPaidTransition` | 4 params + increments `address_reminders_sent` |
| `confirmed` | `/api/orders/address`, and the paid paths when an address already exists | 6 params |
| `shipped` | admin bulk status change | 6 params |
| `delivered` | admin bulk status change | 3 params |
| `course_access` | any single course grant (`lib/db/access.ts`) | 4 params |

Bulk CSV import deliberately does **not** send. That stays true.

---

## 2. Target architecture

```
                         ┌──────────────────────────────────────────┐
  Razorpay webhook ──┐   │  Next.js (Vercel)                        │
  /api/orders/verify ├──▶│  claimPaidTransition / address / delivery│
  admin status change┘   │                 │                        │
                         │                 ▼                        │
                         │        lib/notify.ts                     │
                         │   builds a semantic event payload        │
                         │                 │                        │
                         │                 ▼                        │
                         │        lib/make.ts  ──POST──────────────┐│
                         └─────────────────────────────────────────┼┘
                                                                   │
                        ┌──────────────────────────────────────────▼──────────┐
                        │  Make.com scenario: "BisherTalks — WhatsApp"        │
                        │  1 Webhook (custom)                                 │
                        │  2 Secret filter                                    │
                        │  3 Data store dedupe on event_id                    │
                        │  4 Router → one route per event                     │
                        │  5 WhatsApp module (Meta Cloud / WATI / 360dialog)  │
                        │  6 HTTP callback → /api/notify/callback             │
                        │  7 Error handler → break (retry queue)              │
                        └──────────────────────────────────────────┬──────────┘
                                                                   │
                        ┌──────────────────────────────────────────▼──────────┐
                        │ POST /api/notify/callback → notification_log        │
                        │ status: sent | failed, provider_message_id, error   │
                        └─────────────────────────────────────────────────────┘
```

**Design rules**

1. **The app never knows what the message says.** It sends facts. Make writes
   sentences. This is the whole point — no deploy to fix a typo.
2. **Sending never throws and never blocks.** Same guarantee as today: a
   notification failure must not undo a payment or a course grant.
3. **One event = one HTTP call = one Make execution.** Bulk actions send one
   call with an array (§4.5), so fifty parcels is one execution, not fifty.
4. **Every event carries an `event_id`.** Make dedupes on it, so a Razorpay
   webhook retry racing `/api/orders/verify` can never double-message.
5. **Payload is versioned.** `"version": 1`. A breaking payload change bumps it
   and Make routes on it, so an old deploy mid-rollout still works.

---

## 3. The payload contract

This is the interface between the two systems — get it right and everything
else is mechanical.

### 3.1 Transport

```
POST  $MAKE_WEBHOOK_URL
Content-Type:      application/json
X-Bisher-Secret:   $MAKE_WEBHOOK_SECRET        # constant-time compared in Make
X-Bisher-Event:    order.shipped               # for Make's filter, cheap
X-Bisher-Delivery: <uuid v4>                   # per-attempt, for tracing
```

### 3.2 Single event

```jsonc
{
  "version": 1,
  "event": "order.shipped",
  "event_id": "ORD-7YK955:order.shipped",   // idempotency key — see §3.4
  "sent_at": "2026-08-11T09:14:22.031Z",
  "env": "production",                       // "development" for local — Make routes test traffic away

  "customer": {
    "name": "Bisher",                        // null-safe: never null, falls back to "there"
    "phone": "+919876543210",                // E.164, always
    "phone_digits": "9876543210",            // 10-digit, for providers that want it bare
    "email": "b@example.com"                 // may be null
  },

  "order": {
    "number": "ORD-7YK955",
    "amount": 599,                           // rupees, already rounded — Make must not do maths
    "amount_paise": 59900,
    "currency": "INR",
    "status": "shipped",
    "payment_status": "paid",
    "product": "Neuro Code",
    "address": {
      "line1": "12 MG Road", "line2": null,
      "city": "Kochi", "district": "Ernakulam",
      "state": "Kerala", "pincode": "682001",
      "short": "Kochi, Kerala"               // pre-joined; Make should never concatenate
    },
    "courier": "BlueDart",                   // null until shipped
    "tracking_number": "1234567890",         // null until shipped
    "expected_delivery": "12 Aug 2026",      // pre-formatted en-IN, or "3–5 business days"
    "payment_link_url": null                 // set for recovery events
  },

  "links": {
    "address": "https://bishertalks.com/neuro-code/address?id=ORD-7YK955&t=…",
    "tracking": "https://bishertalks.com/neuro-code/track?id=ORD-7YK955",
    "site": "https://bishertalks.com/neuro-code",
    "course": "https://bishertalks.com/courses/nlp"
  },

  "course": {                                // only on course.access
    "title": "Neuro Linguistic Programming",
    "slug": "nlp",
    "url": "https://bishertalks.com/courses/nlp",
    "login_phone": "9876543210"
  }
}
```

**Every key is always present** — nulls rather than omissions. Make's mapping
breaks on missing keys, not on null ones, and a scenario that half-works is
worse than one that visibly fails.

### 3.3 Event names

Renamed from the current internal names to a dotted namespace, because the
scenario router reads much better and there's room to grow.

| New name | Old | Trigger |
|---|---|---|
| `payment.received` | `payment_received` | Paid, no address yet — **the critical one** |
| `order.confirmed` | `confirmed` | Address submitted on a paid order |
| `order.shipped` | `shipped` | Admin marks shipped |
| `order.delivered` | `delivered` | Admin marks delivered |
| `course.access` | `course_access` | Any single course grant |

**New events unlocked by this migration** (Phase 4, §7 — each is now just a new
router branch plus a caller, not a Meta template approval):

| Name | Trigger | Why |
|---|---|---|
| `payment.link_sent` | Admin generates a payment link (`0013_payment_links.sql`) | Today the admin copies the link and pastes it into WhatsApp by hand |
| `address.reminder` | Cron over paid orders with no address, `address_reminders_sent < 3` | The single highest-value automation you don't have; the column already exists |
| `checkout.abandoned` | Cron over `payment_started` leads older than 1h | `lib/order-stage.ts` already computes this stage |
| `order.out_for_delivery` | Admin marks out-for-delivery | Already a status; not currently notified |

### 3.4 Idempotency

`event_id = "<order_number>:<event>"`, plus `:<n>` where repeats are legitimate
(`ORD-7YK955:address.reminder:2`).

Two layers, because either alone has a hole:

- **App side** — `notification_log` has a unique index on `event_id`. Insert
  first, send only if the insert won. This kills the verify-vs-webhook race at
  the source, the same way `claimPaidTransition`'s `.neq("paid")` does.
- **Make side** — a Data Store keyed on `event_id` with a 7-day TTL, checked
  before the WhatsApp module. Catches anything that gets past the app (a manual
  admin re-send, a Make retry after a partial failure).

---

## 4. Code changes, file by file

### 4.1 New — `lib/make.ts`

Replaces `lib/whatsapp.ts`. One job: post JSON to Make, never throw.

```ts
/**
 * Outbound events to the Make.com scenario that owns all WhatsApp sending.
 *
 * Plain fetch, no SDK — same reasoning as lib/email.ts: one endpoint, one JSON
 * body, not worth a dependency in the serverless bundle.
 *
 * Nothing here throws. A notification is a courtesy on top of a payment that
 * already succeeded; a Make outage must never turn a confirmed order into a
 * failed request.
 */
export interface MakeEvent { version: 1; event: string; event_id: string; /* …§3.2 */ }

export function makeConfigured(): boolean;               // MAKE_WEBHOOK_URL set?
export async function sendMakeEvent(e: MakeEvent): Promise<MakeResult>;
export async function sendMakeEvents(e: MakeEvent[]): Promise<MakeResult>;  // batch, §4.5
```

Requirements:

- **Timeout**: `AbortSignal.timeout(8000)`. Make's webhook responds in ~200 ms;
  without a timeout a hung connection burns the whole Vercel function budget.
- **One retry** on 5xx/network, 500 ms apart. Beyond that, Make's own queue is
  the right place to retry — don't build a second retry system here.
- **Unconfigured = log and skip**, exactly like `sendEmail` with no
  `RESEND_API_KEY`. Local dev must not need a Make account.
- **Never log the secret**; do log `event_id` and the response status.
- `env` field from `VERCEL_ENV ?? NODE_ENV` so Make can drop dev traffic.

### 4.2 Rewrite — `lib/notify.ts`

Keeps its exported surface (`sendOrderNotification`, `notifyCourseAccess`,
`OrderEvent`, `NotifyResult`) so `lib/db/access.ts` and `lib/db/delivery.ts`
need no changes. Internals swap entirely:

- The five `switch` arms that built `parameters: string[]` collapse into **one**
  `buildOrderEvent(order, event)` that returns the §3.2 object. All the
  formatting that currently lives inline (amount ÷ 100, `${city}, ${state}`,
  `toLocaleDateString("en-IN")`, the `91` phone prefixing) moves into small
  named helpers — same logic, one place.
- Keep the `!order.buyer_phone` guard and its 409 (Magic Checkout genuinely has
  no phone until Razorpay backfills it).
- Keep the `address_reminders_sent` increment on `payment.received`.
- Add: write `notification_log` before sending, update it after (§4.6).

### 4.3 Move — `app/api/whatsapp/send` → `app/api/notify/send`

Body unchanged apart from accepting the new event names. Kept because it is
still the entry point for anything that can only reach us over HTTP, and it is
the manual "re-send this message" hook for the admin UI.

Both old and new paths should exist for **one deploy** — a Razorpay webhook
retry can arrive against the previous deploy's URL. Delete the old route in the
following deploy.

### 4.4 Kill the three self-HTTP hops

`verify/route.ts:132`, `payment-claim.ts:83` and `address/route.ts:78` all
fire-and-forget a `fetch` at *our own* `/api/whatsapp/send`. That is:

- an extra cold start per notification,
- dependent on `NEXT_PUBLIC_APP_URL` being correct (this has already silently
  broken once — see the comment in `lib/notify.ts:156`),
- **and unreliable on Vercel** — a floating promise after the response is
  returned may be killed when the function freezes.

Replace all three with:

```ts
import { after } from "next/server";       // Next 16 — already on ^16.1.6
after(() => sendOrderNotification(order_number, event));
```

`after()` runs post-response and Vercel keeps the invocation alive for it. This
is a correctness fix that happens to fall out of the migration; call it out at
review time so it isn't mistaken for scope creep.

`claimPaidTransition` is called from webhook route handlers, so `after()` works
there too — if any caller turns out not to be in a request scope, `await` it
instead (one fast HTTP call, unlike today's cold-start hop).

### 4.5 Batch — `lib/db/delivery.ts:notifyStatusChange`

Today: `Promise.allSettled` in waves of 8, one Meta call per order. Against Make
that would be fifty webhook hits and fifty executions of quota for one button
click.

New shape: build all payloads, send **one** POST with
`{ version: 1, batch: true, events: [...] }`. Make's Iterator fans it out.
Returns the count accepted. Still never rethrows.

Chunk at 100 events per call to stay under Make's payload limits.

### 4.6 New — `supabase/migrations/0014_notification_log.sql`

```sql
CREATE TABLE notification_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      TEXT NOT NULL UNIQUE,     -- §3.4, the dedupe key
  event         TEXT NOT NULL,
  order_number  TEXT,                     -- null for course grants with no order
  phone         TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued','sent','failed','skipped')),
  provider      TEXT,                     -- 'meta' | 'wati' | …, reported by Make
  provider_message_id TEXT,
  error         TEXT,
  payload       JSONB,                    -- what we sent, for replay
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notification_log_order ON notification_log (order_number, created_at DESC);
CREATE INDEX idx_notification_log_status ON notification_log (status, created_at DESC)
  WHERE status IN ('queued','failed');
```

This is what makes the whole thing debuggable. Right now "did the customer get
the message?" is unanswerable without grepping Vercel logs.

### 4.7 New — `app/api/notify/callback/route.ts`

Make calls this after the WhatsApp module runs (success **and** error handler).

```
POST /api/notify/callback
X-Bisher-Secret: $MAKE_WEBHOOK_SECRET
{ "event_id": "...", "status": "sent"|"failed", "provider": "meta",
  "provider_message_id": "wamid...", "error": null }
```

Updates the row. Unknown `event_id` → 200 with a logged warning, never 4xx: a
callback failure must not put Make into a retry loop.

### 4.8 Admin UI (small, Phase 3)

On the order detail page, a "Messages" strip reading from `notification_log`:
event, time, status dot, error on hover. Plus a "re-send" button hitting
`/api/notify/send`. This replaces "check the Vercel logs" as the answer to
every support question.

### 4.9 Scripts, env, docs

- **`scripts/test-make.mjs`** — posts one sample event of each type to
  `MAKE_WEBHOOK_URL` with `env: "development"`. Flags: `--event=order.shipped`,
  `--phone=`, `--real` (omit → `dry_run: true`, so the scenario routes to a
  logging branch and no message is sent). Same decoded-error style as the
  existing script.
- **`scripts/check-env.mjs`** — the WhatsApp block becomes: `MAKE_WEBHOOK_URL`
  set and parses as a `hook.*.make.com` URL, `MAKE_WEBHOOK_SECRET` set and ≥ 24
  chars. Optionally a `GET` ping. Keep it a warning, not a failure — the site
  works without it.
- **`.env.example`** — remove `WHATSAPP_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID`,
  add:

  ```
  # ── WhatsApp automation (Make.com) ─────────────────────────────────────────
  # All WhatsApp sending goes through a Make scenario; the app posts events and
  # Make owns the copy, the templates and the provider credentials.
  # Webhook URL is itself a secret — anyone holding it can trigger messages.
  MAKE_WEBHOOK_URL=
  # Shared secret echoed in X-Bisher-Secret; the scenario drops anything else.
  MAKE_WEBHOOK_SECRET=
  ```

- **`MAKE_WHATSAPP.md`** — replaces `WHATSAPP_SETUP.md`. Operator-facing: how
  to open the scenario, where the copy lives, how to change a message, how to
  read a failed execution, how to replay. Written for Bisher, not for a
  developer.
- **`package.json`** — `"test-whatsapp"` → `"test-make"`.
- Delete `WHATSAPP_SETUP.md` in the same commit that deletes `lib/whatsapp.ts`,
  so no one follows a dead runbook.

---

## 5. The Make.com scenario

### 5.1 Modules, in order

| # | Module | Config |
|---|---|---|
| 1 | **Webhook → Custom webhook** | Name `bishertalks-events`. Attach a JSON schema (paste one sample of each event) so downstream mapping shows named fields, not `1.2.3`. |
| 2 | **Webhook response** | `200 {"ok":true}` **immediately**, before any sending. Keeps our function fast and stops Make retrying on a slow WhatsApp API. |
| 3 | **Filter: secret** | Continue only if `X-Bisher-Secret` header equals the scenario's stored secret. Everything else stops here. |
| 4 | **Filter: env** | Drop `env != "production"` (or route it to a Slack/email branch) so local testing never messages a real customer. |
| 5 | **Router: batch?** | `batch = true` → **Iterator** over `events[]`, rejoining the single-event path. |
| 6 | **Data store: get `event_id`** | Exists → stop. Else set it (TTL 7 days). The dedupe layer. |
| 7 | **Router: by `event`** | One filtered route per event name (§3.3). |
| 8 | **WhatsApp module** ×N | One per route. Meta Cloud → template + mapped body params; WATI/360dialog → their own template call. |
| 9 | **HTTP → POST callback** | `/api/notify/callback` with the secret header, `status: sent`, provider message id. |
| 10 | **Error handler → Break** | On every WhatsApp module. `Break` puts the run in **Incomplete executions** for retry (interval 15 min, 3 attempts) *and* posts `status: failed` with the error text. |

Scenario settings: **sequential processing on**, so ordering is preserved and
the data store dedupe isn't racing itself.

### 5.2 Message copy

Copy the five bodies verbatim from `WHATSAPP_SETUP.md` §2 into the Make modules
before deleting that file — that text is already Meta-approved wording and is
the migration's only source for it.

Mapping changes from positional to named, which is the readability win:

| Was | Becomes |
|---|---|
| `{{1}}` | `{{customer.name}}` |
| `{{2}}` | `{{order.number}}` |
| `{{3}}` | `{{order.amount}}` |
| `{{4}}` | `{{links.address}}` |

If the provider is Meta Cloud, the same five templates must still be approved,
in **English (`en`, not `en_US`)**, variables in the **body only** — every
warning in the old `WHATSAPP_SETUP.md` §2 still applies and should be carried
into `MAKE_WHATSAPP.md`. If the provider is a BSP, template approval happens in
their console instead and is usually faster.

### 5.3 Security

- The webhook URL is unguessable but is a bearer token — treat it as a secret,
  never commit it, Vercel env only.
- `X-Bisher-Secret` is the actual gate. Generate 32 bytes:
  `openssl rand -hex 32`.
- Upgrade path if abuse ever appears: HMAC-SHA256 of the raw body with a
  timestamp header, verified in Make with a `sha256` formula. Overkill for now;
  note it in `MAKE_WHATSAPP.md`.
- The callback direction is protected by the same secret, checked with a
  constant-time compare in the route.
- **Never put PII in the scenario name or in Make's Slack notifications** —
  execution history already stores the payload, which contains phone numbers.
  Set the scenario's data-retention window to the minimum that is still useful
  (7 days).

---

## 6. Cutover, testing, rollback

### 6.1 Testing checklist (before flipping production)

- [ ] `npm run test-make -- --event=payment.received` → arrives in Make history
- [ ] Wrong secret → scenario stops at module 3, no message
- [ ] `env: development` → dropped by module 4
- [ ] Same `event_id` twice → second run stops at the data store, **one**
      message on the handset
- [ ] Batch of 3 → iterator fans out, 3 messages, 1 execution
- [ ] Callback writes `sent` + `provider_message_id` into `notification_log`
- [ ] Force a failure (bad phone) → error handler → `failed` + error text in the
      log, run visible in Incomplete executions, retry succeeds after fixing
- [ ] `MAKE_WEBHOOK_URL` unset locally → logs a skip, order flow completes
      normally
- [ ] Make returns 500 → `sendMakeEvent` retries once, then gives up, order
      flow still completes
- [ ] **Full order rehearsal on test keys**: pay → `payment.received` →
      submit address → `order.confirmed` → mark shipped → `order.shipped` →
      mark delivered → `order.delivered`, plus `course.access` from the grant.
      Five messages, correct copy, correct links, nothing duplicated.
- [ ] Bulk-select 5 orders → mark shipped → 5 messages, 1 execution
- [ ] `npm run build` clean; no dangling imports of `lib/whatsapp`

### 6.2 Cutover

Because WhatsApp is currently **not configured at all** (both env vars are
placeholders), there is no live traffic to break. This migration can go straight
in — there is no dual-run period to design, which is a real piece of luck. Do it
before the number goes live, not after.

Order of operations:

1. Merge the code with `MAKE_WEBHOOK_URL` unset → identical behaviour to today
   (nothing sends, everything logs a skip).
2. Build the scenario, test with `scripts/test-make.mjs` against a real handset.
3. Set the two env vars in Vercel → messages start flowing.
4. Watch `notification_log` and Make history for the first ~20 real orders.

### 6.3 Rollback

Revert the migration commit and restore the two `WHATSAPP_*` env vars. Since
the Meta path was never live, "rollback" means "back to sending nothing" — the
honest framing. Keep `lib/whatsapp.ts` recoverable from git history rather than
leaving dead code behind a flag; a flag here would rot.

Faster rollback for a bad *message*: no deploy at all — turn the scenario off,
or fix the copy in Make. That is the point of the whole design.

---

## 7. Phases

| Phase | Scope | Depends on | Est. |
|---|---|---|---|
| **1. Code swap** | `lib/make.ts`, rewrite `lib/notify.ts`, move the route, kill the 3 self-fetches, batch `notifyStatusChange`, delete `lib/whatsapp.ts` | nothing | ~half a day |
| **2. Observability** | `0014_notification_log.sql`, callback route, dedupe insert | Phase 1 | ~2–3 h |
| **3. Make scenario + provider** | **Decide provider first.** Build scenario, port the 5 message bodies, secret + dedupe + error handling, `scripts/test-make.mjs`, `MAKE_WHATSAPP.md`, env swap, admin "Messages" strip | Phases 1–2 | ~half a day + provider onboarding (Meta: days; BSP: hours) |
| **4. New automations** | `address.reminder` cron (highest value), `payment.link_sent`, `checkout.abandoned`, `order.out_for_delivery` | Phase 3 live | ~half a day each, mostly in Make |
| **5. Two-way (optional)** | Inbound replies: Make watches incoming WhatsApp → `POST /api/notify/inbound` → writes `follow_up_note`/`follow_up_at` on the order (`0011_follow_up.sql`) | Phase 4 | ~half a day |

Phase 5 is the one worth flagging as genuinely new capability: customer replies
currently land in someone's phone and die there. Routing them onto the order row
makes the follow-up worklist in the admin actually complete.

---

## 8. Operations, cost, and the things that will bite

**Make quota.** Each single-event execution costs roughly 4–6 operations
(webhook, response, data store get, data store set, WhatsApp, callback).
Filters and routers are free. So ~5 ops per message.

| Volume | Ops/month | Plan |
|---|---|---|
| 100 orders (≈300 messages) | ~1,500 | Free (1,000) is **not** enough — Core |
| 500 orders (≈1,500 messages) | ~7,500 | Core (10,000) |
| 2,000 orders (≈6,000 messages) | ~30,000 | Pro |

Batched bulk sends cost ~1 op per event via the iterator plus the fixed
overhead, so the delivery worklist is cheap. Budget Core (~$9–10/mo) from day
one.

**WhatsApp cost is separate and unchanged.** Meta bills per conversation
(utility conversations in India are a few paise each); a BSP adds a monthly
platform fee. Make's quota and Meta's conversation pricing are two different
meters.

Known traps, worth putting in `MAKE_WHATSAPP.md`:

- **The 24-hour window still exists.** It is a WhatsApp platform rule, not a
  Meta-API-specific one. Business-initiated messages need an approved template
  no matter which provider Make talks to. Nothing in this migration changes it.
- **Make's free plan sleeps scenarios** after inactivity and caps at 15-minute
  scheduling — irrelevant for webhooks, relevant for the Phase 4 crons.
- **Data store TTL matters.** Without one it fills and dedupe starts failing
  silently. 7 days.
- **Sequential processing** must be on, or two simultaneous webhook hits can
  both miss the dedupe key.
- **Phone format**: `+91` + 10 digits throughout. Only Indian numbers work as
  written, same as today.
- **Make's "incomplete executions" must be enabled**, otherwise the error
  handler's `Break` discards the run instead of queueing it.

---

## 9. Open decisions

These need an answer before Phase 3 starts; everything before that is
unaffected.

1. **Which WhatsApp provider inside Make?** Meta Cloud (free messages, painful
   setup, template approval) vs a BSP like WATI/AiSensy/360dialog (monthly fee,
   working number in hours, friendlier templates). Given the Meta setup has
   been stalled on placeholders for a while, a BSP is probably the pragmatic
   answer — but it is a recurring cost, so it is your call.
2. **Malayalam or English message copy?** `lib/wa-message.ts` shows the manual
   admin messages are Malayalam while the automated templates are English.
   Make makes per-message language trivial; worth aligning deliberately.
3. **Should `notification_log` store the full payload?** It contains phone and
   address. Useful for replay, a small PII surface. Recommend yes, with a
   90-day cleanup job.
4. **Does the admin need a manual "send this message" button** beyond re-send,
   e.g. picking an event for an arbitrary order? Cheap to add once §4.8 exists.

---

## 10. Summary of the diff

```
 deleted:  lib/whatsapp.ts
 deleted:  WHATSAPP_SETUP.md
 deleted:  scripts/test-whatsapp.mjs
 added:    lib/make.ts
 added:    app/api/notify/send/route.ts        (moved from app/api/whatsapp/send)
 added:    app/api/notify/callback/route.ts
 added:    supabase/migrations/0014_notification_log.sql
 added:    scripts/test-make.mjs
 added:    MAKE_WHATSAPP.md
 modified: lib/notify.ts                       (rewritten internals, same exports)
 modified: lib/db/delivery.ts                  (batched send)
 modified: app/api/orders/verify/route.ts      (after() instead of self-fetch)
 modified: app/api/orders/address/route.ts     (same)
 modified: lib/payment-claim.ts                (same)
 modified: scripts/check-env.mjs .env.example package.json README.md PENDING.md
 untouched: lib/wa-message.ts                  (manual wa.me links — unrelated)
```

Suggested commit split: (1) `lib/make.ts` + notify rewrite + delete Meta path,
(2) notification log + callback, (3) scenario docs, scripts, env.

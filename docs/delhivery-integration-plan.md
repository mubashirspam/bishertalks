# Delhivery direct integration

A plan for handing parcels to Delhivery through their API instead of the Excel
sheet, and for making "which logistics partner carries this" something an admin
picks per order — with room to add partners later without a code change.

Status: **Phases 1–6 built. Migrations applied. Sending still disabled.**

`INTEGRATED_SLUGS` in `lib/couriers/types.ts` is empty, so the Send button is
off. Everything else works: assign a courier, hand the parcel over, type the
tracking number in.

### What the token turned out to be

Tested directly against both hosts:

| Host | Result |
|---|---|
| `staging-express.delhivery.com` | **401 — "Login or API Key Required"** |
| `track.delhivery.com` (production) | **200** |

**The token is a production token, and there is no staging access.** That
answers Phase 0 question 4 and kills task 0.4 as written — there is no safe
sandbox, so the first real manifest call creates a real parcel. `DELHIVERY_ENV`
must be set to `production` or every call 401s.

### What Delhivery's Postman collection corrected

Their prose docs are wrong in ways that mattered:

- **The create body is `Content-Type: application/json`**, with
  `format=json&data={…}` and the JSON **not** url-encoded. This code encoded it,
  which their parser reads as one meaningless string.
- **`seller_gst_tin` and `hsn_code` are e-waybill fields**, marked "for
  ewaybill" — required only at ₹50,000+ per shipment. The docs call them always
  mandatory. The readiness gate required them and blocked every send for
  nothing. Now sent only above the threshold.
- **`client` is optional**, not required.
- **Only six fields are truly mandatory** per shipment: `add`, `phone`,
  `payment_mode`, `name`, `pin`, `order` — plus `pickup_location.name`.
- **The pickup request API exists** (`POST /fm/request/new/`) and was missing
  entirely. Manifesting creates a waybill; it does not summon a van.

Operating instructions live in **`delhivery-runbook.md`**.

---

## What this actually is

KKR Logistics is not a rival to Delhivery — **KKR is our pickup franchise inside
Delhivery's network**. That is why `COURIER_DEFAULTS.pickupLocation` is already
`KKR LOGISTICS FRANCHISE`. Today the route is:

1. Payment lands → order is `confirmed`.
2. An owner assigns it to a delivery agent.
3. The agent ticks parcels in `/admin/delivery-portal` and downloads the
   `.xlsx` (`/api/admin/delivery/courier-sheet`).
4. **They upload that file into Delhivery by hand.**
5. They tick Packed / Shipped / Delivered as the day goes.

Step 4 is the manual step the API removes. Same parcels, same franchise, same
Delhivery — we stop producing a spreadsheet for a human to re-upload and call
Delhivery ourselves. **The Excel download is not a permanent second channel; it
is what this replaces**, kept only as a fallback for when the API is unavailable.

Two things follow, and they are the whole point of the work:

- **Nothing is pushed automatically.** Assigning a parcel to a partner and
  sending it to that partner are two separate, explicit admin actions. Assign
  today, send tomorrow, or never — the system waits.
- **The partner list is data, not code.** Speed Post, another express service,
  a rider we hand parcels to directly — none of them are designed for now, and
  none should need a migration and a deploy. Adding one is a row in a table.

---

## Phase 0 — What is still unanswered

Most of this is now settled by testing rather than by asking. Two things are
not, and both can stop a send dead.

### Still needed from Delhivery (+91 99477 72928)

1. **The exact registered pickup location name.** The create call rejects the
   *entire payload* if this string does not match a warehouse they know. Ours is
   seeded as `KKR LOGISTICS FRANCHISE` because that is what we print on the
   Excel sheet — but the sheet is read by a human who can be forgiving, and the
   API is not. **This is the single most likely cause of a failed first send.**
2. **A staging token**, if they have one. Without it there is no way to test
   without creating a real parcel.
3. **Whose account is this token on** — ours or KKR's? It decides where the
   parcels show up, and whether KKR sees them in their own system.
4. **The status push webhook.** Opt-in, needs our URL and a sample request, and
   takes ~5–6 working days at their end. Ask now; the poller covers the gap.

Nice to have, not blocking: the client/HQ name, GST TIN and HSN code (e-waybill
only), and whether the account is Surface or Express.

### Tasks

- [x] **0.1** Establish which environment the token is for — **production**.
- [x] **0.2** `DELHIVERY_ENV` added to `.env.example`. Must be set to
      `production` in `.env.local`, or every call 401s.
- [ ] **0.3** Confirm the pickup location string with Delhivery.
- [ ] **0.4** One manifest call, checked by a human, and cancelled straight
      afterwards:
      ```
      node scripts/delhivery-smoke.mjs --manifest --yes-create-real-shipment
      node scripts/delhivery-smoke.mjs --cancel <waybill>
      ```

> 0.4 is still the gate, but it is no longer free — with no staging access it
> creates a real parcel. Cancel it as soon as the response has been read.

---

## API reference (confirmed from the docs)

| | Staging | Production |
|---|---|---|
| Base | `https://staging-express.delhivery.com` | `https://track.delhivery.com` |

Auth on every call: `Authorization: Token <DELHIVERY_API_TOKEN>`

| Operation | Method | Path | Notes |
|---|---|---|---|
| Create / manifest | POST | `/api/cmu/create.json` | `Content-Type: **application/json**`, body is literally `format=json&data=<raw json>` — **not** url-encoded |
| Fetch waybill | GET | `/waybill/api/fetch/json/?cl=<client>` | Only if we pre-allocate |
| Track (pull) | GET | `/api/v1/packages/json/?waybill=…` | **750 requests / 5 min / IP** — batch, never loop one at a time |
| Track (push) | — | our endpoint | Opt-in via Delhivery support |
| Packing slip | GET | `/api/p/packing_slip?wbns=<awb>` | Returns JSON to render, not a PDF |
| Cancel | POST | `/api/p/edit` | `{"waybill": "…", "cancellation": "true"}` |
| Pincode serviceability | GET | `/c/api/pin-codes/json/?filter_codes=<pin>` | |
| Create warehouse | POST | `/api/backend/clientwarehouse/create/` | Only documented fields allowed |
| **Book a pickup** | POST | `/fm/request/new/` | `pickup_date`, `pickup_time`, `pickup_location`, `expected_package_count` |

Cancellation is accepted only while the package is Manifested, In Transit,
Pending, Open or Scheduled. A cancelled prepaid shipment becomes `Returned` on
their side, not `Cancelled`.

Webhook payload: `Shipment.AWB`, `Shipment.ReferenceNo`,
`Shipment.Status.Status`, `.StatusType`, `.StatusDateTime`, `.StatusLocation`,
`.NSLCode`. They expect `200 OK` back.

---

## Phase 1 — Logistics partners as data

The system has one implicit courier today. Make it a list an admin owns, so
adding Speed Post or a local rider later is a form, not a deploy.

- [x] **1.1** Migration `0030_couriers.sql` — a `couriers` table:
  - `id`, `name`, `is_active`, `sort_order`
  - `handoff` — **the only field with behaviour attached**, one of:
    - `api` — we call the partner's API. Only Delhivery for now.
    - `sheet` — we produce the `.xlsx` they upload. Today's flow, kept as the
      fallback.
    - `manual` — we hand it over or post it, and someone types the tracking
      number in. **This is what makes any future partner free**: Speed Post,
      an express service, our own rider. No adapter, no code.
  - `config JSONB` — pickup location, service mode, whatever one partner needs
    and the others don't.
  - Seed one row: Delhivery (`api`), with KKR Logistics Franchise as its pickup
    location, and a second row for the Excel fallback.
- [x] **1.2** `orders.courier_id` (nullable FK, `ON DELETE RESTRICT`) — which
      partner carries this parcel. Null means "not decided yet", which is where
      every order starts and where the existing rows stay.
- [x] **1.3** `orders.courier_sent_at`, `courier_send_error`,
      `courier_last_scan`, `courier_last_scan_at`.
- [x] **1.4** **Rebuild `portal_orders` in the same migration.** It is
      `SELECT o.*`, frozen at creation — see `0028` for what happens when this is
      forgotten.
- [x] **1.5** `lib/couriers/` — the vocabulary: the three handoffs, their
      labels, and the `INTEGRATED_SLUGS` list that says which `api` partners
      actually have an adapter. Plus `lib/db/couriers.ts` for the reads.

### Two things still deliberately not done

- **`INTEGRATED_SLUGS` is still empty.** The Delhivery adapter exists, but the
  list that turns the Send button on does not name it, so nothing can be sent.
  Adding `"delhivery"` is the last step of the runbook, after a hand-rolled call
  has actually been accepted. Until then the payload is unproven code, and
  proving it with fifty parcels selected is the wrong way round.
- **`lib/courier-sheet.ts` untouched.** The Excel flow is the handoff that works
  today, and the new code reuses its address builder rather than replacing it.
  Rewriting it to read its pickup location from `couriers.config` would risk the
  working path for no gain.

### Deliberate reuse, not new columns

- **The waybill goes in `tracking_number`.** That column is already what the
  customer's tracking page reads, what the portal's Shipped box edits, and what
  the "your parcel has shipped" WhatsApp quotes. A second AWB column would mean
  three screens deciding which to trust. A `manual` partner writes the same
  column by hand — which is exactly why it needs no code.
- **`courier_entered_at` keeps its meaning** — "this parcel is with the
  courier". A successful API send sets it, exactly as downloading a sheet does
  today, so the portal's New/Confirmed filters and the `needs_entry` sort stay
  honest across all three handoffs without being touched.
- **`courier_reference` stays the sheet's reference.** For the API we send our
  `order_number` as Delhivery's `order_id` — unique by construction, already the
  key on every screen, and it returns in the webhook as `ReferenceNo`, so a scan
  maps to an order with no lookup table.

---

## Phase 2 — The Delhivery client

- [x] **2.1** `lib/delhivery/client.ts` — base URL from `DELHIVERY_ENV`, the
      `Authorization: Token` header, a request timeout, and **one retry on a
      network error only**. Never retry a 4xx, and never blind-retry create.
- [x] **2.2** `lib/delhivery/manifest.ts` — build the shipment payload and POST.
- [x] **2.3** `lib/delhivery/track.ts` — batched waybill lookups, inside the
      rate limit.
- [x] **2.4** `lib/delhivery/status.ts` — map their `Status` / `StatusType` onto
      our `OrderStatus`. One table, every unmapped value logged rather than
      silently dropped.
- [x] **2.5** `lib/delhivery/cancel.ts`.
- [x] **2.6** `scripts/delhivery-smoke.mjs` — manifest, track, cancel against
      staging, from the 0.4 fixtures.

### Address formatting: reuse what the courier already accepts

Build the payload from `courierAddress()` and `phoneDigits()` in
`lib/courier-sheet.ts`, not from a fresh join of the address columns. Those
produce the exact string a year of accepted uploads has gone out with — including
the trailing mobile number the delivery boy reads off the printed slip. The API
should receive a byte-identical address to the sheet, or we are testing a new
format we have no evidence for.

`COURIER_DEFAULTS` already holds weight per book, dimensions, packaging type,
product, return address and seller details. Those move into the shared partner
layer rather than being retyped.

---

## Phase 3 — Sending, under admin control

Nothing here happens on its own. Assigning a courier writes one column. Sending
is a separate button someone presses.

- [x] **3.1** `POST /api/admin/delivery/courier-send` — takes explicitly chosen
      order numbers. Re-asserts on the server that each parcel is paid,
      addressed, assigned to this partner, at `confirmed`, and not already sent —
      the ticked ids are a filter, never the scope.
- [x] **3.2** **Permission: `delivery.assign`, not `delivery.portal`.** Choosing
      a partner and sending to it are both owner/manager actions. A delivery
      agent keeps the portal and the tick columns and can still download a sheet;
      they do not push parcels into Delhivery. (One line to widen later if you
      change your mind.)
- [x] **3.3** Idempotency. A timeout after Delhivery accepted the shipment must
      not create a second one on retry. Claim each parcel *before* the call with
      a conditional update (the `claimPaidTransition` pattern in
      `lib/payment-claim.ts`), and release it on a definite rejection.
- [x] **3.4** Per-parcel results. Delhivery rejects individual shipments inside
      an accepted batch, so the response says which went, which didn't, and why.
- [x] **3.5** A confirm step before sending. This is the irreversible one — an
      accepted shipment has to be cancelled at Delhivery, not undone here.
- [x] **3.6** Audit every send.

---

## Phase 4 — Scans coming back

- [x] **4.1** `POST /api/webhook/delhivery` — verified by a shared secret header
      (`DELHIVERY_WEBHOOK_SECRET`) handed to Delhivery at setup. They do not sign
      payloads, so this is the only thing between the endpoint and anyone who
      guesses the URL. Follow the raw-body pattern in `/api/webhook/whatsapp`.
- [x] **4.2** Route every status change through the existing
      `setDeliveryStatus()`, so a parcel marked delivered by a scan settles the
      referral commission and sends the same WhatsApp as one an agent ticked.
      Never write `orders.status` from the webhook directly.
- [x] **4.3** Polling fallback — a scheduled pull for parcels with a waybill and
      no terminal status, so this works before the webhook is approved and keeps
      working if it stops firing.
- [x] **4.4** Store `courier_last_scan` for the portal and order page.

> Start conservative: only `Delivered` and `RTO/Returned` move a status
> automatically. Everything else records the scan and leaves the status where the
> agent put it. A wrong mapping does not just show a wrong badge — it fires a
> customer WhatsApp and settles a referral commission.

---

## Phase 5 — Admin surface

- [x] **5.1** Courier picker on the assign bar in `/admin/delivery`, beside the
      agent picker. Assign only — it does not send.
- [x] **5.2** A **Send to Delhivery** action on the selection, separate from
      assigning, showing how many of the picked parcels are actually sendable.
- [x] **5.3** Courier column and badge in the delivery list and the portal grid,
      so "who is carrying this" is readable at a glance.
- [x] **5.4** Order page panel: partner, waybill, last scan with its time, a link
      to Delhivery tracking, and a Cancel button for the states they allow.
- [x] **5.5** Filter by partner, and a visible failure state — parcels with a
      `courier_send_error` must be findable, not buried in a log.
- [x] **5.6** **Manage couriers** screen: add a partner, name it, pick its
      handoff, activate/deactivate. This is where Speed Post gets added, with no
      code involved.

---

## Phase 6 — Hardening

- [x] **6.1** Pincode serviceability check before a send, so a bad address is
      caught here rather than in a rejected batch.
- [x] **6.2** `scripts/check-env.mjs` — fail loudly when `DELHIVERY_ENV` is
      `production` without a production token.
- [x] **6.3** Respect the 750-req/5-min tracking limit in the poller.
- [x] **6.4** Runbook: what to do when a send fails, how to re-send, how to
      cancel, who to call.

---

## Decisions taken (change here, not in the code)

1. **Nothing is ever pushed automatically.** Assign and send are two actions.
2. **Sending is an admin action** (`delivery.assign`). Agents keep the portal.
3. **Partners are rows, not an enum.** A new one is a form; only `api` partners
   need code, and only Delhivery is one.
4. **`manual` handoff is the escape hatch** — it covers Speed Post, any express
   service, and hand delivery with no adapter at all.
5. **The Excel sheet becomes a fallback**, not a parallel channel. It stays
   because an API outage should not stop a day's parcels going out.
6. **The waybill lives in `tracking_number`.** No second column.
7. **A successful send sets `courier_entered_at`**, so every handoff agrees on
   what "with the courier" means and the portal's filters keep working.
8. **Automatic status changes start at Delivered and Returned only.**

## Open questions

- Multi-piece: we put `quantity` books in one parcel today. Confirm Delhivery is
  happy with one waybill and a heavier weight, which is what the sheet does now.
- Does a parcel ever need its partner changed after sending? Delhivery's cancel
  is the real undo; the local column should follow it, not lead.

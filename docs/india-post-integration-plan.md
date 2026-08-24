# India Post direct integration

A plan for booking, labelling and tracking Speed Post parcels through India
Post's `beextcustomer` APIs, the way Delhivery is done today — and for making
"which carrier can do what" a property of the carrier rather than something the
routes know.

Source: `Customer_Integrations_approach_document_31052026.docx` (India Post –
External Integrations, updated 25.05.2026). Support desk:
`integrations.cept@indiapost.gov.in`.

Status: **phases 2, 3 (part) and 8 built.** The article-number minter, the
auth/HTTP layer, the event reader and the webhook endpoint are written and
unit-tested. Booking, labels, tariff and the adapter seam are not.

Blocked on the portal steps in §0.1 — no API call can succeed until this
machine's IP is whitelisted and the APIs are subscribed.

India Post is courier `speed-post`, handoff `manual`, 100 parcels routed to it.

## 0. What the portal says, and where the approach document is wrong

The Customer Selfservice Portal at `app.indiapost.gov.in/customer-selfservice`
is the authority. It contradicts the approach document in four places, and each
one would have failed late:

| | Approach document | The portal |
|---|---|---|
| Login path | `/v1/access/login` | **`/v1/access/Login`**, plus `/v1/access/TokenWithRtoken` (AUTH02) for a refresh token |
| Booking | `/process-articles/:id`, JSON body | **`/process-articles-file/:customerID` only** — a multipart upload of a JSON file. The JSON-body endpoint is not among the twelve APIs offered |
| Bulk tracking | up to 500 articles | **up to 50** |
| IP whitelisting | a production go-live item | **required for sandbox too** — "At least one UAT IP is required" |

Two APIs the plan assumed are **not in the subscription list at all**: the
pincode/post-office lookup (`bemasterdata/v1/offices/limited-details`) and the
event download (`/v1/event/download`). The office lookup is how we get the
eight-digit `pickup_dropoff_office_id` that booking requires, so this needs
answering — it may live on a different base path that needs no subscription, or
it may have to come from the division office by hand. Events appear to be
handled by the **Event Configuration** tab beside API Subscription rather than
by a polled endpoint.

`ENDPOINTS` in `lib/india-post/config.ts` records the portal's spellings, with
the disagreements noted in place.

### 0.1 The manual steps, in order

Nothing in the code can proceed past these.

1. **Whitelist the IP.** *Whitelist my IP Address* → UAT Environment. Required
   for sandbox, not only production — see §2.2.
2. **Subscribe to the APIs.** Six are needed: AUTH01, AUTH02, BBD01, TCD02,
   LBL01, TNT01/TNT02. The three international ones and the letter tariff are
   not. Confirm the *Subscribed APIs* tab stops reading zero.
3. **Configure events.** *Event Configuration* → Data Transfer Mode
   **Webhook** → both URL boxes get the same address (§0.3) → tick all eight
   Booking Events, no International ones.
4. **Fill in the credentials.** `INDIA_POST_USERNAME` and
   `INDIA_POST_PASSWORD` in `.env.local` — the portal login itself, not a
   separate key.
5. **Run `node scripts/india-post-smoke.mjs`.** It logs in, prices a real
   one-book and two-book parcel and reads a tracking number. It books nothing.

### 0.2 Two accounts, and they are not interchangeable

| | Customer | Contract |
|---|---|---|
| Sandbox | `9999757537` (issued by the portal on registration) | — |
| Production | `1171865272` | `41767647` |

The production pair is the real contractual account — the numbers already
printed on every docket we post. `indiaPostReadiness()` picks between them by
`INDIA_POST_ENV`, rather than reading one variable, because the failure mode of
getting it wrong is not an error message: a production host with the production
id, while someone believed they were testing, puts real parcels into the postal
system.

### 0.3 The event webhook

Their Event Configuration form takes two URLs — booking events and everything
else — and offers **no signature, no shared key and no header field**. Only a
URL box and a Test button.

So the URL is the credential, and the secret is a **path segment** rather than a
query parameter: query strings are stripped, rewritten and logged by proxies far
more often than paths are.

```
https://www.bishertalks.com/api/webhook/india-post/<INDIA_POST_WEBHOOK_SECRET>
```

Both boxes get the same URL; the payload says which kind of event it is, and
two routes would be two copies of the same twenty lines. The endpoint answers
`GET` as well as `POST`, so whichever way their Test button probes it gets a
200 — but both still require the secret, because an endpoint that confirms its
own existence to anyone who guesses the path is an endpoint being enumerated.

**It must be deployed before Test will pass.** The route does not exist on the
live site until it ships.

Treat that URL like a password. It moves orders to delivered and settles
referral commissions.

---

## 1. What is actually different from Delhivery

Four differences, and every design decision below follows from one of them.

**We generate the tracking number, before booking.** Delhivery assigns a
waybill in the create response. India Post allots us a *range* of article IDs
(UAT: `ET21433001XIN` to `ET21434000XIN`) and we mint 13-character barcodes
from it ourselves. A barcode is a consumable with a finite stock, spent whether
or not the booking succeeds. Nothing in the current system has this shape.

**Booking is partial-success by design.** `process-articles` returns
`valid_articles[]` and `error_articles[]`, each article with its own errors.
Delhivery's create is closer to all-or-nothing. Our `ParcelOutcome` ledger in
`app/api/admin/delivery/courier/route.ts` already reports per-parcel results,
so this fits — it is the one place India Post is *easier*.

**The label is theirs, not ours.** `POST /v1/label/create/domestic` returns a
PDF with the scannable barcode on it. Our `lib/address-sheet.ts` docket is our
own paperwork and stays; the official label is a separate artefact fetched from
them, because the counter scans their barcode.

**Auth is a session, not a key.** `POST /v1/access/login` returns an
`access_token` with `expires_in`, plus a refresh token. Delhivery's token is a
static string in the environment. This needs a cached token with refresh.

Everything else — tariff, tracking, events, a webhook — has a Delhivery
counterpart and maps onto machinery that already exists.

---

## 2. Blockers and open questions

These are ordered by how much they can cost if discovered late. **1 and 2 must
be settled before any code is written.**

### 2.1 Single-book parcels fall between the two article types

The real parcel, measured: **one book is 380 g and 25 × 15 × 2.5 cm.** Books
stack, so the flat stays 25 × 15 and the height grows 2.5 cm a book; gift wrap
adds 20 g and nothing to the shape. This is now what `parcelSize()` in
`lib/courier-sheet.ts` declares — see §2.1.1, because it was wrong for
Delhivery too.

Against India Post's bands:

| | Weight | Length | Width | Height |
|---|---|---|---|---|
| `SP_INLAND_DOC` | 1–500 g | 1–42 cm | 1–29 cm | **1–2 cm** |
| `SP_INLAND_PARCEL` | 1–35 kg | **14**–150 cm | **9**–150 cm | 1–150 cm |

| Parcel | Weight | Size | Article type | |
|---|---|---|---|---|
| 1 book | 380 g | 25 × 15 × 2.5 | weight says DOC, height says PARCEL | **conflict** |
| 1 book, gift | 400 g | 25 × 15 × 2.5 | weight says DOC, height says PARCEL | **conflict** |
| 2 books | 760 g | 25 × 15 × 5 | `SP_INLAND_PARCEL` | clean |
| 3 books | 1140 g | 25 × 15 × 7.5 | `SP_INLAND_PARCEL` | clean |

**The problem is only the single-book order, and it is 0.5 cm wide.** Anything
of two books or more is over 500 g and comfortably inside the parcel band. One
book is under 500 g, which by their rule makes it a document — and a document
may not be more than 2 cm thick. Ours is 2.5.

Their own instruction is explicit: "Speed Post articles weighing below 500
grams, kindly ensure the dimensions fall within the following range … Height:
1–2 cm." So a 380 g, 2.5 cm article breaks a stated rule, and the tariff API
picks the article type from weight on its own — it will price a single book as
a document whatever we send.

Three ways out, in order of preference:

1. **Get the packed height to 2.0 cm.** Measure the book alone. If the book is
   2 cm and the flyer is adding 0.5, a thinner mailer settles this permanently
   and a single book becomes a clean document.
2. **Ask whether an under-500 g article may be booked as `SP_INLAND_PARCEL`.**
   This is the honest answer if the book itself is 2.5 cm — the article really
   is a parcel — but it needs their written agreement, because the weight rule
   says otherwise.
3. **Ask whether dimensions may be sent as zero for a document.** Their spec
   says the API accepts 0 for length, width and height and prices on weight
   alone when they are absent. That may be the intended path for documents, or
   it may be a loophole they would rather we did not use. Ask; do not assume.

**Not an option: declaring 2 cm when the parcel is 2.5.** It is a false
declaration on a contractual booking, and the parcel is measured at the counter
anyway.

**Volumetric weight never bites at these numbers**, which is worth knowing
before anyone tries to solve this with packaging. A book is dense: one book is
937 cm³, about 190 g volumetric against 380 g actual, and stacking grows both
in step. Every carrier here charges the higher of the two, so it is always the
real weight — there is nothing to win by making the parcel smaller, only an
article-type threshold to clear.

### 2.1.1 The same numbers were wrong for Delhivery

`COURIER_DEFAULTS` declared **250 g in a 10 × 10 × 10 cm cube** — neither
measured, nor a shape any parcel of ours has ever been — and that went to
Delhivery on every Excel sheet, every API manifest and every freight estimate.

Under-declaring weight saves nothing: the hub weighs the parcel and bills the
difference back as a discrepancy that nobody can then reconcile against an
invoice. Fixed now rather than as part of this integration, because it is
costing money today. Expect the estimated freight in `/admin/reports` to rise
to what Delhivery has actually been charging.

### 2.2 IP whitelisting — answered: yes, and from day one

Resolved by the portal itself, and the answer is stricter than the document
suggested. The IP Address Whitelisting page states plainly: *"UAT environment
IP addresses are **required** for sandbox testing"*, and the submit button is
disabled until at least one UAT address is entered. IPv4 only, comma-separated,
managed per environment.

So this is not a go-live item that can be deferred to phase 9. **No call
succeeds — not even a login — until an address is whitelisted.** It is the
first thing on the critical path, ahead of every line of code.

**For development that costs nothing.** Whitelist the development machine's own
public address and the sandbox opens immediately; there is no server to buy and
nothing to host. `scripts/india-post-smoke.mjs` prints that address every run,
because a home connection's address changes and a batch of sudden 403s is
otherwise a mystery. The client tells the two apart deliberately: a whitelist
refusal reports itself as `blocked` and says which portal page to open, rather
than looking like a bad password.

**Production is the part that costs money, and not much.** A deployed app on
Vercel has no fixed outbound address, so India Post calls need a small
fixed-IP box or proxy — a few hundred rupees a month, for those calls only.
Not a hosting upgrade. That decision can wait until phase 9; nothing before it
is affected.

### 2.3 Smaller unknowns, for the UAT checklist

- **`sender_company` and `receiver_company` are marked Mandatory** in the field
  table, but the sample payload sends `""` for both and our customers have no
  company. Confirm; otherwise send the person's name again.
- **Minimum field length is 3 characters** for names, address lines and city.
  Some of our `address_line2` values are null and some cities are two letters.
  Omit rather than send a short string, and check what they do with an omitted
  optional field.
- **The validation list contradicts the field table** on article type — the
  errors say "must be SP or BP", the table lists `SP_INLAND_DOC` and friends.
  Test both.
- **Two mobile numbers in one field.** `receiver_mobile_no` must be exactly 10
  digits; some of our orders carry "9947140490 / 8281055512". Take the first
  ten digits, and do it in one place.
- **The barcode check digit in their own sample is wrong.** Their published
  algorithm (weighted modulus 11, factors `86423597`) reproduces their worked
  example and validates `EY000027272IN`, `AW784699994IN` and `EB126023474IN` —
  but *not* `EB468827991IN` or `EB468790992IN` from the booking sample. Those
  two look hand-typed. Verify our generator against a real allotted range in
  UAT before trusting it.

---

## 3. The shape: a carrier adapter

Today the routes import Delhivery directly — `courier/route.ts` pulls in
`manifestParcels`, `delhiveryReadiness`, `DelhiveryError`; `courier-sync` pulls
in `trackWaybills`; `lib/db/serviceability.ts` imports
`lib/delhivery/serviceability`. Adding a second carrier that way means a second
branch in every one of those files, and every branch is a chance to break the
carrier that works.

So: **one interface, two implementations, and Delhivery's modules move behind
it unchanged.**

```
lib/couriers/adapters/
  index.ts        adapterFor(courier): CarrierAdapter | null
  types.ts        the interface below
  delhivery.ts    wraps lib/delhivery/* — no logic moves, only imports
  india-post.ts   new
```

```ts
interface CarrierAdapter {
  slug: string;
  /** Is this carrier configured well enough to call? */
  readiness(config: CourierConfig): { ready: boolean; settings: S | null; missing: string[] };

  /** Optional capabilities. Absent means the UI does not offer it. */
  serviceability?(s: S, pincodes: string[]): Promise<Map<string, boolean>>;
  quote?(s: S, parcel: Parcel): Promise<Charge>;
  book?(s: S, parcels: Parcel[]): Promise<BookResult[]>;
  labels?(s: S, parcels: Parcel[]): Promise<Buffer>;
  track?(s: S, ids: string[]): Promise<TrackedParcel[]>;
  cancel?(s: S, id: string): Promise<void>;
}
```

Two things this buys immediately:

**`canSendAutomatically` and `canTrack` stop being hard-coded lists.**
`INTEGRATED_SLUGS` and `TRACKED_INTEGRATIONS` in `lib/couriers/types.ts` become
"does this carrier's adapter implement `book` / `track`". The screens already
read those two functions to decide which buttons to show, so India Post's
buttons appear the moment its adapter does.

**The courier scoping just built generalises for free.** `delhiveryCourierIds()`
in `lib/db/couriers.ts` — added when an India Post parcel inherited a Delhivery
waybill — becomes `courierIdsFor(adapter)`, and the poller runs once per
carrier over its own parcels. That fix is the seam this plugs into; it is why
the scoping went in before the integration.

### What must not change

Delhivery's behaviour is the acceptance test for the refactor. `lib/delhivery/*`
keeps its files, its comments and its `DelhiveryError` `rejected` / `unknown`
distinction — the adapter wraps, it does not rewrite. After Phase 1, routing,
sending, syncing and the poller must behave identically for KKR parcels, and
`scripts/reference-recode.mjs` must still find nothing to do.

---

## 4. Where it lives in the admin

**Recommendation: no separate tab.**

The delivery portal already filters by courier — `/admin/delivery-portal?courier=<uuid>`
is how India Post's hundred parcels are worked today. India Post becomes a
courier with more buttons lit, not a second queue. A separate tab would fork the
grid, the filters, the print flow and the partner-scoped permissions for one
carrier, and would leave two places to answer "where is this parcel".

Per-carrier differences are already modelled by capability, not by identity:
`canSendAutomatically(courier)` shows Send, `canTrack(courier)` shows Sync and
the waybill column. Those stay the switches.

**One genuinely new surface: barcode stock.** It belongs on `/admin/couriers`,
in the India Post row — ranges allotted, how many unused, and a form to add a
range when they issue one. It is carrier configuration, not parcel work, and
Delhivery has no equivalent.

**One changed behaviour: Print.** For Speed Post the button fetches India Post's
official label PDF (their barcode, A6) instead of drawing our docket. Same
button, same place. Our docket stays for the contractual counter paperwork —
it already prints their customer and contract numbers.

---

## 5. Data model

Next migration number is **0049**.

### 5.1 Barcode stock — new

```sql
-- A range India Post allotted us, e.g. ET21433001IN … ET21434000IN.
CREATE TABLE postal_barcode_ranges (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  courier_id    UUID NOT NULL REFERENCES couriers(id),
  prefix        TEXT NOT NULL,          -- "ET"
  suffix        TEXT NOT NULL DEFAULT 'IN',
  serial_from   BIGINT NOT NULL,        -- 21433001
  serial_to     BIGINT NOT NULL,        -- 21434000
  next_serial   BIGINT NOT NULL,        -- the allocator's cursor
  exhausted_at  TIMESTAMPTZ,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Every barcode ever handed out, and what became of it. A spent barcode is
-- never reissued, including one whose booking was refused — India Post may
-- have recorded it, and a reused article number is their problem and ours.
CREATE TABLE postal_barcodes (
  barcode       TEXT PRIMARY KEY,       -- "ET21433001IN", 13 chars
  range_id      UUID NOT NULL REFERENCES postal_barcode_ranges(id),
  order_number  TEXT REFERENCES orders(order_number),
  state         TEXT NOT NULL,          -- allocated | booked | spent
  allocated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  booked_at     TIMESTAMPTZ,
  error         TEXT
);
CREATE UNIQUE INDEX ON postal_barcodes (order_number) WHERE order_number IS NOT NULL;
```

Allocation is a single `UPDATE … SET next_serial = next_serial + n RETURNING`
so two concurrent batches cannot take the same number — the same shape as
`claimForSend` in `lib/db/courier-send.ts`, and for the same reason.

### 5.2 `orders` — one new column

```sql
ALTER TABLE orders ADD COLUMN postal_barcode TEXT;
```

**Not `tracking_number`.** The `portal_orders` view reads a non-empty
`tracking_number` as proof the parcel is with a courier
(`WHEN COALESCE(o.tracking_number,'') <> '' THEN 'with_courier'`), and an
allocated-but-unbooked barcode is not that. `postal_barcode` is filled at
allocation; `tracking_number` is filled from it only when India Post accepts
the booking — at which point every existing screen, poller and public tracking
page works unchanged.

Everything else India Post needs already exists: `courier_reference`,
`courier_sent_at`, `courier_send_error`, `courier_last_scan`,
`courier_last_scan_at`, `courier_checked_at`, `courier_freight_paise` and
`courier_charge_detail` (the last two from 0037, which anticipated exactly this).

### 5.3 `CourierConfig` — structured sender

`lib/couriers/types.ts` holds the return address as `from_name`, `from_address`
(one blob) and `from_phone`. India Post wants `sender_add_line_1`,
`sender_city`, `sender_state`, `sender_pincode`, `sender_mobile_no` separately.
Add the structured fields; keep the blob for the docket, which reads better as
prose.

The account numbers are already there and already the right shape:
`customer_id` is `1171865272` (10 digits, their `bulk_customer_id`) and
`contract_id` is `41767647` (8 digits). Both are printed on the docket today.

Also needed, per carrier: `booking_office_id` (8 digits, from the pincode API)
and `drop_off_pincode`.

---

## 6. Event → status mapping

India Post's events map onto `lib/delhivery/status.ts` almost exactly, and the
two rules that file is built on hold here too.

| Event | Description | Our status |
|---|---|---|
| `ITEM_BOOK` | Item Booked | `shipped` |
| `BAG_CLOSE`, `BAG_DISPATCH`, `ITEM_DISPATCH` | bagged / dispatched | — |
| `BAG_OPEN`, `ITEM_RECEIVE` | received in transit / at destination | — |
| `ITEM_INVOICE`, `BEAT_DISPATCH` | invoiced to postman / out for delivery | `out_for_delivery` |
| `ITEM_ONHOLD` | kept on hold | — |
| `ITEM_REDIRECT` | redirected | — |
| `ITEM_RETURN` | Item Returned to Sender | — (still travelling) |
| `ITEM_DELIVERY` | **Item Delivered(Addressee)** | `delivered` |
| `ITEM_DELIVERY` | **Item Delivered(Sender)** | `returned` |

Two things to be careful about:

**`ITEM_DELIVERY` means two opposite things.** The description decides:
"(Addressee)" is a delivery, "(Sender)" is a completed return. Reading the code
alone would mark every RTS as delivered and pay a referral commission on a book
that came back.

**`ITEM_RETURN` is not `returned`.** It is the start of the return journey, the
exact counterpart of Delhivery's `RT`, and `lib/delhivery/status.ts` already
refuses to treat that as returned until the parcel is actually back. Same rule,
same reason: a commission voided while the parcel is still in a postal van.

Forward-only ranking (`canMoveTo`) applies unchanged — the bulk tracking
response returns the *whole* scan history every time, so replays are the normal
case, not the exception.

---

## 7. Phases

Each phase ends somewhere shippable. Delhivery keeps working throughout.

### Phase 0 — Onboarding (no code)

1. Email `integrations.cept@indiapost.gov.in`; request API (not SFTP) sandbox
   credentials against customer `1171865272` / contract `41767647`.
2. Settle §2.1 (single-book article type) and §2.2 (IP whitelisting) **in
   writing** — §2.1 before Phase 4, §2.2 before Phase 9. Send the three
   whitelisting questions in §2.2 with the credential request.
3. Get the production article-ID range allotment process in writing: how many,
   how often, and how a range is requested.

UAT credentials from the document, for building against before ours arrive:
username `9999999999`, password `Dop@1234`, customer `3000064781`, contract
`41585456` (Speed Post), AWB series `ET21433001XIN`–`ET21434000XIN`.

### Phase 1 — The adapter seam (refactor only)

`lib/couriers/adapters/{types,index,delhivery}.ts`. Repoint
`courier/route.ts`, `courier-sync/route.ts`, `courier-send/route.ts`,
`courier-charges/route.ts`, `cron/courier-poll/route.ts` and
`lib/db/serviceability.ts` at `adapterFor(courier)`. Derive
`canSendAutomatically` / `canTrack` from adapter capability.

Done when Delhivery behaves identically and no route imports `lib/delhivery/*`.

### Phase 2 — Auth and master data ✅ built (master data outstanding)

`lib/india-post/{config,client,session}.ts`. Login through AUTH02, a token
cache that renews a minute early and collapses concurrent logins into one, and
the two failure kinds Delhivery's client already models — `rejected` vs
`unknown` — because booking carries the same duplicate risk.

A third kind is India Post's own: **`blocked`**, for a whitelist refusal. It
looks like an authorisation failure and means something completely different —
nothing is wrong with the credentials, the call came from the wrong address —
so it says so, and names the portal page to open.

The post-office lookup is still outstanding, and may not be available at all:
see §0.

`lib/india-post/offices.ts`: pincode search, cached. Resolves our booking
office id once, and answers serviceability per destination pincode through the
existing `courier_serviceability` table.

### Phase 3 — Barcode stock (minter ✅, stock outstanding)

`lib/india-post/article-number.ts` is written and tested: it agrees with all
six genuine barcodes printed across the specification's tracking, event and
label samples. The two it disagrees with are both from the hand-typed booking
payload, one of which their own API rejected in the same document.

Named `article-number`, not `barcode`, to keep it clear of `lib/barcode.ts` —
that one *draws* a Code 128 symbol, this one *mints* the thirteen characters.

Still to build: migration 0049. Check digit (weighted modulus 11,
factors `86423597`; remainder 0 → 5, remainder 1 → 0, result 10 → 0, result
11 → 5) with unit tests against every known-good barcode in the document.
`lib/db/postal-barcodes.ts` — transactional allocate, mark booked, mark spent.
Admin panel on `/admin/couriers`. A low-stock warning below ~200 unused.

### Phase 4 — Tariff

`lib/india-post/tariff.ts` → `GET /v1/speed-post/tariffs`. Writes
`courier_freight_paise` and `courier_charge_detail`, which is exactly what
`lib/delhivery/charges.ts` does today, so `/admin/reports` margin figures pick
Speed Post up with no change.

### Phase 5 — Booking

`lib/india-post/booking.ts` → `POST /process-articles-file/{customerId}`, a multipart upload of a JSON file. The JSON-body endpoint the document describes is not offered. Per-parcel
mapping, per-parcel validation before the call (the field table in §4.3 of the
document is long and unforgiving — validate locally so a batch is not refused
for one short city name), and `valid_articles` / `error_articles` mapped onto
the existing `ParcelOutcome` vocabulary in `lib/delivery/route-outcome.ts`.

The claim discipline in `lib/db/courier-send.ts` applies unchanged: claim
before the call, hold on `unknown`, release only on a definite refusal. With a
pre-allocated barcode there is one extra rule — **a barcode is never returned
to stock**, because a timed-out booking may well have registered it.

### Phase 6 — Labels

`lib/india-post/label.ts` → `POST /v1/label/create/domestic`, one call per
batch, returns a print-ready PDF. Wire into the existing Print button for
Speed Post parcels.

### Phase 7 — Tracking

`lib/india-post/track.ts` → `POST /v1/tracking/bulk`, 50 articles a call — not the 500 the document claims.
Map the last event through the table in §6 into the existing `applyScan`.
Extend the poller to run per carrier over its own parcels.

Their response carries the full scan history, so this is also the natural place
to start storing a scan *list* rather than only `courier_last_scan` — but that
is a separate change and not required for parity.

### Phase 8 — Events and webhook ✅ built

`app/api/webhook/india-post/[secret]/route.ts`, and `lib/india-post/status.ts`
for reading their event codes. Both unit-tested.

The event download endpoint the document describes is not among the twelve APIs
offered, so the webhook is the only live path — there is no polled catch-up for
events. Bulk tracking (phase 7) is the backstop instead, which is the better
shape anyway: it returns the whole history rather than one event.

Two mappings carry the risk, and both are tested:

* **`ITEM_DELIVERY` means two opposite things.** "(Addressee)" is a delivery;
  "(Sender)" is a completed return. Same code, different description. Matching
  on the code alone marks every returned book as delivered and approves a
  referral commission on a parcel sitting on our own shelf.
* **`ITEM_RETURN` is not `returned`.** The parcel is still in a postal van.
  Only the delivery-to-sender closes it — the same rule Delhivery's RTO handling
  already follows.

An unmapped code is logged and changes nothing, rather than being guessed at.

### Phase 9 — Go-live

UAT sign-off against their checklist, production credentials, the real article
range loaded, then one real parcel end to end — book, print, post, watch it
deliver — before the button is turned on for the queue.

---

## 8. Risk register

| Risk | Consequence | Mitigation |
|---|---|---|
| Single-book article type unresolved (§2.1) | Every one-book parcel refused, or priced as the wrong product | Settle in Phase 0, in writing; measure the book alone first |
| Development machine's IP changes | Every call 403s with no obvious cause | The smoke script prints the current address every run; the client reports a whitelist refusal as `blocked`, not as bad credentials |
| No fixed outbound IP in production (§2.2) | Cannot go live from Vercel | Small fixed-IP proxy for India Post calls only; a phase 9 decision |
| Barcode reuse after a failed booking | Two parcels, one article number, unresolvable with India Post | Never return a barcode to stock; `spent` is terminal |
| Barcode stock runs out mid-batch | Booking stops with parcels half-processed | Allocate the whole batch up front; low-stock warning |
| `ITEM_DELIVERY(Sender)` read as a delivery | Referral commission paid on a returned book | Match on description, not event code; covered by §6 |
| Adapter refactor breaks Delhivery | The carrier that works stops working | Phase 1 is refactor-only, no behaviour change, Delhivery is the acceptance test |

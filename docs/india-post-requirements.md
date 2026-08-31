# India Post — what is required to go live

The companion to [india-post-integration-plan.md](./india-post-integration-plan.md).
The plan explains *why* each piece is shaped the way it is; this file is the
checklist, in the order things unblock each other.

**Verified against the code and against their servers on 2026-08-27.**
Everything marked ✅ was checked, not assumed.

---

## 0. Where this actually stands

Credentials are set. `103.180.89.153` **is** whitelisted under UAT. The sandbox
is still unreachable, and the evidence says that is **India Post's outage, not
our access** — full workings and the email to send in
[india-post-uat-outage.md](./india-post-uat-outage.md).

```
node scripts/india-post-smoke.mjs
  This machine's public IP: 103.180.89.153
  1. Access token (AUTH02) … blocked
     Reset before they sent a byte (ECONNRESET).
```

| Check | Result | Means |
|---|---|---|
| DNS `test.cept.gov.in` | `103.244.127.150` ✅ | name resolves |
| TCP 443 to UAT | connects ✅ | we are allowed to the service |
| TCP 80 to UAT | times out | filtered |
| TLS to UAT — any SNI, or none | **reset, 0 bytes, no certificate** | the listener is not answering anyone |
| TLS to `api.cept.gov.in` (prod) | full handshake, 6080 bytes, **403** | production is healthy |
| Cert on `uat.cept.gov.in` | `*.cept.gov.in`, **expired 2026-08-09** | UAT estate unmaintained |
| Cert on `api.cept.gov.in` | renewed 2026-07-10, valid to 2026-10-08 | production renewed |

Three things make this their side rather than ours: it fails identically with
the correct SNI, the wrong SNI and no SNI; TCP is accepted on 443 while 80 is
filtered, so we are being let through to a service that then fails; and their
sibling UAT host is serving a certificate that expired eighteen days ago while
production on the same wildcard was renewed and works. Adding the whitelist
entry changed nothing at all.

Worth recording, because the plan did not anticipate it: **the two environments
refuse differently.** Production answers a non-whitelisted caller with an HTTP
403; the sandbox resets before TLS completes. Only the first reaches the
`blocked` branch in `lib/india-post/client.ts` — the second used to surface as a
bare "fetch failed". Both the client and the smoke script now name the cause
when they see a socket-level reset.

## 1. Portal — blocks everything else

Customer Selfservice Portal, `app.indiapost.gov.in/customer-selfservice`.

- [x] **Whitelist `103.180.89.153`** under **UAT Environment** →
      *Whitelist my IP Address*. Done 2026-08-27, confirmed present. It changed
      nothing — see §0. Re-check the address on every run; a home connection's
      changes, and the smoke script prints the current one.
- [ ] **Email `integrations.cept@indiapost.gov.in`** about the UAT outage.
      Draft ready in [india-post-uat-outage.md](./india-post-uat-outage.md).
      Ask whether UAT is up and whether `test.cept.gov.in` is still the right
      sandbox host.
- [ ] **Subscribe six APIs** — AUTH01, AUTH02, BBD01, TCD02, LBL01, TNT01/TNT02.
      Not the three international ones, not the letter tariff.
      Confirm the *Subscribed APIs* tab stops reading zero.
- [ ] **Event Configuration** → Data Transfer Mode **Webhook** → both URL boxes
      get the same address → tick all eight Booking Events, no International.
      ```
      https://www.bishertalks.com/api/webhook/india-post/<INDIA_POST_WEBHOOK_SECRET>
      ```
      **Deploy first.** The route does not exist on the live site until it
      ships, and their Test button will fail against a 404.
- [ ] **Do not submit *Request For access to Production Environment* yet.** It
      requires proof of completed sandbox testing, and there is none to upload
      until §4 is built and §7 passes.

## 2. Environment

| Variable | State | Note |
|---|---|---|
| `INDIA_POST_ENV` | ✅ `sandbox` | leave it here until §7 passes |
| `INDIA_POST_USERNAME` | ✅ set | the portal login, not a separate key |
| `INDIA_POST_PASSWORD` | ✅ set | |
| `INDIA_POST_SANDBOX_CUSTOMER_ID` | ✅ `9999757537` | |
| `INDIA_POST_CUSTOMER_ID` | ✅ `1171865272` | production, real contractual account |
| `INDIA_POST_CONTRACT_ID` | ✅ `41767647` | |
| `INDIA_POST_WEBHOOK_SECRET` | ✅ 64 chars | treat as a password — it moves orders to delivered |
| `INDIA_POST_BASE_URL` | empty, fine | `config.ts:113` defaults it per environment |

- [ ] `SHIP_FROM_NAME` / `SHIP_FROM_ADDRESS` / `SHIP_FROM_PHONE` are **unset**.
      This is the return address printed on every parcel label. Needed before
      any label is printed, India Post or Delhivery.
- [ ] None of the above are on Vercel yet — production needs the same set,
      plus `INDIA_POST_ENV=production` at the very end and not before.
- [ ] `scripts/check-env.mjs` has **no India Post section at all**. It is the
      preflight everything else is checked with; add these keys to it.

## 3. Database

- [ ] **Apply `supabase/migrations/0049_postal_barcodes.sql` by hand** in the
      Supabase SQL editor. Migrations here are not run automatically. It adds
      `postal_barcode_ranges`, `postal_barcodes`, `orders.postal_barcode`, the
      `claim_postal_serials` RPC and the `postal_barcode_stock` view.
      Unverified whether this has been applied — check before building on it.
- [x] **Migration 0049 is applied.** Verified against the live database on
      2026-08-30: `postal_barcode_ranges`, `postal_barcodes`,
      `postal_barcode_stock` and `orders.postal_barcode` all exist and
      `claim_postal_serials` answers.
- [x] **First real allotment loaded**, 2026-08-30:
      `CL669228099IN`–`CL669228448IN`, 36 numbers, serials 66922809–66922844.
      Read off the physical barcode stickers. Stock reads 36 unused of 36
      allotted — which is **below the 200 low-stock warning**, so the panel is
      amber on purpose. Ask for the next block early.
- [x] **The check digit is now verified against real barcodes.** All 36
      stickers agree with `checkDigit()` character for character, and minting
      the range from `articleNumber()` reproduces their list exactly. This was
      the one silent failure in the integration — our arithmetic disagreeing
      with theirs — and it is closed against real data rather than against the
      specification's worked example. Note the prefix is **CL**, not the `ET`
      the UAT documentation used; nothing in the code assumes either.

## 4. Code

Written and working: `config`, `client`, `session`, `article-number`, `parcel`,
`status`, the webhook route, `lib/db/postal-barcodes.ts`, and migration 0049.

**The manual channel is finished** (2026-08-30) and none of it needs their
sandbox. A Speed Post parcel can be posted today:

| Piece | What it does |
|---|---|
| `lib/india-post/bulk-sheet.ts` | Their bulk domestic workbook, column for column off `bulkdomesticone_28042026.xlsx`. Four tabs, because their uploader reads the workbook and not the first sheet. Verified against the template header by header. |
| `app/api/admin/delivery/courier-sheet/route.ts` | Emits that workbook instead of Delhivery's when the batch's courier tracks as `india-post`. Same button, same scoping, same "downloading is entering the batch" rule. Refuses a batch India Post would reject — bad pincode, short mobile, no state — before a number is spent. |
| `lib/india-post/barcode-import.ts` + `/api/admin/couriers/barcodes` + `BarcodeStock.tsx` | Load an allotment from their *Allocated Barcodes* export. Every barcode in the file is recomputed against our check digit; one disagreement refuses the import. Low-stock warning under 200. |
| `lib/xlsx-read.ts` | Reads .xlsx and .csv with no dependency, for that upload. |
| `lib/shipping-label.ts` | The 4×6 label prints the article number as its barcode when the parcel has one, captioned SPEED POST — ARTICLE NUMBER. The order number stays in the header. |

Still to build, all of it on the **API** path only:

| # | Piece | Why it blocks |
|---|---|---|
| 4.1 | ~~Adapter seam~~ | **Done** — commit `08d575c`. `capabilitiesFor()` decides; `TRACKED_INTEGRATIONS` includes `india-post`. `capabilities.book` stays false until 4.2 exists. |
| 4.2 | **`lib/india-post/booking.ts`** | Missing. Nothing can put a parcel into India Post *over the API* — the workbook above is the manual equivalent. `POST /process-articles-file/{customerId}`, multipart JSON file. |
| 4.3 | **`lib/india-post/label.ts`** | Missing. `POST /v1/label/create/domestic`. Our 4×6 label now carries their article number, so this is no longer blocking a parcel — it is what makes their own label available. |
| 4.4 | **`lib/india-post/offices.ts`** | Missing, but **confirmed buildable** (2026-08-27): the portal's API reference lists **PIN Code Search**. It supplies the 8-digit `booking_office_id`, which the workbook currently leaves blank exactly as their own sample row does. |
| 4.5 | ~~Barcode stock UI~~ | **Done** — upload or type a range on `/admin/couriers`. |
| 4.6 | **Wire tariff** | `courier-charges` still imports `lib/delhivery/charges` directly, so a Speed Post parcel is priced as a Delhivery one. |
| 4.7 | ~~`orders.postal_barcode` is read by nothing~~ | **Done** — it is on the workbook and on the label. |

## 5. Answers needed from India Post, in writing

- [x] ~~The single-book article type~~ — **closed by packaging**, 2026-08-27.
      A thinner mailer took the packed height from 2.5 cm to 2.0, inside the
      document band their weight rule classifies a 380 g article into. No
      agreement from them was needed. `bandFailures()` still checks it, because
      packaging can drift back.
- [x] ~~Where the post-office / pincode lookup lives~~ — answered by the portal
      itself: **PIN Code Search**, in the Customer Integrations API reference.
- [ ] **`sender_company` / `receiver_company`** are marked mandatory but their
      own sample sends `""`, and our customers have no company.
- [ ] **The production article-range allotment process** — how many, how often,
      how a range is requested.
- [ ] **Article type naming** — their validation text says "SP or BP", their
      field table says `SP_INLAND_DOC`. Test both.

## 6. Production only

- [ ] **A fixed outbound IP.** Vercel has none, and production whitelisting is
      per-address. Needs a small fixed-IP box or proxy for India Post calls
      only — a few hundred rupees a month, not a hosting upgrade. This becomes
      blocking the moment production access is granted.
- [ ] **Switch `INDIA_POST_ENV` to `production` last.** `indiaPostReadiness()`
      picks the account from it deliberately: the failure mode of getting this
      wrong is not an error message, it is real books entering the postal system
      while someone believes they are testing.

## 7. Definition of done

Sandbox, in order — each one is also the evidence the production-access form
asks to be uploaded:

1. `node scripts/india-post-smoke.mjs` passes all four steps.
2. A range is loaded and `postal_barcode_stock` reports it.
3. One parcel books through `process-articles-file` and comes back in
   `valid_articles`.
4. Its label PDF downloads and the barcode scans.
5. Bulk tracking returns that article's events.
6. Their Test button reaches the deployed webhook, and a pushed event moves the
   order.
7. **Delhivery still behaves identically** — routing, sending, syncing, the
   poller, and `scripts/reference-recode.mjs` finding nothing to do. This is the
   acceptance test for the adapter refactor, not an afterthought.

Then, and only then, submit the production-access form: pincode **673001**
(Kozhikode), which routes it to that division office.

## 8. A gap worth closing

There is **no test runner and no test file** in this repo — no vitest, no jest,
no `test` script in `package.json`. The plan describes the check-digit algorithm
and the event mapping as "unit-tested"; they are not, in the sense of anything
that can be re-run. Those two carry the money risk:

* the check digit decides whether an article number is real,
* `ITEM_DELIVERY(Sender)` vs `(Addressee)` decides whether a returned book pays
  a referral commission.

Both are pure functions with known-good fixtures printed in the specification.
They are the cheapest tests in the project and the ones most worth having.

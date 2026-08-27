# What the portal's API reference changed

Read off the Customer Integrations API reference on **2026-08-27**, and
reconciled against the code. This supersedes the approach document
(`Customer_Integrations_approach_document_31052026.docx`) wherever the two
disagree — it is the live reference for the environment we actually call.

Everything here is **documentation, not observation**. UAT has been unreachable
throughout (see [india-post-uat-outage.md](./india-post-uat-outage.md)), so
nothing below has been confirmed against a real response. The distinction
matters most in §3.

---

## 1. Fixed in code

### 1.1 The login endpoint was wrong — a real bug

`session.ts` logged in by posting `{username, password}` to **AUTH02**
(`/v1/access/TokenWithRtoken`). Its comment argued that both endpoints took the
same credentials and AUTH02 returned strictly more, so it was the better
default.

The reference says otherwise, plainly:

> **Generate a New Access Token Using Refresh Token** — obtain a new access
> token by providing a valid **Bearer Refresh Token** in the Authorization
> header. **Authorization:** Required (`Bearer <refresh_token>`)

It takes **no body**. It has no idea what a password is. Posting credentials to
it returns 401 on the first call, every time.

Fixed: login now goes to **AUTH01** `/v1/access/login`, which returns
`access_token`, `refresh_token` and `id_token` together — so nothing is lost.

This is worth dwelling on, because it is the second time the same thing has
happened on this integration: a plausible inference about an unfamiliar API,
written down confidently, and not caught because nothing could reach the server
to contradict it. The first was the login path casing.

### 1.2 Path casing

`/v1/access/login`, lowercase — the heading, the prose endpoint and the
copyable cURL all agree. Was `/v1/access/Login` in `config.ts`.

### 1.3 PIN Code Search exists

```
GET /v1/pincode-search?pincode=&limit=&office-type=
```

Returns `data[]` of `{ pincode, office_name, office_id, office_type_code,
state_name, delivery_office_flag, city_name, taluk_name, ... }`.

The plan recorded this API as **not available at all**, which made the
eight-digit `pickup_dropoff_office_id` that booking requires an open problem
with no known source. It has one. Added to `ENDPOINTS` as `pincodeSearch`.

**Watch the type:** `office_id` comes back as a **string** (`"21661267"`) and
the booking schema declares `pickup_dropoff_office_id` an **integer**. Coerce
at the boundary.

### 1.4 Booking accepts a plain JSON body

The endpoint is titled "Bulk Article File Upload", and the plan concluded it
was multipart-only. But its own cURL sample posts
`Content-Type: application/json` with `{ "articles": [...] }`, and the success
response reports `"input_method": "json_body"`.

So the simple path works. Also: **up to 5,000 articles** per call, which the
plan did not record.

### 1.5 The label response is probably not a raw PDF

`/v1/label/create/domestic` declares its 200 as `application/json` with "No
schema defined", while the description says it generates a printable PDF. The
sibling `/v1/label/create` is documented as returning "a barcode and a
**Base64-encoded image**".

So `label.ts` should not assume `binary: true`. Left as a note in `ENDPOINTS`
rather than a guess in code.

---

## 2. Open questions this closed

### 2.1 `article_type` is `SP` / `BP` — settled

The plan flagged a contradiction: the validation list said "must be SP or BP",
the field table listed `SP_INLAND_DOC`. Both are right, about different things:

| | Field | Values |
|---|---|---|
| **Booking request** | `article_type` | `"SP"` \| `"BP"` |
| **Tariff response** | `product_code` | `SP_INLAND_DOC`, `SP_INLAND_PARCEL`, … |

`lib/india-post/parcel.ts` exports `ArticleType = "SP_INLAND_DOC" |
"SP_INLAND_PARCEL"`. That type describes the **tariff product**, not the
booking field, and the name will mislead whoever writes `booking.ts` — booking
must send the bare `"SP"`. Worth renaming to `ProductCode` before it causes a
rejected batch.

### 2.2 The single-book problem is confirmed, not solved

Their own tariff sample prices a **250 g** article at 30 × 21 × 0.5 cm as:

```
"product_code": "SP_INLAND_DOC",  "is_document": true
```

which confirms the mechanism the plan predicted: **they pick the product from
the weight**, whatever we ask for. A 380 g book comes back a document, and a
document may not exceed 2 cm. Ours is 2.5.

Still needs their written answer. Nothing in the reference resolves it.

---

## 3. Conflicts — resolved against the approach document

**Resolved 2026-08-27** by reading `Customer_Integrations_approach_document_31052026.docx`,
including its four *embedded* attachments, which is where the answers were. Everything in
this section was an open doubt in the previous revision. **No code needed changing for
any of them except the label note** — the existing modules were right.

### 3.1 Bulk tracking event shape — our code was correct ✅

The document's real sample (not the portal's stub) shows:

```json
"tracking_details": [
  { "date": "2025-08-13T00:00:00Z", "time": "15:31:52",
    "office": "Vijayanagar S.O (Bengaluru)", "officeid": 21660187,
    "event": "Item Delivered" } ],
"del_status": { "del_status": "delivered" }
```

An **array**, exactly as `track.ts` declares it — and with **no `event_code`**,
exactly as `status.ts` already anticipated. Its `kindOf()` uses the code when
present, falls back to the wording when it is not, and breaks the
delivered-to-whom tie with `del_status`. The portal's `{events:[{timestamp,
location, status}]}` shape was the stub it appeared to be.

Three embedded spreadsheets give the authoritative event vocabulary. Every code
in them is handled, and every description maps correctly through the prose
fallback:

| Description (bulk tracking) | Falls through to | Result |
|---|---|---|
| Item Booked | `booked` | shipped |
| Item bagged / Dispatched / Received | `in_transit` | — |
| Item Invoiced / Invoiced to BO / Taken out for delivery | `out_for_delivery` | out_for_delivery |
| Item Kept on Hold / Redirected | `in_transit` | — |
| Item Returned to Sender | `returning` | — (still travelling) |
| Item Delivered(Addressee) | `delivered_to_addressee` | delivered |
| Item Delivered(Sender) | `delivered_to_sender` | returned |
| bare "Item Delivered" + `del_status: delivered` | `delivered_to_addressee` | delivered |

One latent trap worth knowing: `direction()` tests for "sender" **before**
"addressee", so a description containing both words resolves to *sender*. No
real event carries both — but one of their summary rows reads "Article
delivered to addressee/sender", and if that string ever arrives as a live
description it would be read as a return.

### 3.2 `codr_cod` — Optional, blank by default ✅

The portal reference marks it required. The document's field-validation table
says:

> `codr_cod` — **Optional** — "Bydefault blank. Incase of cash on delivery
> article – COD" — `Varchar(5)`

and its own sample payload sends `""` for both `codr_cod` and
`value_for_codr_cod`. So a prepaid parcel sends **blank**, not `"CODR"`. The
worry that we might set a postman collecting cash at a customer's door is
answered: leave it empty.

### 3.3 `user_type` / `channel_type` — the document wins ✅

The portal reference lists `user_type` as `"G" | "D" | "A" | "T"`. The
document's field validation says:

> `channel_type` — mandatory **(E - External)**
> `user_type` — mandatory **(R - Registered)**

and its sample uses `"E"` / `"R"`. The portal's enum is wrong. Use `E` and `R`.

### 3.4 Article numbers really are minted by us ✅

> For testing use the AWB series: **ET21433001XIN to ET21434000XIN**. Kindly
> follow the below attached barcode generation logic for generation of barcode
> no **from the range of article ids assigned**.

Range-minting is the intended mechanism, not a workaround. Migration 0049 and
the barcode-stock tables are solving a real problem. Note the `X` in
`ET21433001XIN` is a **placeholder for the check digit**, not a literal — the
range is serials 21433001–21434000 and position 11 is computed.

### 3.5 The check digit — verified against the specification ✅

The algorithm was in an embedded Word attachment, "Department of Posts ::
Barcode Generation Logic". `article-number.ts` implements it exactly: weights
`8 6 4 2 3 5 9 7`, sum mod 11, remainder 0 → 5, remainder 1 → 0, else
11 − remainder (10 → 0, 11 → 5).

Verified by running it:

| Input | Expected | Computed | |
|---|---|---|---|
| Spec's worked example `47312482` | 9 | 9 | ✅ |
| `EY000027272IN` | 2 | 2 | ✅ |
| `AW784699994IN` | 4 | 4 | ✅ |
| `EB126023474IN` | 4 | 4 | ✅ |
| `EB126023770IN` | 0 | 0 | ✅ |
| `RM019388105IN` | 5 | 5 | ✅ |
| `RK169063347IN` | 7 | 8 | ✗ |
| `EB468827991IN` | 1 | 7 | ✗ |
| `EB468790992IN` | 2 | 1 | ✗ |

The pattern in the three failures is the reassuring part: **every barcode drawn
from real system output verifies** (tracking responses, the event XML, the
rendered label), and **every one that fails comes from a hand-written request
payload** — two from the booking sample, one from the label sample. Their own
API rejected one of those two in the document itself. The minter is right and
their sample typists were not.

### 3.6 Label output is a genuine PDF ✅

> Sample Output: **PDF file** with addresses and barcode and all other details

with the rendered sample embedded — an A6/A7 label carrying a Code 128 symbol,
a QR block, the routing pin pair and the contract line. So `binary: true` after
all, and **the body is an array** `[{...}]`, not the single object the portal
shows. `ENDPOINTS.labelDomestic` corrected accordingly; this was the one code
note in the previous revision that was wrong.

---

## 4. Still genuinely open

### 4.1 The single-book article type — unchanged, and now explicit

The document states the rule twice, plainly:

> For Weight below 500 grams, product_code will be taken as **SP_INLAND_DOC**
> and if it is above 500 grams, **SP_INLAND_PARCEL**.
>
> Speed Post articles weighing below 500 grams, kindly ensure the dimensions
> fall within the following range: Length 1–42 cm, Width 1–29 cm,
> **Height: 1–2 cm**

One book is 380 g at 25 × 15 × **2.5** cm. It is classified a document by
weight, automatically, and then breaks the document height limit. Nothing in
the document or the portal resolves this. **It still needs their written
answer**, and it is the last thing that can block Phase 5.

### 4.2 Batch size — three different numbers

| Source | Limit |
|---|---|
| Portal reference | 5,000 articles |
| Document §4.2 | — |
| The API's own 400 error | "Articles must be an array with **1 to 100,000** items" |

Not urgent — our batches are in the tens — but do not build a chunker on the
5,000 figure without checking.

### 4.3 Bulk tracking limit — 50 or 500

The document says 500, the portal says 50. `TRACK_BATCH` is **50**, the
conservative choice: batching too small costs an extra call, batching too large
silently drops nine parcels in ten. Leave it.

### 4.4 `sender_company` / `receiver_company`

Still contradictory. The field table marks both **Mandatory** (`Varchar(80)`),
and the document's own sample sends `""`. Our customers have no company. Send
empty and expect it to pass; ask if a batch is refused for it.

---

## 5. Also learned

- **UAT booking contracts** are per service type, and ours is not the only one:
  `41585456` → `SP_INLAND_DOC` / `SP_INLAND_PARCEL` / `SP`; `41367422` →
  `BUSINESS_PARCEL` / `BP`; plus `41469430`, `41918281`, `41471113` for the
  24/48-hour products. Test customer `3000064781`.
- **Both booking shapes exist** — `/process-articles/:customId` (JSON body) and
  `/process-articles-file/:customId` (file upload). The plan recorded the
  JSON-body endpoint as not offered; it is in the document's §4.2.
- **`/v1/event/download`** (XML, per-date, per-customer) is documented in full,
  including its `LatestEventDetails` structure. The plan recorded it as not
  subscribable — worth re-checking the portal, because a polled catch-up for
  events would remove the webhook's single point of failure.
- **SFTP** is a complete alternative integration path — per-customer
  inbound/outbound folders, XLS/CSV in, event XML out. Not our route, but it is
  the fallback if the API estate stays unreliable.
- **Token lifetimes**: `expires_in` 900 s, `refresh_expires_in` 1800 s.
- **Volumetric formula**: `(L × W × H) / 5000`, stated outright.

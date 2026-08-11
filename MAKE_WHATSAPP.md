# WhatsApp messages — Make.com setup

All customer WhatsApp messages are sent by a **Make.com scenario**, not by this
app. The app posts an *event* ("this order shipped, here is everything about
it") to one webhook; the scenario decides the wording and sends it.

**What that means day to day:** changing the words in a message is a change in
Make. No developer, no deploy. Adding a whole new message is one new branch in
the same scenario.

The code side is finished. What follows is the setup, in order.

---

## Step 0 — choose who actually delivers the message

Make does not send WhatsApp itself; it calls a provider. Pick one before you
start, because it decides how long step 3 takes.

| | **WhatsApp Business Cloud** (Meta, direct) | **A BSP** — WATI / AiSensy / Interakt / 360dialog |
|---|---|---|
| Message cost | Meta's rates only (utility messages are a few paise) | Meta's rates **plus** a monthly platform fee (₹2,000–₹5,000) |
| Setup time | Days — business verification, WABA, number registration, template approval | Hours — they do the Meta side for you |
| Templates | You submit them to Meta and wait | Their console, usually faster |
| What you need | Meta Business verified, a phone number **not** in use on any WhatsApp app, a System User permanent token | An account and a phone number |

Everything below is written for **WhatsApp Business Cloud**, because it costs
nothing per month. If you pick a BSP, only the module in step 3.4 changes — the
webhook, the filters, the dedupe and the callback are identical.

> If you go with Meta direct, the old `WHATSAPP_SETUP.md` instructions for
> business verification, the System User **permanent** token (the API Setup page
> token expires in 24 hours — this is the single most common reason WhatsApp
> "works and then stops overnight") and template approval still apply. That file
> was deleted with the old integration; the parts that still matter are repeated
> in step 3 below.

---

## Step 1 — the account

1. Sign up at [make.com](https://www.make.com). Region matters — pick EU or US
   and stay there; the webhook URL contains it.
2. **Plan: Core (~$9/mo).** The free plan is 1,000 operations/month and each
   message costs about 5, so free covers roughly 200 messages. It also sleeps
   inactive scenarios, which would silently stop your order confirmations.

---

## Step 2 — the webhook

1. **Create a new scenario.** Name it `BisherTalks — WhatsApp`.
2. First module: **Webhooks → Custom webhook** → *Add* → name it
   `bishertalks-events` → **Save** → **Copy address to clipboard**.
3. Paste it into `.env.local`:

   ```
   MAKE_WEBHOOK_URL=https://hook.eu2.make.com/xxxxxxxxxxxxxxxxxxxx
   ```

   `MAKE_WEBHOOK_SECRET` is already filled in with a generated value. Keep it.

4. **Teach Make the payload shape.** Make only learns the fields by seeing one:

   - Click **Run once** on the scenario (it will sit waiting).
   - In a terminal: `npm run test-make -- --phone=9XXXXXXXXX`
   - Make shows "Successfully determined". Click **Save the structure** so the
     field names stick.
   - Repeat with `--event=course.access` so the `course` fields are learned too.

   From now on every field is selectable by name (`customer.name`,
   `order.number`) instead of by number.

5. Add module 2: **Webhooks → Webhook response**. Status `200`, body
   `{"ok":true}`.

   Put this **immediately after the webhook, before everything else.** It
   answers our server straight away instead of holding the connection open
   until WhatsApp finishes. Without it, a slow send blocks checkout.

---

## Step 3 — sending

### 3.1 Reject anything that isn't us

Add a **filter** on the connection after the webhook response (click the
spanner on the line → *Set up a filter*). Name it `valid secret`.

```
Condition:  {{1.headers.x-bisher-secret}}   Text: Equal to   <paste MAKE_WEBHOOK_SECRET>
```

Anyone who learns the webhook URL can otherwise trigger messages to any number.
This header is the gate.

### 3.2 Don't message real people from a laptop

Add a second condition to the same filter:

```
AND  {{1.env}}   Text: Equal to   production
```

Every local test carries `env: development` and stops here. That is why
`npm run test-make` is safe to run without `--real`.

### 3.3 Send each message only once

1. **Data store**: left sidebar → *Data stores* → **Add** → name
   `sent-events`, data structure with one field `event_id` (Text). Size 1 MB.
2. In the scenario, add **Data store → Get a record**, key `{{1.event_id}}`.
3. Add a filter after it: `Continue only if` `{{2.record}}` **Does not exist**.
4. After the WhatsApp module (3.4), add **Data store → Add/replace a record**
   with key `{{1.event_id}}`.

This is the belt to the app's braces. The app already refuses to queue the same
`event_id` twice; this catches a Make-side retry replaying a run that already
sent.

> Housekeeping: once a month, delete records older than a week from the data
> store, or it fills up and dedupe starts failing silently.

### 3.4 The router and the messages

Add a **Router** and give it one route per event. On each route set a filter:

| Route | Filter: `{{1.event}}` equals |
|---|---|
| Payment received | `payment.received` |
| Order confirmed | `order.confirmed` |
| Shipped | `order.shipped` |
| Delivered | `order.delivered` |
| Course unlocked | `course.access` |

On each route add **WhatsApp Business Cloud → Send a Message** (or your BSP's
equivalent). Connection: your WABA + phone number ID. Recipient:
`{{1.customer.phone}}` on every route.

**The five templates.** Create these in WhatsApp Manager → *Message templates*
first; they must be **approved** before the scenario can use them.

- **Category: Utility** on all five. Marketing costs more and gets rejected.
- **Language: English (`en`)** — not English US.
- **Variables in the body only.** A variable inside a URL button needs an extra
  component and the send fails.

#### `payment_received` — the important one

Sent the moment payment succeeds, while we still have no delivery address. This
is what recovers a customer whose internet dropped after paying.

```
Hi {{1}}, we've received your payment ✅

Order: {{2}}
Amount paid: ₹{{3}}

One last step — tell us where to send your book:
{{4}}
```

| # | Map to |
|---|---|
| 1 | `{{1.customer.name}}` |
| 2 | `{{1.order.number}}` |
| 3 | `{{1.order.amount}}` |
| 4 | `{{1.links.address}}` |

#### `order_confirmed`

```
Hi {{1}}, your order is confirmed! 🎉

Order number: {{2}}
Amount paid: ₹{{3}}
Delivering to: {{4}}
Expected: {{5}}

Track your order here: {{6}}
```

`{{1.customer.name}}` · `{{1.order.number}}` · `{{1.order.amount}}` ·
`{{1.order.address.short}}` · `{{1.order.expected_delivery}}` ·
`{{1.links.tracking}}`

#### `order_shipped`

```
Good news {{1}} — your order {{2}} has shipped! 📦

Courier: {{3}}
Tracking number: {{4}}
Expected delivery: {{5}}

Track it here: {{6}}
```

`{{1.customer.name}}` · `{{1.order.number}}` · `{{1.order.courier}}` ·
`{{1.order.tracking_number}}` · `{{1.order.expected_delivery}}` ·
`{{1.links.tracking}}`

#### `order_delivered`

```
Hi {{1}}, your order {{2}} has been delivered ✅

We hope you enjoy Neuro Code. Explore more here: {{3}}
```

`{{1.customer.name}}` · `{{1.order.number}}` · `{{1.links.site}}`

#### `course_access`

```
Hi {{1}}, your course is unlocked! 🎓

Course: {{2}}
Start learning: {{3}}

Just enter your mobile number {{4}} on the course page to get in.
```

`{{1.customer.name}}` · `{{1.course.title}}` · `{{1.course.url}}` ·
`{{1.course.login_phone}}`

> **Malayalam.** The copy above is the English wording carried over from the
> old setup. The manual messages your admin panel writes are Malayalam — if you
> want these to match, rewrite them in the Make template and submit that to
> Meta. Nothing in the code needs to change.

### 3.5 Handle a batch

When an admin marks fifty parcels shipped at once, the app sends **one** call
containing an array, so it costs one execution instead of fifty.

Right after the secret filter, add a **Router** with two routes:

- **Batch** — filter `{{1.batch}}` *Equal to* `true` → **Flow control →
  Iterator**, array `{{1.events}}` → then the same dedupe + router chain,
  mapping from the iterator's output instead of module 1.
- **Single** — filter `{{1.batch}}` *Does not exist* → the chain you already
  built.

If you would rather not duplicate the branch, the simpler alternative is to put
the whole send chain in its own scenario and call it from both routes with
**Flow control → Make a scenario call**.

### 3.6 Report back

After each WhatsApp module, add **HTTP → Make a request**:

- URL: `https://bishertalks.com/api/notify/callback`
- Method: `POST`, Body type: `Raw`, Content type: `JSON`
- Header: `X-Bisher-Secret` = your `MAKE_WEBHOOK_SECRET`
- Body:

  ```json
  {
    "event_id": "{{1.event_id}}",
    "status": "sent",
    "provider": "meta",
    "provider_message_id": "{{3.messages[].id}}"
  }
  ```

  (`{{3.…}}` = the WhatsApp module's number; check yours.)

This is what turns the admin panel's **WhatsApp messages** list from "handed to
Make" (amber) into "delivered" (green). Skip it and every message sits amber
forever.

### 3.7 Handle failures

Right-click each WhatsApp module → **Add error handler** → choose **Break**.

Inside the error handler, add another HTTP module identical to 3.6 but with
`"status": "failed"` and `"error": "{{error.message}}"`.

Then scenario settings (bottom bar → *Settings*):

- **Allow storing of Incomplete Executions**: ON — this is what makes `Break`
  queue the run for retry instead of discarding it.
- **Sequential processing**: ON — so two simultaneous events can't both slip
  past the dedupe check.
- **Number of consecutive errors**: 3.

Retry the queue from *Scenario → Incomplete executions* after fixing whatever
broke.

---

## Step 4 — go live

1. **Test with nothing real:**

   ```bash
   npm run test-make -- --phone=9XXXXXXXXX --event=all
   ```

   Five runs appear in Make's History, all stopping at the `env` filter. That
   proves the webhook, the secret and the payload mapping.

2. **Test for real** (a message will arrive on that handset):

   ```bash
   npm run test-make -- --phone=9XXXXXXXXX --event=payment.received --real
   ```

   In Meta's test mode, only numbers added as verified recipients receive
   anything.

3. **Turn the scenario ON** (the toggle at bottom-left). A scenario that is off
   returns 404 and every message is lost.

4. **Set the two variables in Vercel** → Settings → Environment Variables →
   Production:

   ```
   MAKE_WEBHOOK_URL
   MAKE_WEBHOOK_SECRET
   ```

   Redeploy. Also confirm `NEXT_PUBLIC_APP_URL=https://bishertalks.com` — every
   link inside every message is built from it.

5. **Apply the migration**: run `supabase/migrations/0014_notification_log.sql`
   in the Supabase SQL editor. Without it nothing sends — the app claims the
   log row before it sends.

6. **Watch the first ~20 orders**: admin → order → *WhatsApp messages*, and
   Make → History.

---

## Day-to-day

**Change the words in a message** — open the scenario, click the WhatsApp
module, edit. (With Meta direct the text lives in the approved template, so a
wording change means re-submitting it there; with a BSP it depends on their
console.) No deploy either way.

**A customer says they got nothing** — admin → the order → *WhatsApp messages*:

| Dot | Meaning | Do |
|---|---|---|
| 🟢 delivered | Make sent it and the provider accepted it | Check they're looking at the right number |
| 🟠 handed to Make | We posted it, no callback yet | Open Make → History; the run is probably queued or the callback (3.6) is missing |
| 🔴 failed | The error text is on the row | Fix, then retry from *Incomplete executions* |
| ⚪ not configured | `MAKE_WEBHOOK_URL` was empty when it fired | Set it, then re-send |
| *nothing listed* | No event was ever raised — the order has no phone number, or it never reached that stage | |

**Re-send a message manually:**

```bash
curl -X POST https://bishertalks.com/api/notify/send \
  -H "Content-Type: application/json" \
  -H "x-internal-secret: $INTERNAL_API_SECRET" \
  -d '{"order_number":"ORD-7YK955","event_type":"shipped","resend":true}'
```

`resend: true` is required — without it the duplicate guard turns it into a
no-op, by design.

**Turn all WhatsApp off in a hurry** — toggle the scenario off in Make. Orders,
payments and course access are unaffected; messages simply stop.

---

## Things that will bite

- **The 24-hour rule.** WhatsApp only allows free-form text within 24 hours of
  the customer messaging you first. Everything the business starts must be an
  approved template. This is a WhatsApp platform rule — no provider, and no
  amount of Make, changes it.
- **A template created as `en_US` will not send** when the module asks for
  `en`. Same name, different language, "template not found".
- **Variable count must match exactly.** Four variables in the template, four
  mapped fields.
- **The scenario must be ON.** Off = 404 = message lost. There is no queue in
  front of it.
- **The webhook URL is a password.** Never put it in a screenshot, an issue, or
  a chat message.
- **Make's execution history stores the payload**, which contains customer phone
  numbers and addresses. Set the scenario's data retention to a short window
  (7 days).
- **Only Indian numbers work** as written — everything is normalised to
  `+91` + 10 digits.

---

## How the code side works

You do not need this to operate the scenario, but it is where to look when
something is wrong below Make.

| File | Role |
|---|---|
| `lib/make.ts` | Posts events to the webhook. One retry, 8s timeout, never throws |
| `lib/notify.ts` | Builds the event payload from an order; owns idempotency keys |
| `lib/db/notifications.ts` | The `notification_log` table — claim, mark, list |
| `app/api/notify/send/route.ts` | HTTP entry point + manual re-send |
| `app/api/notify/callback/route.ts` | Make reports delivery results here |
| `supabase/migrations/0014_notification_log.sql` | The log table |
| `scripts/test-make.mjs` | `npm run test-make` |

**What fires when**

| Event | Trigger |
|---|---|
| `payment.received` | Payment confirmed and we have no address yet — `/api/orders/verify` and the Razorpay webhook |
| `order.confirmed` | Address submitted on a paid order — `/api/orders/address` (or payment confirmed when an address already exists) |
| `order.shipped` | Admin sets status to shipped |
| `order.delivered` | Admin sets status to delivered |
| `course.access` | Any single course-access grant |

**Bulk CSV import deliberately sends nothing.** It grants access in a loop; a
few hundred accidental messages cannot be recalled. If you want to message an
imported batch, that should be a separate, deliberate action.

**Duplicate sends are guarded twice.** `/api/orders/verify` and the Razorpay
webhook race each other on every payment; only the one that wins the atomic
`pending → paid` claim raises the event, and `notification_log.event_id` rejects
the other regardless.

**Failures never block anything.** A Make outage, an unset webhook URL or a
rejected template cannot fail a payment, a course grant or a status update.

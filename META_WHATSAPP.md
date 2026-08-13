# WhatsApp messages — Meta Cloud API

Automated customer messages are sent by this app, directly to Meta's WhatsApp
Cloud API. No Make.com, no BSP, no third party holding the copy.

This replaces `MAKE_WHATSAPP.md`. The Make path still exists behind a flag so a
bad day is a rollback rather than an outage — see [Cutover](#step-6--cutover)
and [Rollback](#rollback).

Everything the customer receives is in **Malayalam**, and the exact wording
lives in `lib/whatsapp-templates.ts`.

---

## What actually happens

```
payment verified / parcel shipped / course granted
        ↓
lib/notify.ts          claims an idempotency key in notification_log
        ↓
lib/whatsapp-templates.ts   picks the template and fills its blanks
        ↓
lib/whatsapp.ts        POST graph.facebook.com/<version>/<phone-id>/messages
        ↓
Meta                   returns a message id (wamid…)  → row marked 'sent'
        ↓
/api/webhook/whatsapp  receives sent → delivered → read (or failed + a code)
```

Five messages, one per event. Nothing else is ever sent automatically.

| Event | Template | When |
|---|---|---|
| `payment_received` | `payment_received` | Paid, no delivery address yet |
| `confirmed` | `order_confirmed` | Paid and the address is in |
| `shipped` | `order_shipped` | Marked shipped in the portal or the queue |
| `delivered` | `order_delivered` | Marked delivered |
| `course_access` | `course_access` | The bonus NLP course is unlocked |

To read them as a customer would:

```bash
npm run whatsapp:templates          # check — prints every message, filled in
```

---

## Before you start — three things that will not change

**1. The sending number can never be used in the WhatsApp app again.**
Once a number is registered on the Cloud API, it is an API number: no WhatsApp
Business app, no WhatsApp Web, no replying from a phone. Use a **new number**,
not `+91 6282680794` — that one stays on the app for the manual Malayalam
messages your team sends from the Orders and Delivery screens, which are
unaffected by any of this.

The number must also not be registered on WhatsApp at all right now. If it is,
delete that WhatsApp account first and wait a few minutes.

**2. You cannot send free text.** A business-initiated message must match a
template Meta approved in advance. That is why the copy is in the repo and
submitted by script. Free text is only allowed inside 24 hours of the customer
messaging you — we do not use that yet (the webhook logs inbound messages and
ignores them).

**3. There is a sending limit, and it starts low.** A new, unverified business
can start ~250 business-initiated conversations per 24 hours. It rises as
volume and quality hold up. At ~110 orders a day you will feel this — complete
business verification early.

---

## Step 1 — accounts

1. **Meta Business account** — business.facebook.com. Use the one that already
   runs the ad account if there is one.
2. **Business verification** — Business Settings → Security Centre → Start
   verification. Needs a document showing the business name and address (GST
   certificate, incorporation certificate, utility bill). Takes days, sometimes
   longer. **Start this first**, everything else can proceed while it runs.
3. **Developer app** — developers.facebook.com → My Apps → Create App → type
   **Business** → add the **WhatsApp** product.

Adding WhatsApp creates a **WhatsApp Business Account (WABA)** and gives you a
free **test number** immediately. That test number can message up to 5
recipients you add by hand — enough to see the whole flow working before the
real SIM exists. Use it.

## Step 2 — the phone number

WhatsApp Manager → **API Setup** → *Add phone number*.

- A new SIM, reachable for the SMS or call verification code.
- Set the **display name** — it must relate to the business or Meta rejects it.
  "Bisher Talks" is fine; "Neuro Code Offers" would not be.
- Verify with the code.

Then copy two ids from that same page:

- **Phone number ID** — a long number, *not* the phone number itself.
- **WhatsApp Business Account ID** — the WABA id.

## Step 3 — a token that doesn't expire

The token on the API Setup page lasts 24 hours. It is for testing only; using
it in production means messages silently stop tomorrow morning.

Business Settings → **Users → System users** → Add:

1. Name it (`bishertalks-api`), role **Admin**.
2. **Add assets** → your app *and* the WhatsApp account → full control.
3. **Generate new token** → pick the app → expiry **Never** → tick:
   - `whatsapp_business_messaging` — sending
   - `whatsapp_business_management` — submitting templates
4. Copy it now. It is shown once.

## Step 4 — environment

```bash
WHATSAPP_PROVIDER=meta              # 'make' to fall back; unset = meta if the token exists
WHATSAPP_TOKEN=EAAG…                # the permanent System User token
WHATSAPP_PHONE_NUMBER_ID=1234567890 # API Setup page
WHATSAPP_WABA_ID=1234567890         # only needed to submit templates
WHATSAPP_APP_SECRET=…               # App Settings → Basic → App Secret
WHATSAPP_VERIFY_TOKEN=…             # any string you invent; also pasted in step 5
WHATSAPP_API_VERSION=v21.0          # optional; bump when Meta deprecates one
```

Check them:

```bash
npm run check-env
```

`WHATSAPP_APP_SECRET` is not optional in practice — the webhook rejects
unsigned payloads, so without it no delivery receipt is ever recorded and every
message sits at "sent to WhatsApp" forever.

## Step 5 — the webhook

App dashboard → WhatsApp → **Configuration** → Webhook → Edit:

- **Callback URL**: `https://www.bishertalks.com/api/webhook/whatsapp`
- **Verify token**: the `WHATSAPP_VERIFY_TOKEN` from step 4.

Meta calls the URL immediately and expects the challenge echoed back; the route
does that. Then **subscribe to the `messages` field** — this one field carries
both inbound customer messages and the delivery receipts for ours. Without the
subscription, statuses never arrive.

The URL must be deployed before you click verify. Localhost will not work.

## Step 6 — templates

```bash
npm run whatsapp:templates          # check  — validate and preview
node scripts/whatsapp-templates.ts push     # submit all five to Meta
node scripts/whatsapp-templates.ts list     # approval status
```

`push` only creates what is missing; it never overwrites an approved template.
Approval is usually minutes. **A template in review cannot send** — `list`
until all five say `APPROVED`.

Changing wording later means editing the template in WhatsApp Manager (it
returns to review) or submitting a new name. The old version keeps sending
until the new one is approved, so a typo fix is never an outage.

## Step 7 — cutover

1. Deploy with `WHATSAPP_PROVIDER=make` still set. Nothing changes yet.
2. Confirm all five templates are `APPROVED`.
3. Place a real ₹1 test order, or use the test number with your own phone
   added as a recipient.
4. Flip `WHATSAPP_PROVIDER=meta` and redeploy.
5. Watch the next few orders on the order detail page — the WhatsApp messages
   panel should walk from *sent to WhatsApp* → *delivered to phone* → *read by
   customer*.

### Rollback

Set `WHATSAPP_PROVIDER=make` and redeploy. The Make scenario is untouched and
picks up from the next event. Nothing in the log or the database needs undoing.

---

## Things that will bite

- **"Template name does not exist in the translation"** — the template exists
  in `en_US` but the code asks for `ml`. Same name, different language, no
  send. `list` calls this out explicitly.
- **Parameter count mismatch** — the approved template has four variables, the
  code sent five. `npm run whatsapp:templates` catches this before Meta does.
- **Empty parameter** — Meta rejects a blank variable, which is why the shipped
  message carries no courier or tracking number: those fields are usually empty
  when a parcel is marked shipped. Every value gets a fallback in
  `lib/notify.ts`; "—" showing up in a message means a field was missing.
- **A newline inside a parameter** — also rejected. `sanitiseParam` in
  `lib/whatsapp.ts` flattens them; do not bypass it.
- **Token expired (code 190)** — someone used the 24-hour testing token. Go
  back to step 3.
- **Quality rating drops** — Meta shows it per number in WhatsApp Manager. It
  falls when people block or report you. Utility messages about a real order
  rarely cause it; anything that reads like marketing does.
- **Sending limit** — see step 3 of "Before you start". A batch of fifty
  "shipped" messages counts as fifty conversations.
- **Cost** — utility conversations are billed per 24-hour window per customer,
  at Meta's India rate. Cheap, but not free at 100+ orders a day; check the
  current rate card rather than trusting a number written here.

## Where the code lives

| File | Job |
|---|---|
| `lib/whatsapp.ts` | The Cloud API call, error codes, parameter sanitising |
| `lib/whatsapp-templates.ts` | The five Malayalam messages and their variables |
| `lib/notify-events.ts` | The event list, shared by everything |
| `lib/notify.ts` | Claims the idempotency key, picks the provider, logs |
| `lib/db/notifications.ts` | The log, and the rule that a receipt only moves forward |
| `app/api/webhook/whatsapp/route.ts` | Verification handshake and delivery receipts |
| `scripts/whatsapp-templates.ts` | Validate, submit and inspect templates |
| `supabase/migrations/0025_*.sql` | The delivered/read states and the failure code |

Nothing in the send path throws. A rejected template, an expired token or a
Meta outage can never fail a payment, a course grant or a status update — the
message is logged as failed and the order carries on.

# WhatsApp automatic messages — setup

The code is done. What's left is Meta-side setup plus **four message templates
that Meta must approve** (usually a few hours, sometimes 1–2 days).

Submit all four together — approval is per-template, so a missed one means
waiting again.

---

## 1. Meta side

1. **Meta Business Suite** → verify the business.
2. Create a **WhatsApp Business Account (WABA)**.
3. **Add a phone number.** It must *not* be active on the normal WhatsApp or
   WhatsApp Business app. If it is, delete that account first — otherwise
   registration fails and the number can be stuck for days. Use a number you
   don't need for anything else.
4. Copy the **Phone Number ID** (a long numeric id, *not* the phone number)
   → `WHATSAPP_PHONE_NUMBER_ID`.
5. Create a **permanent token**:
   Business Settings → **System Users** → add a system user (Admin) →
   *Add Assets* → assign the WABA → **Generate token** with
   `whatsapp_business_messaging` + `whatsapp_business_management`, expiry
   **Never** → `WHATSAPP_TOKEN`.

   ⚠️ The token shown on the *API Setup* page **expires in 24 hours**. It's the
   single most common reason WhatsApp "works and then stops overnight". Only a
   System User token is permanent.

## 2. Templates to submit

Create under WhatsApp Manager → **Message Templates**.

For every one of these:

- **Category: Utility** — these are transactional. Picking *Marketing* costs
  more and is rejected more often.
- **Language: English** — the code sends `language: { code: "en" }`. If you
  create the template as *English (US)* (`en_US`) the send fails with a
  template-not-found error. This trips up almost everyone.
- **Put variables in the BODY only.** The code sends a single `body` component.
  If you add a URL button with a variable in it, Meta expects a `button`
  component too and the send will fail. Plain (non-variable) buttons are fine.
- Variable order matters — it must match exactly what's listed below.

### `order_confirmed` — 6 variables

Sent automatically when payment is confirmed (from both the browser handler and
the Razorpay webhook).

```
Hi {{1}}, your order is confirmed! 🎉

Order number: {{2}}
Amount paid: ₹{{3}}
Delivering to: {{4}}
Expected: {{5}}

Track your order here: {{6}}
```

| # | Value | Sample for Meta |
|---|---|---|
| 1 | Buyer name | Bisher |
| 2 | Order number | ORD-7YK955 |
| 3 | Amount in ₹ | 599 |
| 4 | City, State | Kochi, Kerala |
| 5 | Delivery estimate | 5–7 business days |
| 6 | Tracking URL | https://bishertalks.com/neuro-code/track?id=ORD-7YK955 |

### `order_shipped` — 6 variables

Sent when an admin sets the order status to *shipped*.

```
Good news {{1}} — your order {{2}} has shipped! 📦

Courier: {{3}}
Tracking number: {{4}}
Expected delivery: {{5}}

Track it here: {{6}}
```

| # | Value | Sample |
|---|---|---|
| 1 | Buyer name | Bisher |
| 2 | Order number | ORD-7YK955 |
| 3 | Courier | BlueDart |
| 4 | Tracking number | 1234567890 |
| 5 | Expected date | 12 Aug 2026 |
| 6 | Tracking URL | https://bishertalks.com/neuro-code/track?id=ORD-7YK955 |

### `order_delivered` — 3 variables

Sent when an admin sets the order status to *delivered*.

```
Hi {{1}}, your order {{2}} has been delivered ✅

We hope you enjoy Neuro Code. Explore more here: {{3}}
```

| # | Value | Sample |
|---|---|---|
| 1 | Buyer name | Bisher |
| 2 | Order number | ORD-7YK955 |
| 3 | Site URL | https://bishertalks.com/neuro-code |

### `course_access` — 4 variables

Sent whenever course access is granted: after a purchase, and when an admin
grants access to a single user. **Not** sent by CSV bulk import (see below).

```
Hi {{1}}, your course is unlocked! 🎓

Course: {{2}}
Start learning: {{3}}

Just enter your mobile number {{4}} on the course page to get in.
```

| # | Value | Sample |
|---|---|---|
| 1 | Name | Bisher |
| 2 | Course title | Neuro Linguistic Programming |
| 3 | Course URL | https://bishertalks.com/courses/nlp |
| 4 | Mobile number | 9876543210 |

## 3. Env vars

Local (`.env.local`) **and** Vercel:

```
WHATSAPP_TOKEN=<system user permanent token>
WHATSAPP_PHONE_NUMBER_ID=<numeric phone number id>
```

`NEXT_PUBLIC_APP_URL` must also be correct on Vercel
(`https://bishertalks.com`) — every link in every message is built from it.

## 4. Test before real orders

```bash
node scripts/test-whatsapp.mjs 9876543210 course_access
```

Sends one real message to that number using sample values. Run it for each of
the four templates once they're approved.

Note WhatsApp's rule: a business-initiated message requires an **approved
template**. Free-form text only works within 24h of the customer messaging you
first — which is why everything here is a template.

---

## What fires when

| Event | Template | Trigger |
|---|---|---|
| Payment confirmed | `order_confirmed` | `/api/orders/verify` + Razorpay webhook |
| Course unlocked | `course_access` | any single course-access grant |
| Marked shipped | `order_shipped` | admin order status update |
| Marked delivered | `order_delivered` | admin order status update |

**Bulk CSV import deliberately does not send.** It grants access in a loop, and
with a few hundred rows an accidental run would fire a few hundred messages with
no way to recall them. If you want to notify an imported batch, do it
deliberately rather than as a side effect of importing — ask and I'll add an
explicit "notify these users" action with a confirmation step.

## Gotchas worth knowing

- **Duplicate sends are already guarded.** `verify` and the webhook race each
  other on payment; only the one that wins the atomic `pending → paid` claim
  sends the message, so the customer never gets two.
- **WhatsApp failures never block anything.** `sendWhatsApp` logs and returns
  instead of throwing — a template typo can't cost you a payment or a course
  grant.
- **Check the logs for `[WhatsApp] Send failed:`** — Meta returns a precise
  reason (wrong language, param count mismatch, template not approved).
- **Phone format**: messages go to `91` + 10 digits. Only Indian numbers work
  as written.

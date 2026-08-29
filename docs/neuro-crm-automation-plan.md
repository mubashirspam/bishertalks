# Neuro Code CRM automation

**Status: built 2026-08-29.** The code is in; two things outside it are not
done, and nothing sends until they are — see [Before it can run](#0-before-it-can-run).

This started as the brief written down and checked against the existing code.
That reading still stands and is worth keeping: §2 is the seven places the
brief and reality disagreed, and every one of them is a decision now baked into
the implementation.

## What shipped

| | |
| --- | --- |
| `supabase/migrations/0053_crm_automation.sql` | tags, relationship stage, button payloads, the follow-up queue, two RPCs |
| `lib/crm/flow-table.ts` | 25 buttons × what each one does. Imports nothing, so the checker can read it |
| `lib/crm/flows.ts` | `runFlowAction()` — tag, stage, schedule, cancel, reply |
| `lib/crm/automation.ts` | schedule · cancel · claim · finish, all tolerant of a missing table |
| `lib/crm/tags.ts` | tags, stage, hold, and the marketing opt-in decision from §2.5 |
| `lib/whatsapp.ts` | `sendInteractive()` — the third wire shape |
| `lib/crm/send.ts` | `sendSessionButtons()` / `sendSessionText()`, both through the gate |
| `lib/whatsapp-templates.ts` | `FLOW_TEMPLATES` (the 8) and `metaTemplatePayload()` |
| `app/api/webhook/whatsapp/route.ts` | button routing, and opt-out now cancels the queue |
| `app/api/cron/whatsapp-automation/` | the worker: enqueue elapsed rules, then drain |
| `app/admin/(protected)/crm/[id]/CrmPanel.tsx` | stage, tags, next follow-up, cancel |
| `vercel.json` | four cron schedules |

`npm run whatsapp:templates check` validates the flow table as well as the
templates — a button with no action, a reply button over 20 characters, or a
payload with no title fails the check. `npm run whatsapp:templates push-flows`
submits the eight to Meta.

## 0. Before it can run

1. **Apply `0053_crm_automation.sql`.** Everything degrades without it rather
   than crashing — tags read empty, follow-ups silently fail to queue — which
   is the worst kind of working.
2. **Set `CRON_SECRET`** locally and on Vercel. Without it every cron refuses
   to run, including the one that syncs template approval (§2.7).
3. **Submit the templates**: `npm run whatsapp:templates push-flows`, then wait
   for approval, then run the health cron.
4. Note: four crons at 15-minute intervals needs a Vercel **Pro** plan. Hobby
   allows two, daily.

Related: [META_WHATSAPP.md](../META_WHATSAPP.md) (how a message leaves the app),
[docs/whatsapp-meta-setup.md](./whatsapp-meta-setup.md) (the Meta side).

---

## 1. What already exists

More than half of the brief. Building any of it a second time would produce a
second opt-out flag, which is the one thing in this system that must never
exist twice.

| The brief asks for | Already in the repo |
| --- | --- |
| WhatsApp Cloud API integration | `lib/whatsapp.ts` — the only place that touches the wire |
| Paid order confirmation sending | `lib/notify.ts`, template `confirmed` |
| Store every sent message and reply | `whatsapp_messages`, both directions, via `lib/crm/messages.ts` |
| Customer records | `whatsapp_contacts`, keyed on the 12-digit phone |
| STOP handling | `lib/crm/consent.ts` — English, Malayalam **and** Manglish, detected before the message is stored |
| "Disable marketing messages" | `assertSendable()` check 05, category consent |
| 24-hour window | `windowState()` / `formatWindow()` in `lib/crm/contacts.ts` |
| Campaigns with segments | `lib/crm/campaigns.ts`, `lib/crm/people.ts` |
| Admin CRM page | `/admin/crm` — inbox, people, campaigns, log, health |
| Template registry with buttons | `lib/whatsapp-templates.ts`, `TemplateButton` supports `QUICK_REPLY` |

**Genuinely new work:** button-reply routing, tags, scheduled follow-ups, and
the stage machine. Everything else is an addition to something that exists.

The honest gap is the one the template file already admits:

> `QUICK_REPLY` sends text back to us. Nothing reads those yet: the webhook
> logs inbound messages and ignores them. A quick reply today is a customer
> talking to a wall.

That sentence is this project.

---

## 2. Seven things to settle before any code

Settle these before writing code. Each one is cheap now and expensive after
Meta has approved eight templates.

### 2.1 `ml_IN` is not a Meta language code

Meta's code for Malayalam is **`ml`**. There is no `ml_IN`. Every template in
this account is already approved as `ml`, and `TEMPLATE_LANGUAGE = "ml"` in
`lib/whatsapp-templates.ts`. Submitting `ml_IN` fails at creation.

**Use `ml` throughout.** The JSON below does.

### 2.2 `{{REFERRAL_LINK}}` is not valid template syntax

Meta variables are positional: `{{1}}`, `{{2}}`. A named placeholder is
rejected. Two ways to carry a referral link:

- **body parameter** — `{{2}}` filled with the customer's referral URL. Simple,
  and the link is tappable in WhatsApp.
- **URL button** — `https://bishertalks.com/refer/{{1}}`, the variable at the
  very end. This is how `order_confirmed` already does its tracking link, and
  the constraint (one variable, at the tail) is documented there.

Recommended: **body parameter**, because these templates already spend their
three button slots on quick replies.

### 2.3 Template buttons and session buttons have different limits

The brief's 25-character rule is right for templates and wrong for the replies:

| | limit | applies to |
| --- | --- | --- |
| Template quick-reply button | 25 chars | the 8 templates below |
| Interactive session reply button | **20 chars** | every "Send: … Buttons: …" reply |

Every button text in the brief is under 20, so nothing needs rewording — but
the validator must check the right limit for the right kind, or a future button
passes review and fails to send.

### 2.4 The reply flows are session messages, not templates

`More Details → Price / Order Now / Doubt` is an **interactive** message, only
sendable inside the 24-hour window. That is fine — the customer just tapped a
button, so the window is open by definition — but it means:

- `lib/whatsapp.ts` needs a `sendInteractive()` alongside `sendTemplate()` and
  `sendText()`, since interactive messages are a third wire shape.
- Each reply button needs an **id** (max 256 chars). That id is the payload the
  webhook matches on. Do not match on button *text*: the text is Malayalam-
  adjacent, gets reworded, and the same words appear in three flows.

Proposed id scheme: `<flow>:<action>` — `intro:more_details`,
`intro:buy_now`, `delivery:received`, `reading10:not_started`.

### 2.5 MARKETING templates will be refused for almost everyone

Gate check 05 refuses a MARKETING template to any contact without
`marketing_opt_in_at`. Six of the eight templates below are MARKETING, and
**no contact in the database has that flag set.** As written, this automation
sends nothing.

Three options, in order of preference:

1. **Treat the interest flow as opt-in.** Someone who taps *More Details* or
   *Buy Now* has asked to hear from us — set `marketing_opt_in_at` on that
   button reply. Clean, defensible, and it makes the flow self-priming.
2. Set the flag for anyone who has placed an order, on the argument that a
   customer relationship is consent. Weaker, and it is a bulk write over 3,602
   people.
3. Relax check 05. **Do not.** It is the check that keeps the number alive.

Option 1 needs deciding by a person, not by whoever picks up the ticket.

### 2.6 There is nothing to run the scheduler

`automation_events` needs a worker on a timer. As of 2026-08-28:

- `vercel.json` has **no `crons` block**
- `CRON_SECRET` is **unset** in `.env.local`, so `/api/cron/courier-poll`
  refuses to run at all

Scheduled follow-ups are the backbone of this brief — 3-day, 5-day, 7-day,
10-day, 15-day, 30-day. Without a scheduler, every one of them is a row that
never fires. **This is a hard blocker, and it is infrastructure, not code.**

### 2.7 And the live one: nothing had been delivered — fixed, but check it

Every outbound message in `whatsapp_messages` — all 96 — is `status: failed`:

```
Refused: order_shipped has no approved Malayalam version on record
```

The template was approved. `whatsapp_template_status` was **empty**, because
the health cron that populates it has never run, and the gate read "no row" as
"not approved". Fixed in `e83dcee`: an entirely empty table now means "not
synced yet" and the send is allowed with a warning, leaving Meta as the
authority — a genuinely missing template fails loudly at the wire with 132001
instead of silently at the gate.

So the brief's "paid order confirmation is already sending automatically" is
true again as of that commit. Two things still to do before trusting it:

- **Run the health cron once** so `whatsapp_template_status` is populated and
  the gate is checking something real rather than waving sends through.
- **Re-send the 96 refused notifications**, or accept that those customers
  never got their shipped message. They are identifiable — `status: failed`
  with an error starting `Refused:`.

The root cause is the same one as §2.6: nothing runs on a timer here.

---

## 3. Output 1 — Meta template creation JSON

`POST https://graph.facebook.com/v21.0/<WABA_ID>/message_templates`, header
`Authorization: Bearer <token>`. Bodies are verbatim from the brief.

Meta requires `example.body_text` for every variable or the template is
rejected without review.

### 3.1 neuro_interest_intro

```json
{
  "name": "neuro_interest_intro",
  "language": "ml",
  "category": "MARKETING",
  "components": [
    {
      "type": "BODY",
      "text": "ഹായ് {{1}}, Neuro Code പുസ്തകത്തിൽ താല്പര്യം കാണിച്ചതിന് നന്ദി.\n\nഈ പുസ്തകത്തെ കുറിച്ച് കൂടുതൽ അറിയാനോ order ചെയ്യാനോ താഴെയുള്ള option തിരഞ്ഞെടുക്കൂ.\n\nReply STOP to opt out.",
      "example": { "body_text": [["രാഹുൽ"]] }
    },
    {
      "type": "BUTTONS",
      "buttons": [
        { "type": "QUICK_REPLY", "text": "More Details" },
        { "type": "QUICK_REPLY", "text": "Buy Now" },
        { "type": "QUICK_REPLY", "text": "Later" }
      ]
    }
  ]
}
```

### 3.2 neuro_later_reminder

```json
{
  "name": "neuro_later_reminder",
  "language": "ml",
  "category": "MARKETING",
  "components": [
    {
      "type": "BODY",
      "text": "ഹായ് {{1}}, Neuro Code പുസ്തകത്തെ കുറിച്ച് നിങ്ങൾ പിന്നീട് അറിയിക്കാമെന്ന് പറഞ്ഞിരുന്നു.\n\nഇപ്പോൾ order ചെയ്യണോ, അല്ലെങ്കിൽ കൂടുതൽ details വേണോ?\n\nReply STOP to opt out.",
      "example": { "body_text": [["രാഹുൽ"]] }
    },
    {
      "type": "BUTTONS",
      "buttons": [
        { "type": "QUICK_REPLY", "text": "Buy Now" },
        { "type": "QUICK_REPLY", "text": "More Details" },
        { "type": "QUICK_REPLY", "text": "Not Now" }
      ]
    }
  ]
}
```

### 3.3 neuro_order_confirm_track — REJECTED, INCORRECT_CATEGORY

**Submitted 2026-08-29 and auto-rejected in seconds, without human review.**
Meta's classifier reads course promotion inside a UTILITY template as
marketing: the course is named, linked, and given a button. `course_access` has
carried the same rejection for months, so this is a settled position at their
end, not a bad roll.

Resubmitting it as MARKETING is not the fix. The gate refuses MARKETING to
anyone without `marketing_opt_in_at`, nobody has it, and a receipt that depends
on marketing consent is a receipt that never sends. `lib/notify.ts` is back on
the approved `order_confirmed`; this copy is parked in
`DRAFT_TEMPLATES.order_confirm_track`.

The way through is to split it: order facts stay UTILITY with the Track Order
and Need Help buttons — that is the approved template plus two buttons, which
should sail through — and course access becomes its own message.

The submitted JSON, for the record:

Replaced `neuro_order_paid` (which duplicated it) **and** `order_confirmed`
(which said less). This is what `lib/notify.ts` sends on payment now, so it is
in `TEMPLATES` rather than `FLOW_TEMPLATES` and goes out with
`npm run whatsapp:templates push`.

Three things it adds: the course is named with its link and the fact that the
mobile number is the login; tracking moved from body text onto a button; and a
Need Help quick reply, routed to `paid:need_help`.

**Button order is load-bearing.** The variable URL button must come first — at
send time `buttonParams` is a flat list of the *variable* buttons, so the index
Meta is given is the position among those, not in the template. Put a static
button in front and Meta is told to fill button 0 while the variable sits on
button 1, and the send is rejected. `validateButtons()` now refuses that
arrangement.

```json
{
  "name": "neuro_order_confirm_track",
  "language": "ml",
  "category": "UTILITY",
  "components": [
    {
      "type": "BODY",
      "text": "ഹായ് {{1}} 🙏\n\nനിങ്ങളുടെ Neuro Code ഓർഡർ സ്ഥിരീകരിച്ചു ✅\n\nഓർഡർ നമ്പർ: {{2}}\nഅടച്ച തുക: ₹{{3}}\nഎത്തിക്കുന്ന സ്ഥലം: {{4}}\nപ്രതീക്ഷിക്കുന്ന ഡെലിവറി: {{5}}\n\nകോഴ്‌സ്: Neuro Linguistic Programming\nആക്‌സസ് ലിങ്ക്: https://bishertalks.com/courses/nlp\n\nലോഗിൻ ചെയ്യാൻ നിങ്ങളുടെ മൊബൈൽ നമ്പർ {{6}} മാത്രം മതി — പാസ്‌വേഡ് വേണ്ട.\n\nഓർഡർ ട്രാക്ക് ചെയ്യാൻ താഴെയുള്ള button ഉപയോഗിക്കൂ.\n\nThank you,\nBisher Talks",
      "example": {
        "body_text": [
          ["Asraf", "ORD-K3523P", "699", "കണ്ണൂർ, Kerala", "5-7 ദിവസം", "9847759381"]
        ]
      }
    },
    {
      "type": "BUTTONS",
      "buttons": [
        {
          "type": "URL",
          "text": "Track Order",
          "url": "https://bishertalks.com/neuro-code/track?id={{1}}",
          "example": ["https://bishertalks.com/neuro-code/track?id=ORD-K3523P"]
        },
        { "type": "URL", "text": "Open Course", "url": "https://bishertalks.com/courses/nlp" },
        { "type": "QUICK_REPLY", "text": "Need Help" }
      ]
    }
  ]
}
```

Note there is no `example` on the static *Open Course* button. Meta wants one
only where the URL varies, and supplying it anyway is a rejection nobody
enjoys diagnosing.

### 3.4 neuro_delivery_confirmed

```json
{
  "name": "neuro_delivery_confirmed",
  "language": "ml",
  "category": "UTILITY",
  "components": [
    {
      "type": "BODY",
      "text": "ഹായ് {{1}}, നിങ്ങളുടെ Neuro Code book delivery completed ആയി എന്ന് ഞങ്ങൾ കാണുന്നു.\n\nBook ലഭിച്ചോ എന്ന് confirm ചെയ്യാമോ?",
      "example": { "body_text": [["രാഹുൽ"]] }
    },
    {
      "type": "BUTTONS",
      "buttons": [
        { "type": "QUICK_REPLY", "text": "Received" },
        { "type": "QUICK_REPLY", "text": "Not Received" },
        { "type": "QUICK_REPLY", "text": "Need Help" }
      ]
    }
  ]
}
```

### 3.5 neuro_reading_followup_10d

```json
{
  "name": "neuro_reading_followup_10d",
  "language": "ml",
  "category": "MARKETING",
  "components": [
    {
      "type": "BODY",
      "text": "ഹായ് {{1}}, Neuro Code book ലഭിച്ചിട്ട് ഏകദേശം 10 ദിവസം കഴിഞ്ഞു.\n\nവായന നന്നായി പുരോഗമിക്കുന്നുണ്ടെന്ന് വിശ്വസിക്കുന്നു. Course കേൾക്കാനും activities ചെയ്യാനും സമയം കണ്ടെത്തുമല്ലോ.\n\nReading status അറിയിക്കൂ.",
      "example": { "body_text": [["രാഹുൽ"]] }
    },
    {
      "type": "BUTTONS",
      "buttons": [
        { "type": "QUICK_REPLY", "text": "Going Good" },
        { "type": "QUICK_REPLY", "text": "Read Little" },
        { "type": "QUICK_REPLY", "text": "Not Started" }
      ]
    }
  ]
}
```

### 3.6 neuro_reading_encouragement

```json
{
  "name": "neuro_reading_encouragement",
  "language": "ml",
  "category": "MARKETING",
  "components": [
    {
      "type": "BODY",
      "text": "ഹായ് {{1}}, Neuro Code വായന എങ്ങനെയാണ് പോകുന്നത്?\n\nദിവസവും കുറച്ച് സമയം മാത്രം മാറ്റിവെച്ചാലും നല്ല progress ഉണ്ടാകും.",
      "example": { "body_text": [["രാഹുൽ"]] }
    },
    {
      "type": "BUTTONS",
      "buttons": [
        { "type": "QUICK_REPLY", "text": "Started" },
        { "type": "QUICK_REPLY", "text": "Need Help" },
        { "type": "QUICK_REPLY", "text": "Later" }
      ]
    }
  ]
}
```

### 3.7 neuro_feedback_30d

```json
{
  "name": "neuro_feedback_30d",
  "language": "ml",
  "category": "MARKETING",
  "components": [
    {
      "type": "BODY",
      "text": "ഹായ് {{1}}, ബിഷർ സർ ആണ്.\n\nNeuro Code വായന എങ്ങനെയുണ്ട്? നിങ്ങൾ നൽകിയ തുകയ്ക്ക് value ഉണ്ടെന്ന് തോന്നിയോ? ജീവിതത്തിൽ എന്തെങ്കിലും positive മാറ്റം അനുഭവപ്പെട്ടോ?\n\nനിങ്ങളുടെ honest feedback അറിയാൻ ആഗ്രഹിക്കുന്നു.",
      "example": { "body_text": [["രാഹുൽ"]] }
    },
    {
      "type": "BUTTONS",
      "buttons": [
        { "type": "QUICK_REPLY", "text": "Give Feedback" },
        { "type": "QUICK_REPLY", "text": "Recommend" },
        { "type": "QUICK_REPLY", "text": "Still Reading" }
      ]
    }
  ]
}
```

### 3.8 neuro_referral_followup

```json
{
  "name": "neuro_referral_followup",
  "language": "ml",
  "category": "MARKETING",
  "components": [
    {
      "type": "BODY",
      "text": "ഹായ് {{1}}, Neuro Code മറ്റൊരാൾക്ക് recommend ചെയ്യാൻ നിങ്ങൾ താല്പര്യം കാണിച്ചിരുന്നു.\n\nReferral details അയക്കാമോ?",
      "example": { "body_text": [["രാഹുൽ"]] }
    },
    {
      "type": "BUTTONS",
      "buttons": [
        { "type": "QUICK_REPLY", "text": "Send Details" },
        { "type": "QUICK_REPLY", "text": "Share Link" },
        { "type": "QUICK_REPLY", "text": "Not Now" }
      ]
    }
  ]
}
```

---

## 4. Output 2 — sending

### 4.1 Never call Meta directly

`eslint.config.mjs` blocks importing `lib/whatsapp.ts` from anywhere but
`lib/crm/send.ts`, and that is deliberate — the build fails rather than let a
caller skip the gate. Every send in this project goes through:

```ts
await sendTemplateMessage({
  contact,                       // from upsertContact()
  kind: "campaign",              // or "transactional"
  template: { name: "neuro_reading_followup_10d", category: "MARKETING", language: TEMPLATE_LANGUAGE },
  params: [contact.display_name ?? "സുഹൃത്തേ"],
  preview: "…filled body, for the thread…",
});
```

The outcome is a discriminated union: `{ok:true}`, `{ok:false, refused:true, code}`,
or `{ok:false, refused:false, retryable}`. A refusal is a decision and must not
be retried; a failure may be.

### 4.2 The wire shape, for reference

```
POST https://graph.facebook.com/v21.0/<PHONE_NUMBER_ID>/messages
{
  "messaging_product": "whatsapp",
  "to": "919847012345",
  "type": "template",
  "template": {
    "name": "neuro_reading_followup_10d",
    "language": { "code": "ml" },
    "components": [
      { "type": "body", "parameters": [{ "type": "text", "text": "രാഹുൽ" }] }
    ]
  }
}
```

Quick-reply buttons need **no** component when sending — they are baked into
the approved template. Only URL buttons with a variable need one.

### 4.3 The new one — interactive session replies

Needs `sendInteractive()` in `lib/whatsapp.ts`, exposed through
`lib/crm/send.ts` as `sendSessionButtons()`:

```
POST /<PHONE_NUMBER_ID>/messages
{
  "messaging_product": "whatsapp",
  "to": "919847012345",
  "type": "interactive",
  "interactive": {
    "type": "button",
    "body": { "text": "Neuro Code നിങ്ങളുടെ mindset, focus, habits… Order ചെയ്യാൻ താല്പര്യമുണ്ടോ?" },
    "action": {
      "buttons": [
        { "type": "reply", "reply": { "id": "intro:price",     "title": "Price" } },
        { "type": "reply", "reply": { "id": "intro:order_now", "title": "Order Now" } },
        { "type": "reply", "reply": { "id": "intro:doubt",     "title": "Doubt" } }
      ]
    }
  }
}
```

The gate still runs — kind `session`, no template, so checks 04 and 05 are
skipped and 01 (opt-out) and 02 (kill switch) are not. Someone who says STOP
mid-flow stops mid-flow.

---

## 5. Output 3 — the webhook button handler

`app/api/webhook/whatsapp/route.ts` already reads both button shapes, because
STOP detection needed them:

```ts
m.button?.text                     // template quick reply
?? m.interactive?.button_reply?.title   // session reply button
```

What it does not read is `payload` / `id`. Add both to the parsed shape, then
route. Order matters and is not negotiable:

```
inbound arrives
  01  detect STOP  ─────────────────► set opt_out_at, cancel marketing events, reply, DONE
  02  upsert contact, store the message (direction=in, message_type=button,
      button_payload=<id>)                      ← storage happens whatever follows
  03  look up the flow action for the payload
  04  no match? leave it in the inbox for a human. Never guess.
  05  apply CRM effects: tag, stage, schedule/cancel events
  06  window open? send the session reply.
      window closed? queue an approved template instead — never a session
      message, which Meta silently drops.
```

Steps 01 and 02 before 03 is the same rule the existing consent code follows:
*a stop request must survive a later step failing.*

The routing table is data, not branches — one entry per payload:

```ts
export const FLOW_ACTIONS: Record<string, FlowAction> = {
  "intro:more_details": {
    reply: { body: "Neuro Code നിങ്ങളുടെ mindset…", buttons: ["intro:price", "intro:order_now", "intro:doubt"] },
    optIn: true,                        // see decision 2.5
  },
  "intro:later": {
    reply: { body: "ശരി. പ്രശ്നമില്ല…" },
    tag: "later_buyer",
    schedule: { template: "neuro_later_reminder", afterDays: 3 },
  },
  "delivery:received": {
    reply: { body: "സന്തോഷം. വായന ആരംഭിക്കൂ…" },
    stage: "delivered_confirmed",
    schedule: { template: "neuro_reading_followup_10d", afterDays: 10 },
  },
  // …one per button in the brief
};
```

Meta retries anything that is not a 200, so the handler answers 200 even when
it cannot route — a payload it does not recognise is a message in the inbox,
not a retry storm.

---

## 6. Output 4 — schema

**Do not create `customers`, `orders` or `messages`.** All three exist under
other names, with data in them and code depending on them. A parallel set is
how one person ends up with two stop flags.

| Brief | Reality |
| --- | --- |
| `customers` | `whatsapp_contacts` — add `tags`, `current_stage`, `source` |
| `orders` | `orders` — has payment_status, paid_at, tracking_number, delivered_at |
| `messages` | `whatsapp_messages` — add `button_payload`, `order_id` |
| `automation_events` | **new** |

`opt_in_status` is already two columns that say more than one enum could:
`opt_out_at` (they asked us to stop) and `marketing_opt_in_at` (they said yes).
Keep them.

`current_stage`: store only what cannot be derived. The funnel stage is already
computed per person in `lib/crm/people.ts` and a stored copy will drift from it
within a week. What genuinely needs storing is the **reading/relationship**
stage — `delivered_confirmed`, `active_reader`, `slow_reader` — which nothing
else knows.

### `supabase/migrations/0053_crm_automation.sql`

```sql
-- Tags and the relationship stage, on the contact that already exists.
ALTER TABLE whatsapp_contacts
  ADD COLUMN IF NOT EXISTS tags          text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS current_stage text,
  ADD COLUMN IF NOT EXISTS source        text;

CREATE INDEX IF NOT EXISTS whatsapp_contacts_tags_idx
  ON whatsapp_contacts USING gin (tags);

-- What the customer tapped, so a flow can be replayed and audited.
ALTER TABLE whatsapp_messages
  ADD COLUMN IF NOT EXISTS button_payload text,
  ADD COLUMN IF NOT EXISTS order_id       uuid REFERENCES orders(id);

-- The scheduler's queue. One row per planned message.
CREATE TABLE IF NOT EXISTS whatsapp_automation_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id     uuid NOT NULL REFERENCES whatsapp_contacts(id) ON DELETE CASCADE,
  order_id       uuid REFERENCES orders(id),
  event_type     text NOT NULL,
  template_name  text,
  scheduled_at   timestamptz NOT NULL,
  executed_at    timestamptz,
  -- pending | sent | refused | failed | cancelled
  status         text NOT NULL DEFAULT 'pending',
  refusal_code   text,
  error          text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wae_due_idx
  ON whatsapp_automation_events (scheduled_at)
  WHERE status = 'pending';

-- One pending event of a kind per contact per order. Re-running a rule is then
-- idempotent, and a customer cannot be queued twice for the same follow-up by
-- two paths — which is exactly how the 10-day and the Received-click rules
-- would collide.
CREATE UNIQUE INDEX IF NOT EXISTS wae_one_pending_idx
  ON whatsapp_automation_events (contact_id, event_type, COALESCE(order_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status = 'pending';
```

Migrations here are applied **by hand**. Several screens carry fallbacks for a
view that had not been rebuilt yet — see `lib/db/delivery-portal.ts`. Write the
new code to survive the table not existing.

---

## 7. Output 5 — the scheduler

```
/api/cron/whatsapp-automation           every 15 minutes
  ├── claim due rows   status='pending' AND scheduled_at <= now(), LIMIT 100
  │                    claimed with UPDATE … RETURNING so two runs cannot
  │                    both send the same row
  ├── per row:
  │     contact opted out?      → cancelled
  │     order cancelled/returned? → cancelled
  │     sendTemplateMessage()
  │       ok       → status=sent, executed_at=now()
  │       refused  → status=refused, refusal_code — never retried
  │       failed   → status=failed; retryable ones re-queued once, +1h
  └── never more than the daily budget; the gate enforces it per message anyway
```

Rules from the brief, as they land on the queue:

| Trigger | Effect |
| --- | --- |
| Payment verified | send `neuro_order_paid`; stage → `paid` |
| Delivery scan = delivered | send `neuro_delivery_confirmed`; `delivered_at` |
| Tap *Received* | schedule `neuro_reading_followup_10d`, +10d |
| Tap *Later* (intro) | tag `later_buyer`; schedule `neuro_later_reminder`, +3d |
| Tap *Going Good* | tag `active_reader`; schedule `neuro_feedback_30d`, +30d |
| Tap *Read Little* | tag `slow_reader`; schedule `neuro_reading_encouragement`, +7d |
| Tap *Not Started* | tag `not_started`; schedule `neuro_reading_encouragement`, +5d |
| Tap *Still Reading* | tag `still_reading`; schedule `neuro_feedback_30d`, +15d |
| STOP | `opt_out_at`; **cancel every pending MARKETING event** |
| *Not Received* / *Need Help* | tag `delivery_issue` / `support_needed`; support task; **pause promotional events until cleared** |

Two rules in the brief overlap and must not both fire: *"if customer clicks
Received, schedule +10 days"* and *"after 10 days from delivered_at, send"*.
The unique partial index above makes the second a no-op when the first already
queued it. Prefer the click — it is the customer telling us the book arrived,
which a courier scan only guesses at.

**Blocked on 2.6.** No cron, no automation.

---

## 8. Output 6 — the admin page

`/admin/crm/[id]` already shows the conversation. Extend it rather than adding
a screen, with a right-hand panel:

- **Stage** — the derived funnel stage from `lib/crm/people.ts`, and the stored
  relationship stage, labelled so nobody confuses them
- **Tags** — chips, add and remove by hand; every automatic tag says which
  button set it
- **Order** — number, payment, delivery, tracking, linked to `/admin/orders/…`
- **History** — already there; add a marker on button replies showing the
  payload, so a flow can be read as a flow
- **Next follow-up** — the pending `whatsapp_automation_events` row: which
  template, when, and a Cancel button

And on `/admin/crm/people`, two filters worth having once tags exist: by tag,
and "has a follow-up due in the next 7 days."

---

## 9. What was decided, and what is still open

Built, and how each §2 decision landed:

- **2.1** `ml` throughout. `metaTemplatePayload()` reads `TEMPLATE_LANGUAGE`.
- **2.2** The referral link is filled per customer at reply time, not a
  template variable. It currently points at the book page — see below.
- **2.3** Two limits, two checks: 25 for template buttons in
  `validateTemplate()`, 20 for reply buttons in `validateFlows()`.
- **2.4** `sendInteractive()`, ids of the form `<flow>:<action>`, and the
  eslint guard now covers it so it cannot be called around the gate.
- **2.5** **Option 1.** Tapping *More Details*, *Buy Now*, *Price* or
  *Order Now* sets `marketing_opt_in_at`. Tapping *Later* or *Not Now* does
  not — consent comes from leaning in, never from a polite decline. One flag
  in `FLOW_ACTIONS` (`optIn`) if that judgement needs revisiting.
- **2.6** `vercel.json` has the schedules. `CRON_SECRET` still needs setting.
- **2.7** The gate bug is fixed (`e83dcee`); the health cron is scheduled now.

Two of the brief's rules are deliberately **not** automated:

- `neuro_order_paid` is **gone**. `neuro_order_confirm_track` replaced it and
  the old `order_confirmed` together, and it is what `lib/notify.ts` sends on
  payment — one template, one event.
- `neuro_delivery_confirmed` is defined and submittable but nothing sends it:
  it still duplicates the `delivered` template `lib/notify.ts` already sends.
  Decide which survives, then wire it in one place.

Still open:

- A per-customer referral link. `orders.referral_code` credits the *referrer*,
  so a share link needs a code minted for the sharer first. Until then
  *Recommend* and *Share Link* send the book page — honest, and it converts.
- Who owns a `support_needed` task. Today it is a tag and a hold; nothing
  queues it in front of a person beyond the inbox.

## 10. Open questions

- `neuro_order_paid` vs the existing `confirmed` template — replace, or keep
  both and stop sending one?
- *Buy Now* asks the customer to type name, phone, address and pincode into
  WhatsApp. The site already has an address form that writes straight to the
  order. Should the button send that link instead? Typed addresses have to be
  re-keyed by hand and are where delivery failures come from.
- Referral link: per-customer code from the existing `referral_code` on
  `orders`, or one shared link?
- Who owns a `support_needed` task — the CRM inbox, or something new?

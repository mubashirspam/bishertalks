# Pending

Everything outstanding, in the order it should be done.
The site builds and `tsc` passes. Most of this is dashboard/config work — the
exception is India Post, where the API path still has code missing (booking,
the office lookup). The **manual path is finished and works today**: the bulk
booking workbook, the article-number stock, and labels carrying the article
number. None of it needs their sandbox.

Detail lives in [MAGIC_CHECKOUT.md](./MAGIC_CHECKOUT.md) and
[MAKE_WHATSAPP.md](./MAKE_WHATSAPP.md).

---

## 🔴 India Post — blocked on their sandbox being down

Full checklist in [docs/india-post-requirements.md](./docs/india-post-requirements.md);
the reasoning behind each decision is in
[docs/india-post-integration-plan.md](./docs/india-post-integration-plan.md).

Credentials are set and `103.180.89.153` **is** whitelisted under UAT. The
sandbox is still unreachable, and on 2026-08-27 the evidence came back pointing
at **their outage, not our access**: `test.cept.gov.in` accepts the TCP
connection and then resets the TLS handshake having sent zero bytes — with the
correct SNI, the wrong SNI and no SNI alike — while production
(`api.cept.gov.in`) completes a full handshake and answers. Their sibling UAT
host `uat.cept.gov.in` is serving a `*.cept.gov.in` certificate that **expired
on 2026-08-09**; production's was renewed on 2026-07-10. Adding the whitelist
entry changed nothing.

Workings and the email to send: [docs/india-post-uat-outage.md](./docs/india-post-uat-outage.md).

- [x] **Whitelist `103.180.89.153`** under UAT — done 2026-08-27, confirmed
      present, and it made no difference. Re-check the address on every run;
      a home connection's changes.
- [ ] **Email `integrations.cept@indiapost.gov.in`** — is UAT up, and is
      `test.cept.gov.in` still the correct sandbox host? Draft is written.
- [x] **Carrier adapter seam + India Post tracking** — done. `lib/couriers/adapters`
      now decides who can be sent to and who can be asked; the poller runs once
      per carrier over that carrier's own parcels; Speed Post has a Sync button,
      a waybill column and a place in the poller. Apply
      `0051_speed_post_tracking.sql`. It stays quiet ("not configured") until
      credentials work, then starts tracking on the next poll with no deploy.
- [x] **The manual channel — done, and it does not need their sandbox.**
      Speed Post parcels can be posted today, by the same three clicks the
      Delhivery ones use:
      * `lib/india-post/bulk-sheet.ts` builds their bulk domestic workbook,
        column for column off `bulkdomesticone_28042026.xlsx` — four tabs, the
        trailing space in `"LENGTH "` included. `/api/admin/delivery/courier-sheet`
        emits it instead of Delhivery's whenever the batch's courier tracks as
        `india-post`, so the existing Download Excel button already produces it.
      * Article numbers are allotted to the batch from the stock at download,
        and the same number is printed as the barcode on the 4×6 label — the
        two files agree by construction, which is the whole point.
      * `/admin/couriers` has the stock panel: upload the *Allocated Barcodes*
        export from their Barcode Management System, or type a range. Every
        number in their file is checked against our own check-digit arithmetic
        and a single disagreement refuses the import.
      * Migration **0049 is applied** and the first real allotment is loaded:
        `CL669228099IN`–`CL669228448IN`, 36 numbers, verified digit for digit
        against the physical stickers. 36 is under the low-stock threshold, so
        the panel is amber — ask for the next block early.
- [ ] **Still to build (the API path only)**: `booking.ts`, `label.ts` (LBL01),
      `offices.ts`, and routing tariff through the seam. The manual channel
      covers the work in the meantime; none of these need a reachable sandbox
      until final verification.
- [x] **The single-book article type — closed by packaging, not by asking.**
      A thinner mailer took a one-book parcel from 2.5 cm to 2.0, inside the
      2 cm document band their own rule classifies a 380 g article into. See
      `COURIER_DEFAULTS.heightPerBookCm` and the note in
      `lib/india-post/parcel.ts`.

      The other doubts are **closed**, all in favour of the existing code — see
      [docs/india-post-api-reference-findings.md](./docs/india-post-api-reference-findings.md).
      `codr_cod` is optional and blank for prepaid; bulk tracking really does
      omit event codes and `status.ts` already falls back to the wording;
      article numbers really are minted by us from an allotted range; and the
      check-digit algorithm was verified against the specification's own worked
      example and every genuine barcode in the document.
- [ ] **Subscribe the six APIs** — AUTH01, AUTH02, BBD01, TCD02, LBL01,
      TNT01/TNT02. Confirm *Subscribed APIs* stops reading zero.
- [ ] **Run `node scripts/india-post-smoke.mjs`** until all four steps pass. It
      books nothing and spends no article number. Step 2 also answers the
      single-book article-type question — read `product_code`.
- [ ] **Apply `supabase/migrations/0049_postal_barcodes.sql` by hand.**
      Migrations here are not run automatically.
- [ ] **Build what is left**: `booking.ts`, `label.ts` and the office lookup.
      The adapter seam, the barcode-stock admin and the manual booking sheet
      are done. `tariff.ts` is still wired to nothing; `track.ts` now runs
      behind the adapter.
- [ ] **Deploy before configuring their event webhook** — the route 404s on the
      live site until it ships, and their Test button will fail against it.
- [ ] **Set `SHIP_FROM_NAME` / `SHIP_FROM_ADDRESS` / `SHIP_FROM_PHONE`** — still
      unset, and it is the return address on every label, both carriers.
- [ ] **Do not submit the production-access form yet.** It wants proof of
      completed sandbox testing. That proof is the checklist in §7 of the
      requirements doc.
- [ ] **Leave `INDIA_POST_ENV=sandbox`** until that proof exists. The account is
      chosen from it, and getting it wrong puts real books in the post while
      someone believes they are testing.

## 🔴 Run migration 0005 before deploying

- [ ] **Run `supabase/migrations/0005_delivery.sql`** in the Supabase SQL
      editor. It adds the label-print tracking (`label_downloaded_at`,
      `label_download_count`), the `shipped_at` / `delivered_at` milestones,
      and the three bulk RPCs the Delivery screen calls. Without it,
      `/admin/delivery` and every order status update fail.
- [ ] **Set `SHIP_FROM_NAME` / `SHIP_FROM_ADDRESS` / `SHIP_FROM_PHONE`**
      (local and Vercel). This is the return address printed on every parcel
      label — a courier that can't deliver sends the parcel back to it.

## 🔴 Run migration 0004 before deploying

- [ ] **Run `supabase/migrations/0004_lead_capture.sql`** in the Supabase SQL
      editor. The new lead-capture and address-after-payment flow writes
      `district`, `address_submitted_at` and `address_reminders_sent`; without
      the migration, saving an address fails.

## 🔴 Blocking revenue — do first

✅ Live payments now work — two ₹1 orders captured, verified, and course access
granted. The chain below is proven end to end.

- [ ] **Confirm Vercel has `rzp_live_*` keys.** Vercel → Settings → Environment
      Variables. Key id and secret must be from the **same mode** — a live id
      with a test secret still fails, silently, *after* the customer pays.
- [ ] **Set `NEXT_PUBLIC_APP_URL=https://bishertalks.com` on Vercel.** It was
      pointing at `devmub.com`, a domain that no longer resolves. Every
      WhatsApp link and tracking URL is built from it.
- [ ] **Configure the Razorpay webhook** — Settings → Webhooks:
      - URL `https://bishertalks.com/api/webhook/razorpay`
      - Events **`payment.captured`** and **`payment.failed`**
      - Copy the secret → `RAZORPAY_WEBHOOK_SECRET` (local **and** Vercel)

      Without the secret set, every webhook returns 400 and the safety net is
      gone. This is what protects a customer whose internet drops after paying.
- [ ] **Check auto-capture is ON** — Razorpay → Settings → Payment Capture.
      If it's off, payments sit as `authorized`, `payment.captured` never
      fires, and orders stay `pending` *even with a working webhook*.
- [ ] **Deploy** (after migration 0004 above).
- [ ] **Re-test after deploying the new flow**: pay → land on the address form →
      pincode fills district/state → submit → thank-you.

Verify config before testing:

```bash
npm run check-env              # local
npm run check-env -- --vercel  # as production values
```

## 🔴 Nothing runs on a timer — and three things depend on one

There is no `crons` block in `vercel.json` and `CRON_SECRET` is unset, so every
scheduled job in this repo refuses to run or is never called. Three separate
symptoms, one cause:

- `/api/cron/whatsapp-health` has never run, so `whatsapp_template_status` is
  empty. That is what refused eight real order.shipped notifications on
  2026-08-28 with "no approved Malayalam version on record" while the template
  was approved. The gate now tells the two states apart (`e83dcee`) and allows
  the send — but until the cron runs it is checking nothing.
- `/api/cron/courier-poll` refuses outright (`CRON_SECRET is unset`), so 674
  parcels KKR has already uploaded never learn their waybill.
- Any CRM automation worker would be dead on arrival.

- [ ] Add `crons` to `vercel.json` and set `CRON_SECRET` locally and on Vercel
- [ ] Run the health cron once; confirm `whatsapp_template_status` fills
- [ ] Decide whether to re-send the 96 refused notifications, or let them go

## 🟡 Neuro Code CRM automation — built, needs three things to run

Button routing, tags, scheduled follow-ups and eight templates are implemented.
What shipped and why, plus the Meta JSON:
[docs/neuro-crm-automation-plan.md](./docs/neuro-crm-automation-plan.md).

- [ ] Apply `0053_crm_automation.sql` — without it tags read empty and
      follow-ups silently fail to queue, which is worse than an error
- [ ] Set `CRON_SECRET` (see the section above) — the worker refuses to run
- [ ] `npm run whatsapp:templates push-flows`, wait for approval, then run the
      health cron so `whatsapp_template_status` catches up
- [x] **Submitted and approved 2026-08-29.** All seven conversation-flow
      templates are APPROVED, and so is `neuro_order_receipt` — the split
      confirmation with a Track Order button and a Need Help reply, which
      `lib/notify.ts` now sends. `payment_reminder_1` and `payment_failed_1`
      went up with them and are in review
- [x] `/admin/templates` now shows every registry — automatic, flow, campaign,
      draft — plus anything Meta holds that no code sends, filtered by status
      and by kind. It showed two registries of four before, so the seven flow
      templates existed and appeared nowhere
- [ ] 🔴 **Appeal `bonus_course_access` in Meta Business Manager.** The course
      access message has now been rejected twice — once as `course_access`
      with the original wording, once as `bonus_course_access` with the
      careful rewording. Same reason both times, in seconds, without human
      review. It is not the wording: the classifier reads "a course and a
      link" as marketing however it is framed. **Course access has therefore
      never sent to anybody.** Appeal is the only path that puts a person in
      front of it; a third resubmission would just be guessing at a classifier
      - If the appeal fails: accept MARKETING for that one message (and the
        consent it needs), or deliver course access off WhatsApp
- [x] **Held `course_access` 2026-08-29.** It no longer attempts a WhatsApp
      send on purchase — five templates were refused, so every purchase was
      spending a Graph call to be rejected and writing a failed row that read
      like an outage. The notification log now records `skipped` with the
      reason. Course access itself is unaffected: the grant is a database
      write and customers still log in with their mobile number
      - Found while doing it: `isHeld` guarded two of the three routes to the
        wire, and the unguarded one was `notifyCourseAccess` — the path every
        purchase takes. Holding the event would have changed nothing. Fixed
      - Lifting it is one line: remove `"course_access"` from `HELD_EVENTS`
- [ ] 🔴 **Course access still needs a channel. Decide which.**
      Four templates, four instant INCORRECT_CATEGORY rejections, no human
      review: `course_access`, `bonus_course_access`,
      `neuro_order_confirm_track` and now `course_order_confirmation` — the
      last written as a receipt with an order number, ₹0 and a validity.
      `course_order_confirmation_v2` then went up as **MARKETING** — the same
      body, the opposite category — and came back with the **same
      INCORRECT_CATEGORY code in seconds**. So the code does not mean what it
      says: a refusal identical across both categories is not about the
      category. Either the classifier cannot place this content, or text
      refused four times is now turned away on sight.
      **Five rejected course templates are on the account. Do not add a
      sixth.** Two ways forward:
      - **Appeal** `course_order_confirmation` in Meta Business Manager — the
        only route to a human, and the receipt framing is the best case to put
        in front of one
      - **Email it instead.** Resend is already configured, and course access
        is not time-critical the way a delivery update is. Fastest unblock
      (Re-categorising is no longer one of them — it was tried and refused.)
- [ ] 🔴 **Decide the marketing-consent rule, or no campaign can ever run.**
      Three campaigns are queued as drafts and every recipient in all three
      would be refused: `marketing_opt_in_at` is null on all 228 contacts, and
      gate check 06 refuses a MARKETING template without it. It is a deadlock,
      not a backlog — consent is only granted by tapping a button inside a
      marketing message, and that message cannot be sent without consent
      - **(a)** Treat giving us a number at checkout as consent for
        order-related nudges. They started a purchase; the message is about
        that purchase. One condition in `assertSendable`
      - **(b)** Leave it strict, and accept that these three never send
      Do not change this quietly — it is the rule the number's health rests on
- [ ] Apply `0054_whatsapp_media.sql`. Customers have already sent 3 photos,
      3 voice notes and a sticker to this number and the CRM showed "(image)"
      in italics for every one — the webhook read Meta's `type` and threw away
      the media id beside it, so there was nothing to fetch back. Captured and
      rendered now, but **the seven that already arrived are unrecoverable**:
      their ids were never stored, and Meta has no way to look up a past
      message's media. New ones work from the moment the migration is applied
- [ ] 🔴 **Do not deploy until `neuro_order_receipt` is APPROVED.** It gained
      an "Order Details" button and is back in review. The code now sends two
      button parameters; the version live at Meta has one variable button, so
      a deploy before approval makes **every order confirmation fail**. Nothing
      is deployed yet, so today there is no exposure — the risk starts at the
      deploy. Check with `npm run whatsapp:templates list`
- [x] **`?view=details` is a real page now.** The two confirmation buttons no
      longer land in the same place: Order Details shows the order in full
      (copies, gift, signed, delivery address), the course with its login
      instructions, how to read the book — all in Malayalam — and the tracking
      link last. Course access appears only on a paid order
      - It is also where course access now lives at all, since the WhatsApp
        announcement for it is held
- [ ] **Do not deploy until `order_delivered` is APPROVED.** It gained an
      Order Details button and is back in review; the code now sends a button
      parameter the live version has no slot for. `npm run whatsapp:templates list`
- [x] **Stopped localhost links reaching customers.** `lib/notify.ts` built
      body links from `NEXT_PUBLIC_APP_URL`, which is `http://localhost:3000`
      on every developer machine — and a local run sends real WhatsApp
      messages. 101 messages were written carrying it; 97 were the token
      failures and never left, but **4 customers received a dead course link**
      (3 read, 1 delivered, all `order_delivered` on 2026-08-29). `appUrl()`
      now overrides the loopback addresses only, so staging still links to
      itself. `lib/whatsapp-templates.ts` had already refused to read that
      variable for button URLs; the same reasoning had never been applied to
      links in the body
      - Worth deciding: those four got a link they could not open. A short
        apology with the working link is one `send-test-template` run each
- [ ] 🔴 **Re-run the campaign template edit after 2026-08-30.** The new
      Malayalam wording and the three Malayalam buttons
      (`ഓർഡർ പൂർത്തിയാക്കാൻ` / `വീണ്ടും ശ്രമിക്കാൻ` · `കൂടുതൽ അറിയാൻ` ·
      `സഹായം വേണം`) are written and validated, but Meta refused the edit:
      **"You can only edit an active template once in 24 hours"** — both were
      already edited earlier the same day. One command tomorrow:

      ```
      npm run whatsapp:templates edit payment_reminder_1 payment_failed_1
      ```

      **Until that edit is approved, do not start those two campaigns.** The
      version at Meta still expects two variables and the code now sends one,
      so every send would be rejected. They cannot run anyway while the
      marketing-consent question above is open, so there is no hurry — but the
      two facts are independent and only one of them is obvious
- [ ] Decide: `neuro_delivery_confirmed` duplicates the `delivered` template
      `lib/notify.ts` already sends. Nothing sends it until one is retired
- [ ] Vercel **Pro** is needed for four crons at 15-minute intervals; Hobby
      allows two, daily

## 🟠 WhatsApp — nothing sends until the Make scenario exists

Sending now goes through a Make.com scenario, not the Meta API directly: the app
posts an event, Make owns the wording and the provider. `MAKE_WEBHOOK_URL` is
still blank, so nothing is sent. Payments and course access work without it, but
the customer gets no receipt — which matters most when their browser died before
the thank-you page.

Full procedure in [MAKE_WHATSAPP.md](./MAKE_WHATSAPP.md).

- [ ] Run migration `0014_notification_log.sql` — **the app claims a log row
      before it sends, so nothing goes out until this exists**
- [ ] Decide the provider: WhatsApp Business Cloud (free per message, days of
      Meta setup) or a BSP like WATI/AiSensy (monthly fee, live in hours)
- [ ] Make.com account on **Core** — the free plan covers ~200 messages/month
      and sleeps inactive scenarios
- [ ] Build the scenario: webhook → response → secret filter → env filter →
      dedupe data store → router → send → callback → error handlers
- [ ] Approve the five templates with the provider:
      `payment_received` (4) · `order_confirmed` (6) · `order_shipped` (6) ·
      `order_delivered` (3) · `course_access` (4)
      - Category **Utility**, language **English** (not English US / `en_US`)
      - All variables in the **body** — no variable URL buttons
- [ ] `MAKE_WEBHOOK_URL` + `MAKE_WEBHOOK_SECRET` locally and on Vercel
      (the secret is already generated in `.env.local`)
- [ ] Turn the scenario ON — an off scenario 404s and the message is lost
- [ ] Test: `npm run test-make -- --phone=9XXXXXXXXX --event=all`
- [ ] Delete the dead `WHATSAPP_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` from Vercel

## 🟡 Magic Checkout — blocked on Razorpay

Code is written and sits behind `NEXT_PUBLIC_MAGIC_CHECKOUT` (currently
`false`). Razorpay **rejects** the integration today:

```
400 "one_click_checkout is/are not required and should not be sent"
```

- [ ] Ask Razorpay support to enable **Magic Checkout** on the account
- [ ] Dashboard → Platform Setup → **Custom E-Commerce Platform**
- [ ] Checkout Settings → shipping info URL
      `https://bishertalks.com/api/shipping/info`
      (`GET` it in a browser first — it must be publicly reachable, no auth)
- [ ] `npm run check-env` will tell you when Razorpay starts accepting it
- [ ] Set `NEXT_PUBLIC_MAGIC_CHECKOUT=true` on Vercel and redeploy
- [ ] **On the first live Magic order, check the logs** for
      `[ShippingInfo] SCHEMA MISMATCH`. Razorpay doesn't publish that request
      schema, so the parser is deliberately lenient and falls back to
      "serviceable, free" rather than blocking a sale. If it logs a mismatch,
      the parser should be tightened to the real shape.

Rollback is just setting the flag back to `false` — the migration is backward
compatible with Standard Checkout.

## 🟢 Known gaps — worth doing, not blocking

- [ ] **Broken image**: `/images/courses/nlp-cover.jpg` is referenced on the
      neuro-code page but doesn't exist. An `onError` handler hides it, so it's
      been silently broken on the live site. Add the file or drop the reference.
- [ ] **Order lookup by phone.** If a customer loses connection before the
      thank-you page they never learn their order number, and tracking requires
      it. WhatsApp is currently their only route back in. A phone-based lookup
      on the track page closes this for good.
- [ ] **Reconciliation for missed webhooks.** If a webhook is never delivered
      (wrong URL/secret for a stretch), nothing catches up. An admin
      "sync from Razorpay" action would reconcile `pending` orders against the
      payments API.
- [ ] **Notify a CSV-imported batch.** Bulk import deliberately does *not* send
      WhatsApp — it grants in a loop and one accidental re-import would blast
      hundreds of unrecallable messages. If batch notification is wanted, it
      should be an explicit action with a confirmation step.
- [ ] **Move the admin password out of `.env.local`.** It was pasted in as raw
      terminal output. Next ignores it (no `=`), but it doesn't belong in a
      project file — use a password manager.
- [ ] **ESLint doesn't run.** The project has a legacy `.eslintrc.json`; ESLint
      v10 needs `eslint.config.js`. `tsc` and `next build` both pass, so this is
      cosmetic, but lint is effectively disabled.

## Reference

### Razorpay test cards (test mode only)

| Card | Result |
|---|---|
| `4111 1111 1111 1111` | success |
| `5555 5555 5555 4444` | success (Mastercard) |
| `4000 0000 0000 0002` | failure |

Any future expiry, any CVV. Test UPI: any valid-looking id, e.g. `test@paytm`.
Full list: <https://razorpay.com/docs/payments/payments/test-card-details/>

### Commands

| | |
|---|---|
| Preflight check | `npm run check-env` |
| WhatsApp test | `npm run test-make -- --phone=<phone> --event=all` |
| Migrations | `supabase/migrations/` — source of truth, applied by hand; the tree is at **`0049`**, and 0049 is pending |
| Magic Checkout flag | `NEXT_PUBLIC_MAGIC_CHECKOUT` (default `false`) |

## Done

- Course/DB query waterfall collapsed — course pages went from ~2.5s to ~15ms
- Tag-based caching with invalidation on every admin mutation
- Images moved to `next/image` — 801KB → 147KB (-81%)
- Magic Checkout implemented behind a flag (prepaid only, no COD)
- Migration `0003` applied and verified
- Atomic `pending → paid` claim — no double promo redemption or double WhatsApp
- Promo redemption moved to payment confirmation, so abandoned checkouts no
  longer burn redemptions
- `course_access` WhatsApp added — access grants previously notified nobody
- **First real payments captured** (₹1 × 2) — verify, course grant and signature
  checks all confirmed working
- Fixed thank-you page crash (Server Component with an `onClick`) — it had been
  broken forever but was never reached, because no payment had ever succeeded
- Admin panel rebuilt: left sidebar, dashboard, stage-based order buckets
- Lead capture — visitors are recorded when they type their number, before
  clicking Pay
- Checkout reduced to a single field; address collected after payment with
  pincode → district/state auto-fill

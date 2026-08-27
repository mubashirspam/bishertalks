# Pending

Everything outstanding, in the order it should be done.
The site builds and `tsc` passes. Most of this is dashboard/config work — the
exception is India Post, which still has real code missing (booking, labels,
the carrier adapter seam).

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
- [ ] **Still to build**: `booking.ts`, `label.ts`, `offices.ts`, the
      barcode-stock admin, and routing tariff through the seam. None need a
      reachable sandbox until final verification.
- [ ] **One question left before booking** — the single-book article type.
      A 380 g book is auto-classified `SP_INLAND_DOC` by weight, and a document
      may not exceed **2 cm**; ours is 2.5. Their own document states both rules
      explicitly and resolves neither. Needs their written answer — fold it into
      the outage email.

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
- [ ] **Build what is missing**: the adapter seam (India Post has no Send or
      Sync button until `canSendAutomatically` / `canTrack` stop being
      hard-coded to Delhivery), booking, labels, the office lookup, and the
      barcode-stock admin. `tariff.ts` and `track.ts` are written but wired to
      nothing.
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

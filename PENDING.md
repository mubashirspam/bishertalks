# Pending

Everything outstanding, in the order it should be done.
Code is complete and building; almost all of this is dashboard/config work.

Detail lives in [MAGIC_CHECKOUT.md](./MAGIC_CHECKOUT.md) and
[WHATSAPP_SETUP.md](./WHATSAPP_SETUP.md).

---

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

## 🟠 WhatsApp — nothing sends until this is done

`WHATSAPP_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` are still literal placeholders.
Payments and course access work without it, but the customer gets no receipt —
which matters most when their browser died before the thank-you page.

- [ ] Meta Business verification → WhatsApp Business Account
- [ ] Register a phone number **not** in use on the normal WhatsApp app
- [ ] **System User permanent token** — the API Setup page token expires in 24h
- [ ] Submit **all five** templates together (approval is per-template):
      `payment_received` (4) · `order_confirmed` (6) · `order_shipped` (6) ·
      `order_delivered` (3) · `course_access` (4)
      - Category **Utility**, language **English** (not English US / `en_US`)
      - All variables in the **body** — no variable URL buttons
- [ ] Set both env vars locally and on Vercel
- [ ] Test each: `npm run test-whatsapp 9XXXXXXXXX order_confirmed`

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
| WhatsApp test | `npm run test-whatsapp <phone> <template>` |
| Migrations | `supabase/migrations/` — source of truth, applied through `0003`; **`0004` pending** |
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

# Razorpay Magic Checkout — cutover runbook

Prepaid only. COD is deliberately not implemented; the shipping-info API always
answers `cod: false`.

The whole Magic Checkout path sits behind `NEXT_PUBLIC_MAGIC_CHECKOUT`.
Default `false` → the site keeps using Standard Checkout (address form).
`true` → Razorpay collects the address and we backfill it after payment.

**Do not set the flag to `true` until step 3 is confirmed.** Razorpay rejects
`one_click_checkout` on an unprovisioned account and *every order fails*:

```
400 BAD_REQUEST_ERROR
"one_click_checkout is/are not required and should not be sent"
reason: extra_field_sent
```

---

## 1. Run the migration (required before ANY deploy of this code)

Supabase Dashboard → SQL Editor → paste and run
`supabase/migrations/0003_magic_checkout.sql`.

This is not optional and not Magic-specific: the create route writes
`checkout_type`, so **both** checkout paths 500 until this runs.

Verify:

```sql
select column_name, is_nullable
from information_schema.columns
where table_name = 'orders'
  and column_name in ('buyer_name','buyer_phone','address_line1',
                      'city','state','pincode','checkout_type',
                      'shipping_fee_paise')
order by column_name;
```

Expect the six buyer/address columns `YES` (nullable), plus `checkout_type`
and `shipping_fee_paise` present. Existing orders should read
`checkout_type = 'standard'`.

## 2. Production config (Vercel → Settings → Environment Variables)

| Variable | Value | Why |
|---|---|---|
| `NEXT_PUBLIC_RAZORPAY_KEY_ID` | `rzp_live_…` | 17 orders, 0 ever captured — consistent with test keys in production |
| `RAZORPAY_KEY_SECRET` | live secret | must match the key above |
| `NEXT_PUBLIC_APP_URL` | `https://bishertalks.com` | every link inside a WhatsApp message and email is built from it |
| `RAZORPAY_WEBHOOK_SECRET` | dashboard webhook secret | signature validation |
| `NEXT_PUBLIC_MAGIC_CHECKOUT` | `false` for now | flip in step 4 |

Also confirm the dashboard webhook URL matches `WEBHOOK_URL`
(`www.bishertalks.com` vs `bishertalks.com` — pick one and be consistent).

Then place one real low-value order and confirm the full chain:
capture → verify → `payment_status = 'paid'` → course access granted →
WhatsApp received. **Nothing in the data proves this chain has ever run.**

## 3. Get Magic Checkout enabled

1. Ask Razorpay support / your account manager to enable **Magic Checkout**.
2. Dashboard → Magic Checkout → Platform Setup → **Custom E-Commerce Platform**.
3. Checkout Settings → shipping info URL:
   `https://bishertalks.com/api/shipping/info`
4. Confirm it's publicly reachable — `GET` it in a browser, expect:
   `{"ok":true,"service":"magic-checkout-shipping-info",...}`
   It must stay unauthenticated and answer well within Razorpay's 10s timeout
   (currently ~1ms; it does no I/O).
5. Re-run the create call. When the account is provisioned the
   `extra_field_sent` 400 disappears.

## 4. Flip the flag

Set `NEXT_PUBLIC_MAGIC_CHECKOUT=true` on Vercel and redeploy.
It's `NEXT_PUBLIC_` because the server route and the browser must agree on which
flow is active — if they disagree, the order shape won't match the UI.

Roll back by setting it to `false` and redeploying. No schema change needed;
the migration is backward compatible with the Standard Checkout path.

## 5. Verify the shipping-info contract on the first live checkout

Razorpay does not publish the request schema for this endpoint, so the parser is
deliberately lenient. On the first real Magic checkout, check the logs:

- `[ShippingInfo] received N address(es): {...}` — the real payload. Good.
- `[ShippingInfo] SCHEMA MISMATCH` — the shape isn't what we expect. The
  endpoint still returns a permissive "serviceable, free" so no sale is lost,
  but the parser in `app/api/shipping/info/route.ts` should be tightened to the
  logged shape.

## Shipping / serviceability policy

Constants at the top of `app/api/shipping/info/route.ts`:

```ts
const SHIPPING_FEE_PAISE = 0;   // free, all-India
const COD_ENABLED = false;      // prepaid only
```

Serviceability is currently "any valid 6-digit Indian pincode". To restrict to a
pincode list, change `isServiceable()`.

## Notes

- **Promo codes still work.** They're applied server-side to the order amount
  before Magic Checkout opens, so Razorpay's separate coupon API isn't needed.
  `show_coupons: false` hides Razorpay's own coupon widget.
- **Redemption moved to `/api/orders/verify`.** Previously promos were redeemed
  at order-creation time, so abandoned checkouts burned redemptions.
- **Verify and the webhook race each other.** Both claim the `pending → paid`
  transition atomically; only the winner redeems the promo and sends WhatsApp.
  The address backfill and course grant are idempotent and safe to re-run.
- **The webhook is the real safety net.** If the customer closes the tab after
  paying, the browser handler never runs and the webhook is the only path that
  fetches the shipping address. Don't remove that call.

-- Magic Checkout (prepaid only) — Razorpay collects the customer's contact
-- details and shipping address AFTER the order is created, so the order row
-- must be insertable without them and backfilled once payment is confirmed.
--
-- Run this BEFORE deploying the Magic Checkout code: the new create route
-- inserts rows without buyer/address fields and will fail against the old
-- NOT NULL constraints.

-- ── 1. Buyer + address become nullable until payment confirms ────────────────
ALTER TABLE orders ALTER COLUMN buyer_name    DROP NOT NULL;
ALTER TABLE orders ALTER COLUMN buyer_phone   DROP NOT NULL;
ALTER TABLE orders ALTER COLUMN address_line1 DROP NOT NULL;
ALTER TABLE orders ALTER COLUMN city          DROP NOT NULL;
ALTER TABLE orders ALTER COLUMN state         DROP NOT NULL;
ALTER TABLE orders ALTER COLUMN pincode       DROP NOT NULL;

-- ── 2. Shipping fee returned by our shipping-info API, echoed onto the order ──
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS shipping_fee_paise INTEGER NOT NULL DEFAULT 0;

-- ── 3. Distinguish legacy Standard Checkout orders from Magic Checkout ───────
-- Added with DEFAULT 'standard' so the 17 pre-existing rows are labelled
-- correctly, then the default flips to 'magic' for everything created from now on.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS checkout_type TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE orders ALTER COLUMN checkout_type SET DEFAULT 'magic';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_checkout_type_check'
  ) THEN
    ALTER TABLE orders ADD CONSTRAINT orders_checkout_type_check
      CHECK (checkout_type IN ('standard', 'magic'));
  END IF;
END $$;

-- ── 4. Reconciliation: find paid orders still missing a shipping address ─────
CREATE INDEX IF NOT EXISTS idx_orders_paid_missing_address
  ON orders (created_at DESC)
  WHERE payment_status = 'paid' AND address_line1 IS NULL;

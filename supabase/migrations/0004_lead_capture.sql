-- Lead capture + address-after-payment.
--
-- An order row is now created the moment a visitor types a valid mobile number,
-- before they click Pay. The same row is carried through payment and address
-- collection, so drop-off is visible at every stage.
--
-- Stage is DERIVED from existing columns rather than stored, so it can never
-- drift out of sync with reality:
--
--   lead             razorpay_order_id IS NULL
--   payment_started  razorpay_order_id IS NOT NULL AND payment_status = 'pending'
--   failed           payment_status = 'failed'
--   paid_no_address  payment_status = 'paid' AND address_line1 IS NULL
--   complete         payment_status = 'paid' AND address_line1 IS NOT NULL

-- When the customer completed the post-payment address form.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS address_submitted_at TIMESTAMPTZ;

-- District, from the pincode lookup. `city` holds the locality/post office.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS district TEXT;

-- How many times we've chased this customer for their address, so reminders
-- can be rate-limited instead of nagging.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS address_reminders_sent INTEGER NOT NULL DEFAULT 0;

-- ── Indexes for the admin stage buckets ─────────────────────────────────────
-- Paid but unshippable: the bucket that costs real money if ignored.
CREATE INDEX IF NOT EXISTS idx_orders_paid_no_address
  ON orders (created_at DESC)
  WHERE payment_status = 'paid' AND address_line1 IS NULL;

-- Leads that never reached payment.
CREATE INDEX IF NOT EXISTS idx_orders_leads
  ON orders (created_at DESC)
  WHERE razorpay_order_id IS NULL;

-- Reuse an existing lead row for the same phone instead of piling up a new row
-- on every page visit.
CREATE INDEX IF NOT EXISTS idx_orders_phone_pending
  ON orders (buyer_phone, created_at DESC)
  WHERE payment_status = 'pending';

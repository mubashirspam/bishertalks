-- Payment links.
--
-- Failed and abandoned checkouts used to be recoverable only by asking the
-- customer to start over. Now an admin generates a Razorpay payment link from
-- the order detail page and the customer pays it like any UPI/card payment —
-- no re-typing the cart. These two columns are what tie that payment back to
-- this order when the payment_link.paid webhook arrives.
--
--   payment_link_id   Razorpay's plink_xxx. Also the idempotency key: while an
--                     unpaid link exists, generating again returns the same one
--                     rather than letting a customer pay two links.
--   payment_link_url  the short URL, kept so the admin screen never needs a
--                     Razorpay round-trip just to display "copy link".

ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_link_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_link_url TEXT;

-- Webhook lookup: payment_link.paid carries the link id, not our order number.
CREATE INDEX IF NOT EXISTS idx_orders_payment_link
  ON orders (payment_link_id)
  WHERE payment_link_id IS NOT NULL;

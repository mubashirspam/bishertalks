-- Purchase confirmation email.
--
-- One column: when the receipt email actually went out. It exists so the same
-- email can't be sent twice, and so the admin can tell the difference between
-- "we emailed them" and "they never gave us an address".
--
-- Two things race to confirm a payment — the browser calling /api/orders/verify
-- and the Razorpay webhook — and either may run first. The existing WhatsApp
-- message avoids duplicates by hanging off the atomic pending→paid claim, but
-- email can't use that trick: an email address often arrives *later* than the
-- claim, backfilled from Razorpay or typed into the address form. So the send
-- is guarded by this timestamp instead, which works whenever the address turns
-- up.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS invoice_email_sent_at TIMESTAMPTZ;

-- Paid orders that have an email address but never received their receipt —
-- the list worth chasing if Resend was misconfigured for a while.
CREATE INDEX IF NOT EXISTS idx_orders_email_pending
  ON orders (created_at DESC)
  WHERE payment_status = 'paid'
    AND buyer_email IS NOT NULL
    AND invoice_email_sent_at IS NULL;

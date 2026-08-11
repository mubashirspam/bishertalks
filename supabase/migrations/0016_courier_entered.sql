-- Delivery portal: "Confirmed" is an agent action, not the payment status.
--
-- The portal's first tick column was wired to status = 'confirmed', which is
-- set the moment payment lands. Every row arrived already ticked, so the column
-- recorded nothing and the agent had nothing to do with it.
--
-- What it actually means: the agent has copied the address off the portal and
-- entered it into the courier's own system. That is a real step, it is the
-- first thing they do, and until now there was nowhere to record it — so a
-- parcel entered into the courier system looked exactly like one nobody had
-- opened yet.
--
-- Deliberately its own column rather than another order status: it is not a
-- fulfilment stage the customer ever sees, and it can be true while the parcel
-- is still sitting unpacked.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS courier_entered_at TIMESTAMPTZ;

-- The agent's working list: paid, shippable, and not yet keyed into the
-- courier system. This is the "what's left to do" query the portal opens on.
CREATE INDEX IF NOT EXISTS idx_orders_not_entered
  ON orders (created_at DESC)
  WHERE payment_status = 'paid'
    AND address_line1 IS NOT NULL
    AND courier_entered_at IS NULL;

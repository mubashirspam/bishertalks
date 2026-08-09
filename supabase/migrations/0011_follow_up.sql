-- Lead follow-up.
--
-- Everything that isn't paid is someone worth calling: 17 who opened the
-- payment sheet and stopped, 6 who typed a number and never went further, 6
-- whose payment failed. Until now there was nowhere to record that you'd rung
-- them, so the same people got chased twice and the rest got forgotten.
--
--   (null)             nobody has contacted them yet
--   contacted          followed up, waiting to hear back
--   converted          they went on to order — the outcome worth counting
--   already_purchased  they'd already bought; this row is a duplicate attempt
--   not_interested     said no, or unreachable. Stop chasing.
--
-- Deliberately separate from `status` (fulfilment) and `payment_status`. Those
-- describe what the SYSTEM knows; this records what a PERSON did about it, and
-- conflating the two is how a "cancelled" order becomes ambiguous.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS follow_up_status TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_follow_up_status_check'
  ) THEN
    ALTER TABLE orders ADD CONSTRAINT orders_follow_up_status_check
      CHECK (follow_up_status IS NULL OR follow_up_status IN (
        'contacted', 'converted', 'already_purchased', 'not_interested'
      ));
  END IF;
END $$;

-- When it was last actioned, so "chased 3 days ago" is answerable and nobody
-- is rung twice in an afternoon.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS follow_up_at TIMESTAMPTZ;

-- What they actually said. The single most useful field on a callback list.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS follow_up_note TEXT;

-- The working list: unpaid and nobody has touched it yet.
CREATE INDEX IF NOT EXISTS idx_orders_needs_follow_up
  ON orders (created_at DESC)
  WHERE payment_status <> 'paid' AND follow_up_status IS NULL;

-- Filtering the funnel by what happened after the call.
CREATE INDEX IF NOT EXISTS idx_orders_follow_up_status
  ON orders (follow_up_status, created_at DESC)
  WHERE follow_up_status IS NOT NULL;

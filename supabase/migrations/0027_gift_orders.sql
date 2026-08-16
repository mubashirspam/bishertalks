-- Gift orders.
--
-- A paid add-on, not a note: someone ticking "make it a gift" is charged for
-- wrapping and a written card, so the order has to carry three things — that it
-- is a gift at all, what the customer wants written, and what they paid for it.
--
-- The charge is stored per order rather than read from lib/gift.ts at display
-- time for the same reason the referral commission is snapshotted: raising the
-- fee next month must not rewrite what last month's customers were charged. An
-- invoice that disagrees with the card statement is a chargeback.
--
-- FALSE and 0 as defaults make every existing row correct as it stands. None of
-- them were gifts, and that is now what they say.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_gift BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS gift_message TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS gift_charge_paise INT NOT NULL DEFAULT 0;

DO $$
BEGIN
  -- A charge on a non-gift order is a pricing bug that would otherwise only
  -- surface as an amount nobody can explain. The upper bound is deliberately
  -- loose — it exists to stop a forged request, not to pin the price, which
  -- lives in lib/gift.ts and is free to change.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_gift_charge_check'
  ) THEN
    ALTER TABLE orders ADD CONSTRAINT orders_gift_charge_check
      CHECK (
        gift_charge_paise >= 0
        AND gift_charge_paise <= 100000
        AND (is_gift OR gift_charge_paise = 0)
      );
  END IF;

  -- A message on an order nobody is going to wrap would never be written out.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_gift_message_check'
  ) THEN
    ALTER TABLE orders ADD CONSTRAINT orders_gift_message_check
      CHECK (gift_message IS NULL OR (is_gift AND length(gift_message) <= 120));
  END IF;
END $$;

-- The packing queue asks "what still needs wrapping today?" on every load.
-- Partial, because gifts are the small minority of rows and a full index on a
-- mostly-false boolean earns nothing.
CREATE INDEX IF NOT EXISTS orders_gift_idx
  ON orders (created_at DESC)
  WHERE is_gift;

NOTIFY pgrst, 'reload schema';

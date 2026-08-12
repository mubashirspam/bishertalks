-- How many books are in the parcel.
--
-- Until now every order was one copy, and the checkout offered no way to say
-- otherwise — people who wanted three placed three orders, or messaged and
-- were handled by hand. amount_paise held the total either way, so nothing in
-- the admin or on a shipping label could tell a ₹2,097 order from a ₹699 one
-- except the number itself.
--
-- Defaulting to 1 makes every existing row correct as it stands: they were all
-- single copies, and that is what the column now says.
--
-- The bonus NLP course is not multiplied and has no column here. It is one
-- login per customer regardless of how many books they order — the checkout
-- says so, and there is nothing to count.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS quantity INT NOT NULL DEFAULT 1;

-- The same ceiling the checkout clamps to (lib/quantity.ts). Past ten copies is
-- a wholesale conversation, not a card payment — and a bound here is what stops
-- a forged request from creating a 10,000-book order row even if it somehow got
-- past the route.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_quantity_check'
  ) THEN
    ALTER TABLE orders ADD CONSTRAINT orders_quantity_check
      CHECK (quantity >= 1 AND quantity <= 10);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

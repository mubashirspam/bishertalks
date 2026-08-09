-- Control what a referred buyer actually pays.
--
-- Until now a referral could only ever be "₹X off the normal price", so with a
-- ₹699 book and a ₹50 discount the answer was always ₹649 and there was no way
-- to say "referred buyers pay ₹599". Setting the price by subtraction means
-- doing mental arithmetic every time the book price changes, and the number
-- the customer sees is the one that matters.
--
--   discount  →  they pay (book price − referee_discount_rupees)
--   fixed     →  they pay referral_price_rupees, whatever the book costs

ALTER TABLE referral_settings
  ADD COLUMN IF NOT EXISTS referee_pricing_mode TEXT NOT NULL DEFAULT 'discount';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'referral_settings_pricing_mode_check'
  ) THEN
    ALTER TABLE referral_settings ADD CONSTRAINT referral_settings_pricing_mode_check
      CHECK (referee_pricing_mode IN ('discount', 'fixed'));
  END IF;
END $$;

-- Whole rupees. Only consulted when the mode is 'fixed'; NULL until someone
-- sets one, so switching modes without a price can't silently sell at ₹0.
ALTER TABLE referral_settings
  ADD COLUMN IF NOT EXISTS referral_price_rupees INTEGER
  CHECK (referral_price_rupees IS NULL OR referral_price_rupees >= 0);

NOTIFY pgrst, 'reload schema';

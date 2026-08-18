-- Gift wrapping, switchable and priced from the admin.
--
-- 0027 shipped the feature with the fee as a constant in lib/gift.ts. That is
-- fine until the first time it needs to change: raising ₹59 to ₹79, or turning
-- wrapping off for a week because nobody is in the office to wrap anything, is
-- currently a code edit and a deploy. Neither is a developer's decision.
--
-- Single row, the same trick as referral_settings and business_costs: a BOOLEAN
-- primary key with a CHECK that it is TRUE, which makes a second row impossible
-- rather than merely discouraged. There is one shop and one wrapping fee.
--
-- Note what this table is NOT: it is not where an order's gift charge lives.
-- That stays snapshotted on orders.gift_charge_paise (0027) for the same reason
-- the referral commission is snapshotted — raising the fee next month must not
-- rewrite what last month's customers were charged, or the invoice stops
-- matching the card statement.

CREATE TABLE IF NOT EXISTS gift_settings (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),

  -- Off hides the checkbox at checkout entirely, rather than showing it
  -- disabled: an option greyed out with no explanation reads as a broken page.
  -- Existing gift orders are unaffected — they were paid for and still need
  -- wrapping, so the packing screens keep showing their badges.
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,

  -- What wrapping costs, in paise. The default is the constant this replaces.
  --
  -- The ceiling is not arbitrary: orders_gift_charge_check (0027) rejects any
  -- order with gift_charge_paise above 100000, so a fee set higher than that
  -- here would price a charge the orders table refuses to store, and every
  -- gift checkout would fail at the last step. The two bounds must agree.
  charge_paise INT NOT NULL DEFAULT 5900
    CHECK (charge_paise >= 0 AND charge_paise <= 100000),

  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO gift_settings (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;

-- Deny by default, like every other settings table here. Nothing in this row is
-- secret — the checkout page shows both values to anyone who looks — but the
-- anon key ships to every browser, and a writable settings row is a way to sell
-- wrapping at ₹0.
ALTER TABLE gift_settings ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

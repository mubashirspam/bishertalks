-- What a book costs to sell, so the panel can say what one earns.
--
-- The orders table knows every rupee that came in and nothing at all about what
-- went out, so "revenue" has been the only number the admin could show. Profit
-- needs the other half, and the other half is not derivable from anything we
-- store — it is printing quotes, courier rates, ad spend and salaries, which
-- live in the owner's head and change month to month. So they are typed in.
--
-- Single row, same trick as landing_settings and referral_settings: a BOOLEAN
-- primary key with a CHECK that it is TRUE, which makes a second row impossible
-- rather than merely discouraged.
--
-- Two kinds of cost, kept apart on purpose, because conflating them is the
-- mistake that makes a healthy business look sick:
--
--   Variable costs scale with the book. Print one more copy, pay printing once
--   more. These belong in the per-book figures below.
--
--   Fixed costs do not. Two salaries cost the same whether you ship 500 books
--   this month or 5,000 — which means "salary per book" is not a cost, it is a
--   quotient that falls as volume rises. Stored monthly, divided by actual
--   monthly volume at read time, so the report shows it collapsing instead of
--   pretending it is a constant.

CREATE TABLE IF NOT EXISTS business_costs (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),

  -- ── Variable, per book, in paise ──────────────────────────────────────────
  printing_paise INT NOT NULL DEFAULT 0,
  packaging_paise INT NOT NULL DEFAULT 0,
  delivery_paise INT NOT NULL DEFAULT 0,
  -- Cost to acquire one buyer: ad spend divided by orders. The single most
  -- volatile number here and the one that decides whether scale is profitable,
  -- so it stands alone rather than being folded into a "marketing and other"
  -- lump.
  marketing_paise INT NOT NULL DEFAULT 0,
  other_variable_paise INT NOT NULL DEFAULT 0,

  -- The gateway takes a cut of the price, so it cannot be a flat paise figure —
  -- it has to be recomputed whenever a price scenario changes the price. Stored
  -- as a percentage of the order value, GST on the fee included.
  payment_fee_percent NUMERIC(5,2) NOT NULL DEFAULT 2.36,

  -- ── Fixed, per month, in paise ────────────────────────────────────────────
  salary_monthly_paise BIGINT NOT NULL DEFAULT 0,
  tech_monthly_paise BIGINT NOT NULL DEFAULT 0,
  other_fixed_monthly_paise BIGINT NOT NULL DEFAULT 0,

  -- ── Risk ──────────────────────────────────────────────────────────────────
  -- A parcel that comes back earns nothing and costs freight both ways plus
  -- repacking. At prepaid-only this is small; the day COD is switched on it
  -- becomes the number that decides whether the margin survives, so the report
  -- can model it before anyone finds out the hard way.
  rto_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  rto_cost_paise INT NOT NULL DEFAULT 0,

  -- What a price change does to conversion, as percent lost per 10% of price
  -- added. Nobody knows this number without a split test — it is exposed as an
  -- assumption the owner sets rather than a constant buried in the code, so the
  -- scenario table is honest about resting on a guess.
  price_elasticity NUMERIC(5,2) NOT NULL DEFAULT 12,

  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO business_costs (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;

-- No cost may be negative, and the percentages are percentages. The report
-- divides by these, and a negative printing cost would quietly turn into profit
-- per book rather than an error anyone would notice.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'business_costs_sane'
  ) THEN
    ALTER TABLE business_costs ADD CONSTRAINT business_costs_sane CHECK (
      printing_paise >= 0
      AND packaging_paise >= 0
      AND delivery_paise >= 0
      AND marketing_paise >= 0
      AND other_variable_paise >= 0
      AND salary_monthly_paise >= 0
      AND tech_monthly_paise >= 0
      AND other_fixed_monthly_paise >= 0
      AND rto_cost_paise >= 0
      AND payment_fee_percent >= 0 AND payment_fee_percent <= 100
      AND rto_percent >= 0 AND rto_percent <= 100
      AND price_elasticity >= 0 AND price_elasticity <= 100
    );
  END IF;
END $$;

-- Read and written through the service role from server components and the
-- admin route, exactly like landing_settings. The anon key needs nothing here —
-- this is the cost structure of the business, and it is the one table on the
-- site that must never be reachable from a browser.
ALTER TABLE business_costs ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

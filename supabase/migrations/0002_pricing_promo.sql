-- ============================================================================
-- Migration 0002 — Course pricing + Promo codes
-- Run in Supabase Dashboard → SQL Editor (after 0001). Safe to re-run.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ----------------------------------------------------------------------------
-- COURSES — admin-managed pricing (whole rupees). NULL price means "use the
-- env / default fallback". offer_price is optional (the discounted price shown
-- struck-through and actually charged at checkout).
-- ----------------------------------------------------------------------------
ALTER TABLE courses ADD COLUMN IF NOT EXISTS price INTEGER;        -- ₹, nullable
ALTER TABLE courses ADD COLUMN IF NOT EXISTS offer_price INTEGER;  -- ₹, optional

-- ----------------------------------------------------------------------------
-- ORDERS — record the promo applied and the discount given (in paise).
-- ----------------------------------------------------------------------------
ALTER TABLE orders ADD COLUMN IF NOT EXISTS promo_code TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_paise INTEGER NOT NULL DEFAULT 0;

-- ----------------------------------------------------------------------------
-- PROMO CODES — admin-managed discount codes applied at checkout.
--   discount_type: 'percent' (1–100) or 'flat' (₹ off).
--   is_active:     master on/off switch.
--   expires_at:    optional expiry (NULL = never).
--   usage_limit:   optional max redemptions (NULL = unlimited).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS promo_codes (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  discount_type TEXT NOT NULL CHECK (discount_type IN ('percent', 'flat')),
  discount_value INTEGER NOT NULL CHECK (discount_value > 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at TIMESTAMPTZ,
  usage_limit INTEGER,
  used_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_promo_codes_code ON promo_codes(code);

DROP TRIGGER IF EXISTS promo_codes_updated_at ON promo_codes;
CREATE TRIGGER promo_codes_updated_at
  BEFORE UPDATE ON promo_codes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Atomically increment a promo's redemption count, respecting usage_limit.
-- Returns TRUE if the increment happened, FALSE if the code is exhausted.
CREATE OR REPLACE FUNCTION redeem_promo_code(p_code TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  updated INTEGER;
BEGIN
  UPDATE promo_codes
     SET used_count = used_count + 1
   WHERE code = p_code
     AND is_active = TRUE
     AND (expires_at IS NULL OR expires_at > NOW())
     AND (usage_limit IS NULL OR used_count < usage_limit);
  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated > 0;
END;
$$ LANGUAGE plpgsql;

-- RLS: service-role only (same model as the other app tables).
ALTER TABLE promo_codes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access" ON promo_codes;
CREATE POLICY "Service role full access" ON promo_codes FOR ALL TO service_role USING (true) WITH CHECK (true);

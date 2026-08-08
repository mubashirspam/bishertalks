-- Referral program.
--
-- Every buyer gets a code once their payment lands. Someone using that code
-- gets a small discount; the person who shared it earns a cash commission,
-- paid by UPI in batches.
--
-- The rule that shapes everything below: a commission is APPROVED ON DELIVERY,
-- not on payment. Paying on payment means paying for parcels that come back.
-- The delivery data added in 0005 is what makes that enforceable.
--
--   pending  → paid for, commission calculated and locked to the order
--   approved → delivered, safe to pay out
--   paid     → included in a payout batch
--   void     → cancelled or refunded

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ----------------------------------------------------------------------------
-- REFERRERS — anyone with a code.
--
-- Two kinds in one table, distinguished by `type`: customers, created
-- automatically after their order is paid, and affiliates, created by hand for
-- influencers with a negotiated rate. They behave identically at checkout;
-- only the commission differs.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS referrers (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,

  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,

  -- Bare 10-digit mobile, same normalisation as `users.phone`. This is what
  -- blocks self-referral, so it matters that it's stored consistently.
  phone TEXT,
  email TEXT,

  -- Where the money goes. Payouts are manual UPI transfers — an automated
  -- payout integration is a far larger regulatory surface than this volume
  -- justifies.
  upi_id TEXT,

  type TEXT NOT NULL DEFAULT 'customer'
    CHECK (type IN ('customer', 'affiliate', 'staff')),

  commission_type TEXT NOT NULL DEFAULT 'flat'
    CHECK (commission_type IN ('percent', 'flat')),
  -- Whole rupees when flat, percent (1-100) when percent.
  commission_value INTEGER NOT NULL CHECK (commission_value >= 0),

  is_active BOOLEAN NOT NULL DEFAULT TRUE,

  -- Cheap popularity signal: how many times the share link was opened. Kept as
  -- a counter rather than a click table — the only question anyone asks is
  -- "is this influencer sending traffic", and a number answers it.
  clicks INTEGER NOT NULL DEFAULT 0,

  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referrers_code ON referrers (upper(code));
CREATE INDEX IF NOT EXISTS idx_referrers_phone ON referrers (phone);
CREATE INDEX IF NOT EXISTS idx_referrers_type ON referrers (type, created_at DESC);

DROP TRIGGER IF EXISTS referrers_updated_at ON referrers;
CREATE TRIGGER referrers_updated_at
  BEFORE UPDATE ON referrers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ----------------------------------------------------------------------------
-- PAYOUTS — one row per UPI transfer actually made.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS referral_payouts (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  referrer_id UUID NOT NULL REFERENCES referrers(id) ON DELETE CASCADE,
  amount_paise INTEGER NOT NULL,
  order_count INTEGER NOT NULL DEFAULT 0,
  -- UPI transaction reference, so a "you never paid me" conversation has an
  -- answer.
  reference TEXT,
  note TEXT,
  paid_by UUID REFERENCES staff(id) ON DELETE SET NULL,
  paid_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payouts_referrer
  ON referral_payouts (referrer_id, paid_at DESC);

-- ----------------------------------------------------------------------------
-- ORDERS — the commission, snapshotted.
-- ----------------------------------------------------------------------------
ALTER TABLE orders ADD COLUMN IF NOT EXISTS referral_code TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS referrer_id UUID
  REFERENCES referrers(id) ON DELETE SET NULL;

-- Snapshotted at order time on purpose: raising an influencer's rate next
-- month must not silently rewrite what they were owed last month.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS referral_commission_paise INTEGER NOT NULL DEFAULT 0;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS referral_status TEXT
  CHECK (referral_status IN ('pending', 'approved', 'paid', 'void'));

ALTER TABLE orders ADD COLUMN IF NOT EXISTS referral_payout_id UUID
  REFERENCES referral_payouts(id) ON DELETE SET NULL;

-- Note there is no separate referral discount column. The buyer's discount
-- goes through the existing `discount_paise`, with `referral_code` recording
-- the cause — one number decides what was charged, so it can't disagree with
-- itself. A referral code and a promo code are mutually exclusive at checkout.

CREATE INDEX IF NOT EXISTS idx_orders_referrer
  ON orders (referrer_id, referral_status);
CREATE INDEX IF NOT EXISTS idx_orders_referral_owing
  ON orders (referrer_id)
  WHERE referral_status = 'approved';

-- ----------------------------------------------------------------------------
-- SETTINGS — one row, edited from the admin.
--
-- These three numbers get tuned against real margin in the first month. A code
-- deploy per adjustment is the wrong shape, so they live in the database.
-- The `id` column with a CHECK is the standard single-row table trick.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS referral_settings (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  -- Flat rupees a customer earns per delivered order they referred.
  customer_commission_rupees INTEGER NOT NULL DEFAULT 75,
  -- Default percentage for a newly created affiliate; set per person after.
  affiliate_commission_percent INTEGER NOT NULL DEFAULT 15,
  -- What the buyer saves for using someone's code.
  referee_discount_rupees INTEGER NOT NULL DEFAULT 50,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO referral_settings (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- RLS — deny by default, same as staff/audit. Referrer phone numbers, UPI IDs
-- and payout history must never be readable with the anon key.
-- ----------------------------------------------------------------------------
ALTER TABLE referrers ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_settings ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- Lifecycle. Set-based for the same reason as 0005: these run over a batch and
-- each needs a per-row condition PostgREST can't express.
-- ----------------------------------------------------------------------------

-- Delivered → the parcel arrived and wasn't returned, so the commission is
-- real. Only touches 'pending', so a re-delivery can't resurrect a voided one.
CREATE OR REPLACE FUNCTION approve_referral_commissions(p_order_numbers TEXT[])
RETURNS SETOF TEXT
LANGUAGE sql
AS $$
  UPDATE orders SET referral_status = 'approved', updated_at = NOW()
  WHERE order_number = ANY(p_order_numbers)
    AND referral_status = 'pending'
    AND payment_status = 'paid'
    AND referrer_id IS NOT NULL
  RETURNING order_number;
$$;

-- Cancelled or refunded → nothing is owed. Deliberately does NOT touch 'paid':
-- money already transferred is a fact, and silently rewriting it to 'void'
-- would make the ledger disagree with the bank.
CREATE OR REPLACE FUNCTION void_referral_commissions(p_order_numbers TEXT[])
RETURNS SETOF TEXT
LANGUAGE sql
AS $$
  UPDATE orders SET referral_status = 'void', updated_at = NOW()
  WHERE order_number = ANY(p_order_numbers)
    AND referral_status IN ('pending', 'approved')
  RETURNING order_number;
$$;

-- Settle everything approved for one referrer against a payout row.
CREATE OR REPLACE FUNCTION settle_referral_payout(p_referrer_id UUID, p_payout_id UUID)
RETURNS SETOF TEXT
LANGUAGE sql
AS $$
  UPDATE orders SET
    referral_status = 'paid',
    referral_payout_id = p_payout_id,
    updated_at = NOW()
  WHERE referrer_id = p_referrer_id
    AND referral_status = 'approved'
  RETURNING order_number;
$$;

-- Share-link opens.
CREATE OR REPLACE FUNCTION bump_referrer_clicks(p_code TEXT)
RETURNS VOID
LANGUAGE sql
AS $$
  UPDATE referrers SET clicks = clicks + 1
  WHERE upper(code) = upper(p_code);
$$;

-- Reachable only by the service role. The anon key is in every browser; a
-- publicly callable function that marks commissions approved or paid would be
-- a way to pay yourself.
DO $$
DECLARE fn TEXT;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'approve_referral_commissions(text[])',
    'void_referral_commissions(text[])',
    'settle_referral_payout(uuid, uuid)',
    'bump_referrer_clicks(text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

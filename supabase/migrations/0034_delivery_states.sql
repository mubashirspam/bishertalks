-- The columns behind docs/delivery-states.md.
--
-- Three questions the schema could not previously answer, each of which left a
-- parcel in a state nobody could filter for:
--
--   "have we actually asked the courier about this one?"
--       Without it, a parcel with a reference and no waybill is ambiguous: it
--       might be freshly sheeted, or it might be one of the 167 the courier
--       never received. Same columns, opposite meanings, opposite actions.
--
--   "can this courier even reach this address?"
--       Assigning a parcel to a courier that does not serve the pincode is a
--       rejection waiting to happen, discovered at the worst moment — in a
--       batch, after someone packed it.
--
--   "did a person set this status deliberately?"
--       An operator who marks a parcel delivered because the customer rang
--       them should not have it undone by a stale scan arriving afterwards.

-- ── Have we asked? ──────────────────────────────────────────────────────────
-- Distinguishes "not checked yet" from "checked, and they do not have it".
ALTER TABLE orders ADD COLUMN IF NOT EXISTS courier_checked_at TIMESTAMPTZ;

-- ── Can they deliver there? ─────────────────────────────────────────────────
-- NULL = we have not asked. A property of (courier, pincode), so it is cleared
-- whenever the courier changes — see the trigger below.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pincode_serviceable BOOLEAN;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pincode_checked_at TIMESTAMPTZ;

-- ── Did a person decide this? ───────────────────────────────────────────────
-- Set when someone ticks a stage by hand. A scan older than this is ignored;
-- a newer one still wins, because the courier physically has the parcel and a
-- later scan is later news.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS status_set_manually_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_orders_courier_checked
  ON orders (courier_checked_at) WHERE courier_reference IS NOT NULL;

-- ── Serviceability cache ────────────────────────────────────────────────────
-- Delhivery's pincode API is a lookup per code, and a day's parcels cluster on
-- a handful of towns — Kozhikode alone is hundreds. Asking once per parcel
-- would spend the 750-per-5-minute budget on questions we already know the
-- answer to.
--
-- Keyed on the pair, because serviceability belongs to the pair: Delhivery
-- reaching a village says nothing about whether India Post does.
CREATE TABLE IF NOT EXISTS courier_serviceability (
  courier_id UUID NOT NULL REFERENCES couriers(id) ON DELETE CASCADE,
  pincode TEXT NOT NULL,
  serviceable BOOLEAN NOT NULL,
  -- Their extra detail, kept for the screens: prepaid/COD flags, the sorting
  -- centre, whether it is an out-of-delivery-area surcharge zone.
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (courier_id, pincode)
);

ALTER TABLE courier_serviceability ENABLE ROW LEVEL SECURITY;

-- ── Changing courier invalidates the answer ─────────────────────────────────
-- A trigger rather than the application's job: routing happens from several
-- places, and a stale "serviceable" left behind by one of them would let a
-- parcel through to a courier that cannot deliver it.
CREATE OR REPLACE FUNCTION clear_serviceability_on_courier_change()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.courier_id IS DISTINCT FROM OLD.courier_id THEN
    NEW.pincode_serviceable := NULL;
    NEW.pincode_checked_at := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS orders_courier_changed ON orders;
CREATE TRIGGER orders_courier_changed
  BEFORE UPDATE OF courier_id ON orders
  FOR EACH ROW EXECUTE FUNCTION clear_serviceability_on_courier_change();

-- ── Portal view ─────────────────────────────────────────────────────────────
-- Rebuilt because it is `SELECT o.*` and would otherwise never see the columns
-- added above. Third time this note has been needed; see 0028.
DROP VIEW IF EXISTS portal_orders;

CREATE VIEW portal_orders AS
SELECT
  o.*,
  (o.created_at AT TIME ZONE 'Asia/Kolkata')::date AS ist_day,
  (o.courier_entered_at IS NULL) AS needs_entry
FROM orders o;

DO $$
BEGIN
  EXECUTE 'ALTER VIEW portal_orders SET (security_invoker = on)';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'security_invoker not supported here; relying on grants';
END $$;

REVOKE ALL ON portal_orders FROM PUBLIC;
REVOKE ALL ON portal_orders FROM anon, authenticated;
GRANT SELECT ON portal_orders TO service_role;

-- The 167 we have already asked about, so they land in "Not received" rather
-- than looking unchecked. Evidence we already have; no reason to re-derive it.
UPDATE orders
SET courier_checked_at = NOW()
WHERE courier_reference IS NOT NULL
  AND (tracking_number IS NULL OR tracking_number = '')
  AND courier_checked_at IS NULL;

NOTIFY pgrst, 'reload schema';

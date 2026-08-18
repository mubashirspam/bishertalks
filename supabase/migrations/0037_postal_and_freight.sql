-- A courier for the parcels Delhivery will not carry, and somewhere to keep
-- what Delhivery charges us for the ones it will.
--
-- Five paid orders are currently routed to Delhivery for pincodes Delhivery
-- does not serve — 689662, 682551 (Androth, in Lakshadweep), 685591 twice, and
-- 676575. They were caught by the serviceability check at assignment instead of
-- by a rejected upload after somebody packed them, which is the point of that
-- check; but until now there was nowhere for them to go.
--
-- India Post reaches every pincode in the country, which is precisely why it is
-- the right fallback and precisely why it cannot be integrated: there is no API
-- here, a person walks to the post office. So `manual` — we hand it over and
-- type the tracking number in afterwards. That handoff has existed since 0030
-- and this is its first real use.

INSERT INTO couriers (name, slug, handoff, config, sort_order)
VALUES (
  'India Post — Speed Post',
  'speed-post',
  'manual',
  -- No tracking key: there is no API to ask. The screens read the absence of
  -- one and stop offering Sync, waybill columns and everything else that would
  -- imply a confirmation is coming.
  '{}'::jsonb,
  30
)
ON CONFLICT (slug) DO NOTHING;

-- ── What the courier charges us ─────────────────────────────────────────────
-- Delhivery's invoice API prices a parcel from its weight and the two pincodes.
-- It is the only per-parcel cost we have never been able to see: printing,
-- packaging and the rest are typed into /admin/reports as estimates, while this
-- one is a real number the courier will actually bill.
--
-- Stored per order rather than recomputed, for the same reason the gift charge
-- and the referral commission are: it is what we were charged at the time, and
-- a rate card that changes next month must not rewrite last month's margin.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS courier_freight_paise INT;

-- Their breakdown, as given — freight, fuel surcharge, COD fee, tax. Kept whole
-- because we did not design it and should not flatten it into columns that
-- guess at its shape.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS courier_charge_detail JSONB;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS courier_charge_checked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_orders_freight
  ON orders (courier_freight_paise) WHERE courier_freight_paise IS NOT NULL;

-- ── Portal view ─────────────────────────────────────────────────────────────
-- Rebuilt so the new columns are visible. Same definition as 0035; only the
-- `SELECT o.*` expansion changes. Fourth time — see 0028 for why this keeps
-- being necessary.
DROP VIEW IF EXISTS portal_orders;

CREATE VIEW portal_orders AS
SELECT
  o.*,
  (o.created_at AT TIME ZONE 'Asia/Kolkata')::date AS ist_day,
  (o.courier_entered_at IS NULL) AS needs_entry,
  ((c.config ->> 'tracking') IS NOT NULL) AS courier_tracks,
  CASE
    WHEN COALESCE(o.tracking_number, '') <> '' THEN 'with_courier'
    WHEN o.courier_id IS NULL OR c.id IS NULL THEN 'unrouted'
    WHEN o.pincode_serviceable IS FALSE THEN 'unserviceable'
    WHEN COALESCE(o.courier_send_error, '') <> '' AND o.courier_sent_at IS NOT NULL
      THEN 'held'
    WHEN COALESCE(o.courier_send_error, '') <> '' THEN 'send_failed'
    WHEN (c.config ->> 'tracking') IS NULL THEN
      CASE WHEN o.courier_entered_at IS NOT NULL THEN 'handed_over' ELSE 'ready' END
    WHEN o.courier_entered_at IS NULL THEN
      CASE WHEN o.pincode_serviceable IS NULL THEN 'checking' ELSE 'ready' END
    WHEN COALESCE(o.courier_reference, '') = '' THEN 'legacy_unmatched'
    WHEN o.courier_checked_at IS NOT NULL THEN 'not_received'
    ELSE 'unconfirmed'
  END AS handover_state
FROM orders o
LEFT JOIN couriers c ON c.id = o.courier_id;

DO $$
BEGIN
  EXECUTE 'ALTER VIEW portal_orders SET (security_invoker = on)';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'security_invoker not supported here; relying on grants';
END $$;

REVOKE ALL ON portal_orders FROM PUBLIC;
REVOKE ALL ON portal_orders FROM anon, authenticated;
GRANT SELECT ON portal_orders TO service_role;

NOTIFY pgrst, 'reload schema';

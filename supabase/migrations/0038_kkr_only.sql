-- One partner, and a record of how a parcel actually travelled.
--
-- The delivery model is simpler than the code had grown to assume:
--
--   1. We assign an order to KKR LOGISTICS FRANCHISE. That is the only choice.
--   2. We hand KKR the data. KKR manifests it at Delhivery — not us, ever.
--   3. Parcels KKR cannot manifest (pincode not served) they send another way,
--      and report back daily in a spreadsheet.
--   4. Everything else we learn from Delhivery's tracking, read-only.
--
-- So: the courier list stops being a list. `speed-post` is not created (0037
-- may be skipped), the Excel-sheet row stays only as the historical home of
-- parcels routed before this, and the Delhivery row is renamed to what people
-- actually call it.
--
-- Nothing is deleted. Every order keeps its courier_id, reference, waybill and
-- history; the rows they point at are simply renamed or deactivated.

UPDATE couriers
SET name = 'KKR Logistics (Delhivery)',
    is_active = TRUE,
    updated_at = NOW()
WHERE slug = 'delhivery';

UPDATE couriers
SET is_active = FALSE, updated_at = NOW()
WHERE slug <> 'delhivery';

-- ── How it actually travelled ───────────────────────────────────────────────
-- NULL means the ordinary route: KKR manifests it at Delhivery and their scans
-- tell us the rest. A value means KKR could not, and sent it some other way —
-- India Post, a bus parcel service, by hand. We do not choose it and cannot
-- track it; the word comes from KKR's daily spreadsheet and exists so a parcel
-- that left by another road stops looking like one that never left.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS transport_mode TEXT;

-- Where that answer came from, so an uploaded figure is never mistaken for one
-- we observed.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS transport_reported_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_orders_transport_mode
  ON orders (transport_mode) WHERE transport_mode IS NOT NULL;

-- ── Portal view ─────────────────────────────────────────────────────────────
-- The states change with the model. There is no "ready to send" any more,
-- because we never send: a parcel is either still ours, with KKR, or gone by
-- another road.
DROP VIEW IF EXISTS portal_orders;

CREATE VIEW portal_orders AS
SELECT
  o.*,
  (o.created_at AT TIME ZONE 'Asia/Kolkata')::date AS ist_day,
  (o.courier_entered_at IS NULL) AS needs_entry,
  TRUE AS courier_tracks,
  CASE
    -- KKR sent it another way. Checked first: it is the one state where the
    -- absence of a Delhivery waybill is correct rather than a problem.
    WHEN o.transport_mode IS NOT NULL THEN 'other_transport'

    -- Delhivery has it. KKR manifested it and the waybill came back to us.
    WHEN COALESCE(o.tracking_number, '') <> '' THEN 'with_courier'

    WHEN o.courier_id IS NULL THEN 'unassigned'

    -- Assigned, but KKR has not been given the data yet.
    WHEN o.courier_entered_at IS NULL THEN 'to_hand_over'

    -- Given to KKR, waiting for them to manifest it.
    WHEN o.courier_checked_at IS NULL THEN 'awaiting_manifest'

    -- We asked Delhivery and there is no shipment. Either KKR has not
    -- manifested it yet, or it is one they could not and have not reported.
    ELSE 'not_manifested'
  END AS handover_state
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

NOTIFY pgrst, 'reload schema';

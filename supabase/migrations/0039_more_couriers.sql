-- A second partner, and a state model that stops assuming Delhivery.
--
-- Mubashir Logistic has no Delhivery account and no API. Parcels are assigned
-- to them, an Excel sheet is downloaded, and somebody updates the status by
-- hand afterwards. That is the `sheet` handoff, which has existed since 0030
-- and until now had only ever described the old KKR flow.
--
-- 0038 hard-coded `TRUE AS courier_tracks`, because at that point every parcel
-- went to Delhivery and every parcel could be asked about. With a partner that
-- reports nothing, that assumption produces a lie: a parcel handed to Mubashir
-- would sit in 'awaiting_manifest' forever, waiting for a confirmation that
-- cannot arrive, and then fall to 'not_manifested' as though something had gone
-- wrong. Nothing has gone wrong; there is simply nobody to ask.
--
-- So the view reads `config.tracking` again, and a courier without it gets
-- 'handed_over' — done, from our side, until a human says otherwise.

INSERT INTO couriers (name, slug, handoff, config, sort_order, is_active)
VALUES (
  'Mubashir Logistic',
  'mubashir-logistic',
  'sheet',
  -- No `tracking` key: there is no API to ask. The screens read its absence
  -- and stop offering Sync, waybill columns, and anything else that implies a
  -- confirmation is coming.
  '{}'::jsonb,
  20,
  TRUE
)
ON CONFLICT (slug) DO UPDATE
  SET is_active = TRUE, handoff = EXCLUDED.handoff, updated_at = NOW();

DROP VIEW IF EXISTS portal_orders;

CREATE VIEW portal_orders AS
SELECT
  o.*,
  (o.created_at AT TIME ZONE 'Asia/Kolkata')::date AS ist_day,
  (o.courier_entered_at IS NULL) AS needs_entry,

  -- Real again, not TRUE. Drives every "is no waybill a problem here?" answer.
  ((c.config ->> 'tracking') IS NOT NULL) AS courier_tracks,

  CASE
    -- Sent by some other service, reported to us in a spreadsheet.
    WHEN o.transport_mode IS NOT NULL THEN 'other_transport'

    -- A waybill is proof somebody has it, whoever they are.
    WHEN COALESCE(o.tracking_number, '') <> '' THEN 'with_courier'

    WHEN o.courier_id IS NULL OR c.id IS NULL THEN 'unassigned'

    -- Ours still — assigned, but the courier has not been given the data.
    WHEN o.courier_entered_at IS NULL THEN 'to_hand_over'

    -- Handed over to a partner that tells us nothing. There is no confirmation
    -- to wait for, so this is the end of the line until somebody types a
    -- tracking number in or ticks a stage.
    WHEN (c.config ->> 'tracking') IS NULL THEN 'handed_over'

    -- Handed over to a partner we can ask, and we have not asked yet.
    WHEN o.courier_checked_at IS NULL THEN 'awaiting_manifest'

    -- We asked, and they have no record of it.
    ELSE 'not_manifested'
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

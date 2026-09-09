-- Which network KKR Logistics actually sent a parcel through.
--
-- APPLY THIS BY HAND. Migrations here are not run automatically.
-- APPLY AFTER 0067 — this rebuilds portal_orders again and expects its columns.
--
-- WHY THIS EXISTS
--
-- "KKR Logistics" (slug delhivery-sheet) is a franchise counter, not a single
-- carrier — most of what is handed to them travels on Delhivery, which is why
-- that row's own reference and tracking behaviour is written as if it always
-- does. Some days it does not: a parcel goes out on DTDC or on Trackon
-- instead, and the number that comes back is neither a Delhivery waybill nor
-- anything ensureReferences() minted. There was nowhere to say so, and the
-- portal's Tracking ID column had no way to know which kind of number it was
-- looking at.
--
-- courier_service names that, for the one courier row where it varies parcel
-- to parcel. It is deliberately not a wider "which carrier" concept: India
-- Post going through KKR is already its own courier row (kkr-india-post,
-- 0060) with its own account, its own article-number allotment and its own
-- reconciliation — a parcel that actually goes by post is reassigned to that
-- row, not tagged here. This column only distinguishes the networks KKR
-- Logistics itself has no separate machinery for.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS courier_service TEXT;

DO $$
BEGIN
  ALTER TABLE orders
    ADD CONSTRAINT orders_courier_service_check
    CHECK (courier_service IS NULL OR courier_service IN ('dtdc', 'trackon'));
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'orders_courier_service_check already exists';
END $$;

COMMENT ON COLUMN orders.courier_service IS
  'Which network carried this parcel, when the courier itself does not say '
  '(0068). NULL means the courier''s own default — Delhivery, for KKR '
  'Logistics. Set from the delivery portal; changes what the Tracking ID '
  'column calls the number and nothing else. India Post is not a value here '
  '— see kkr-india-post, a separate courier row with its own article-number '
  'allotment.';

-- ── The portal view, again ───────────────────────────────────────────────
--
-- Same reason as every migration since 0063: portal_orders is SELECT o.*,
-- that star was expanded when the view was created, and the column above
-- does not reach the delivery queue or the portal until it is rebuilt.
-- Definition unchanged from 0067 — copied verbatim, not retyped, for the
-- reason 0064's own comment gives: retyping this by hand is how one of the
-- CASE branches quietly changes meaning.

DROP VIEW IF EXISTS portal_orders;

CREATE VIEW portal_orders AS
SELECT
  o.*,
  -- ordered_at is UTC; the agent's day is an IST calendar day. Without the
  -- conversion every order placed after 6:30pm IST sorts into tomorrow.
  (o.ordered_at AT TIME ZONE 'Asia/Kolkata')::date AS ist_day,

  -- When this parcel became somebody's job. The portal's sort key and the
  -- day its date picker filters on.
  COALESCE(o.assigned_at, o.ordered_at) AS work_at,
  (COALESCE(o.assigned_at, o.ordered_at) AT TIME ZONE 'Asia/Kolkata')::date
    AS work_day,
  -- FALSE means the row above is the order date standing in for an assignment
  -- that never happened. The grid says so rather than letting one column mean
  -- two things depending on the row.
  (o.assigned_at IS NOT NULL) AS work_at_is_assignment,

  -- "Nobody has entered this with the courier yet."
  (o.courier_entered_at IS NULL) AS needs_entry,

  -- Real, not TRUE. Drives every "is no waybill a problem here?" answer.
  ((c.config ->> 'tracking') IS NOT NULL) AS courier_tracks,

  -- Where the parcel is in the queue. Must match deliveryStage().
  CASE
    WHEN o.status = 'returned'         THEN 'returned'
    WHEN o.status = 'cancelled'        THEN 'cancelled'
    WHEN o.status = 'delivered'        THEN 'delivered'
    WHEN o.status = 'out_for_delivery' THEN 'out_for_delivery'
    WHEN o.status = 'shipped'          THEN 'shipped'
    -- 'confirmed' / 'processing' — being routed is what separates them, and a
    -- courier routes a parcel just as much as an agent does.
    WHEN o.courier_id IS NOT NULL OR o.assigned_agent_id IS NOT NULL
      THEN 'assigned'
    ELSE 'new'
  END AS delivery_stage,

  CASE
    -- Sent by some other service, reported to us in a spreadsheet.
    WHEN o.transport_mode IS NOT NULL THEN 'other_transport'

    -- A waybill is proof somebody has it, whoever they are.
    WHEN COALESCE(o.tracking_number, '') <> '' THEN 'with_courier'

    WHEN o.courier_id IS NULL OR c.id IS NULL THEN 'unassigned'

    -- The courier looked at this one and said no. It is routed, nobody has it,
    -- and it will sit here forever unless a person moves it somewhere else.
    WHEN o.courier_send_error IS NOT NULL AND o.courier_sent_at IS NULL
      THEN 'send_refused'

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

-- Dropping the view dropped its grants with it. Service-role only: the anon
-- key ships to every browser, and this view carries every customer's name,
-- mobile and home address.
REVOKE ALL ON portal_orders FROM PUBLIC;
REVOKE ALL ON portal_orders FROM anon, authenticated;
GRANT SELECT ON portal_orders TO service_role;

NOTIFY pgrst, 'reload schema';

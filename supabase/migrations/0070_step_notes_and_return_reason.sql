-- A date for Packed and On the van, and a reason for Return.
--
-- APPLY THIS BY HAND. Migrations here are not run automatically.
-- APPLY AFTER 0069 — this rebuilds portal_orders again and expects its columns.
--
-- WHY THIS EXISTS
--
-- The portal's six columns — Confirmed, Packed, Shipped, On the van, Delivered,
-- Return — already had four different dates behind them (courier_entered_at,
-- shipped_at, delivered_at, returned_at), but two gaps meant the grid could
-- never show "when" for every step:
--
--   * Packed has no timestamp at all. `processing_at` fixes that.
--   * On the van shares `shipped_at` with Shipped — 0005's set_delivery_status
--     stamps it for BOTH statuses, so once a parcel reaches out_for_delivery
--     there is no way to say separately when it left the shelf and when the
--     van picked it up. `out_for_delivery_at` fixes that. `shipped_at` keeps
--     doing exactly what it does today — every report built on "days to
--     ship" still reads the same column, unchanged.
--
-- And Return had no way to say WHY — not from the courier's own scan (their
-- text is already read and shown as courier_last_scan, but a later scan
-- overwrites it, so the reason a parcel came back does not survive to when
-- somebody actually looks), and not from a person marking one back by hand.
-- `return_reason` is that answer, filled two ways — see courier-scan.ts and
-- the portal route.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS processing_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS out_for_delivery_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS return_reason TEXT;

COMMENT ON COLUMN orders.processing_at IS
  'When this parcel was packed. Stamped once, like shipped_at/delivered_at — '
  're-marking does not rewrite it. NULL for every parcel packed before 0070.';
COMMENT ON COLUMN orders.out_for_delivery_at IS
  'When this parcel left for the van, distinct from shipped_at (which both '
  'this and Shipped stamp, unchanged, for the reports already built on it). '
  'NULL for every parcel that reached this stage before 0070.';
COMMENT ON COLUMN orders.return_reason IS
  'Why a parcel came back — the courier''s own scan text where a scan drove '
  'the return (set once, never overwritten by a later scan), or typed by '
  'hand when an agent marks one returned from the portal. NULL means nobody '
  'has said why yet.';

-- ── The two status functions gain the new stamps ────────────────────────────
--
-- Both keep every existing column and every existing COALESCE-once behaviour
-- exactly as it was — this only adds two more stamps to the same shape.

CREATE OR REPLACE FUNCTION set_delivery_status(
  p_order_numbers TEXT[],
  p_status        TEXT,
  p_courier       TEXT DEFAULT NULL
)
RETURNS SETOF TEXT
LANGUAGE sql
AS $$
  UPDATE orders SET
    status              = p_status,
    courier_name        = COALESCE(NULLIF(p_courier, ''), courier_name),
    processing_at       = CASE WHEN p_status = 'processing'
                              THEN COALESCE(processing_at, NOW()) ELSE processing_at END,
    shipped_at          = CASE WHEN p_status IN ('shipped', 'out_for_delivery')
                              THEN COALESCE(shipped_at, NOW()) ELSE shipped_at END,
    out_for_delivery_at = CASE WHEN p_status = 'out_for_delivery'
                              THEN COALESCE(out_for_delivery_at, NOW()) ELSE out_for_delivery_at END,
    delivered_at        = CASE WHEN p_status = 'delivered'
                              THEN COALESCE(delivered_at, NOW()) ELSE delivered_at END,
    returned_at         = CASE WHEN p_status = 'returned'
                              THEN COALESCE(returned_at, NOW()) ELSE returned_at END,
    updated_at          = NOW()
  WHERE order_number = ANY(p_order_numbers)
  RETURNING order_number;
$$;

REVOKE ALL ON FUNCTION set_delivery_status(text[], text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION set_delivery_status(text[], text, text) TO service_role;

CREATE OR REPLACE FUNCTION set_delivery_status_at(
  p_order_numbers TEXT[],
  p_status        TEXT,
  p_at            TIMESTAMPTZ[],
  p_courier       TEXT DEFAULT NULL
)
RETURNS SETOF TEXT
LANGUAGE sql
AS $$
  UPDATE orders o SET
    status               = p_status,
    courier_name         = COALESCE(NULLIF(p_courier, ''), o.courier_name),
    processing_at        = CASE WHEN p_status = 'processing'
                                THEN COALESCE(o.processing_at, t.at, NOW()) ELSE o.processing_at END,
    shipped_at           = CASE WHEN p_status IN ('shipped', 'out_for_delivery')
                                THEN COALESCE(o.shipped_at, t.at, NOW()) ELSE o.shipped_at END,
    out_for_delivery_at  = CASE WHEN p_status = 'out_for_delivery'
                                THEN COALESCE(o.out_for_delivery_at, t.at, NOW()) ELSE o.out_for_delivery_at END,
    delivered_at         = CASE WHEN p_status = 'delivered'
                                THEN COALESCE(o.delivered_at, t.at, NOW()) ELSE o.delivered_at END,
    returned_at          = CASE WHEN p_status = 'returned'
                                THEN COALESCE(o.returned_at, t.at, NOW()) ELSE o.returned_at END,
    updated_at           = NOW()
  FROM unnest(p_order_numbers, p_at) AS t(order_number, at)
  WHERE o.order_number = t.order_number
  RETURNING o.order_number;
$$;

REVOKE ALL ON FUNCTION set_delivery_status_at(TEXT[], TEXT, TIMESTAMPTZ[], TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION set_delivery_status_at(TEXT[], TEXT, TIMESTAMPTZ[], TEXT)
  TO service_role;

-- ── The portal view, again ───────────────────────────────────────────────
--
-- Same reason as every migration since 0063: portal_orders is SELECT o.*,
-- that star was expanded when the view was created, and the three columns
-- above do not reach the delivery queue or the portal until it is rebuilt.
-- Definition unchanged from 0068 — copied verbatim, not retyped.

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

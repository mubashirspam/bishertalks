-- When was this parcel given to its courier?
--
-- Today nothing answers that. Routing a parcel (POST /api/admin/delivery/courier)
-- writes `courier_id` and clears `courier_send_error`, and that is all. The
-- decision leaves no timestamp on the row, so "show me everything I assigned to
-- Delhivery on 24 August" cannot be asked of this database at all.
--
-- WHY THE EXISTING COLUMNS ARE NOT SUBSTITUTES, each of which was considered:
--
--   courier_entered_at  "somebody keyed it into the courier's system". For a
--                       manual courier that is a separate act on a later day,
--                       and for a parcel nobody has handed over yet it is NULL
--                       forever. It answers a different question and it is
--                       missing on precisely the parcels most worth chasing.
--   courier_sent_at     "their API accepted it". Only ever set for an
--                       integrated courier; NULL for every sheet and manual
--                       partner, which is most of this shop's volume.
--   assigned_at         the DELIVERY AGENT, not the courier (0019). A parcel
--                       can go to a courier without ever touching an agent.
--   updated_at          the last time anything at all changed on the row.
--
-- So the fact gets its own column, mirroring the agent pair from 0019 exactly:
-- a timestamp and who did it.

-- ─────────────────────────────────────────────────────────────────────────────
-- COLUMNS
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE orders ADD COLUMN IF NOT EXISTS courier_assigned_at TIMESTAMPTZ;

-- ON DELETE SET NULL, like assigned_by: removing a staff member must never
-- delete or orphan a parcel. The routing fact survives; only the name of who
-- did it is lost, and the audit log still holds that.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS courier_assigned_by UUID
  REFERENCES staff(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- BACKFILL
--
-- Every parcel that already has a courier needs a date, or the new filter
-- reports an empty August for a month that was full of work.
--
-- Four sources, best first. The first is the real answer; the rest are
-- stand-ins, and the DO block below counts how many rows came from each so the
-- uncertainty is on the record rather than in somebody's memory.
--
--   1. audit_log            the routing action itself, written by the route
--                           since couriers existed (0030). This is the moment.
--   2. courier_entered_at   handed to the courier — at or after the routing.
--   3. courier_sent_at      their API accepted it — likewise.
--   4. assigned_at          the agent got it; in this shop's flow routing and
--                           agent assignment happen in the same sitting.
--   5. shipped_at           it went; it was certainly routed by then.
--   6. ordered_at           the floor. Never NULL, so the backfill terminates.
--
-- Each is a LATER bound on the truth except the first, which IS the truth. A
-- parcel dated by a stand-in is therefore never dated EARLIER than it was
-- routed, which is the safe direction: an "assigned on the 24th" filter can
-- miss a parcel that shows up on the 25th, but it will not invent one.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_audit  INT;
  v_fallback INT;
BEGIN
  -- 1. The real moment, where the log kept it.
  --
  -- The courier in the log has to match the courier on the row: a parcel routed
  -- to Speed Post in July and moved to Delhivery in August was assigned to its
  -- CURRENT courier in August, and the July row is the wrong answer. Matching
  -- on meta->>'courier_id' is what makes a re-routed parcel come out right.
  --
  -- DISTINCT ON with ORDER BY created_at DESC takes the latest such row, so a
  -- parcel routed to the same courier twice reports the routing that stuck.
  WITH latest AS (
    SELECT DISTINCT ON (a.entity_id)
      a.entity_id,
      a.created_at,
      a.actor_id,
      a.meta ->> 'courier_id' AS courier_id
    FROM audit_log a
    WHERE a.action = 'order.courier_assigned'
      AND a.entity = 'order'
      AND a.entity_id IS NOT NULL
      AND a.meta ->> 'courier_id' IS NOT NULL
    ORDER BY a.entity_id, a.created_at DESC
  )
  UPDATE orders o
  SET courier_assigned_at = l.created_at,
      courier_assigned_by = l.actor_id
  FROM latest l
  WHERE o.order_number = l.entity_id
    AND o.courier_id IS NOT NULL
    AND o.courier_assigned_at IS NULL
    AND o.courier_id::text = l.courier_id;

  GET DIAGNOSTICS v_audit = ROW_COUNT;

  -- 2–6. Everything the log cannot account for — parcels routed before the
  -- audit call existed, routed by a path that did not log, or re-routed to a
  -- courier whose assignment row was never written.
  UPDATE orders
  SET courier_assigned_at = COALESCE(
        courier_entered_at,
        courier_sent_at,
        assigned_at,
        shipped_at,
        ordered_at
      )
  WHERE courier_id IS NOT NULL
    AND courier_assigned_at IS NULL;

  GET DIAGNOSTICS v_fallback = ROW_COUNT;

  RAISE NOTICE 'courier_assigned_at: % dated from the audit log (exact), % estimated from later timestamps', v_audit, v_fallback;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- INDEXES
--
-- All three partial on the shippable scope, the same predicate every other
-- delivery index here uses (0019, 0030): an unpaid order with no address is
-- never in any of these reports, and excluding them keeps the indexes small.
--
-- The last two are for the reports screen's monthly chart, which groups on
-- them, and for its "count by shipped / delivered" date modes.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_orders_courier_assigned_at
  ON orders (courier_assigned_at DESC)
  WHERE payment_status = 'paid' AND address_line1 IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_shipped_at
  ON orders (shipped_at DESC)
  WHERE payment_status = 'paid' AND address_line1 IS NOT NULL
    AND shipped_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_delivered_at
  ON orders (delivered_at DESC)
  WHERE payment_status = 'paid' AND address_line1 IS NOT NULL
    AND delivered_at IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- portal_orders, rebuilt for the two new columns
-- ─────────────────────────────────────────────────────────────────────────────
--
-- THE RULE from 0028, and its second half from 0040: adding a column to
-- `orders` means rebuilding this view in the same migration, because `SELECT
-- o.*` was expanded into a fixed column list the day the view was created —
-- and copy the body from the LATEST migration that creates it, which is 0055,
-- never from an older one. Nothing below differs from 0055; the two new
-- columns arrive through the o.* expansion.

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

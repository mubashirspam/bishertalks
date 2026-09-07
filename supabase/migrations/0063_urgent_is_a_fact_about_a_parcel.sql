-- Which parcels are in a hurry, and who is meant to carry them.
--
-- APPLY THIS BY HAND. Migrations here are not run automatically.
--
-- WHY THIS EXISTS
--
-- A direct sale is entered by somebody who was standing there when it was
-- sold. They know two things nobody downstream can work out from the row —
-- whether the buyer needs it quickly, and which service it is going by — and
-- until now there was nowhere to put either, so both were lost between the
-- counter and the packing table.
--
-- `courier_id` already existed (0030) and needs nothing new: choosing it on
-- the form is the same routing the delivery queue does, done earlier by the
-- person who already knows the answer.
--
-- Urgency had no column at all.Asif P
Asarithodi 
Nallalam (PO)
Kozhikode -673027
Mobile -9895261530
--
-- WHY A COLUMN AND NOT A TAG OR A NOTE
--
-- `notes` is free text and already carries everything from "ring before
-- delivery" to a spelling of the buyer's name. A queue cannot sort on it, a
-- filter cannot select on it, and "urgent" written in it is invisible to
-- every screen. This is a fact the delivery queue has to be able to see at a
-- glance and order by, so it is a column with two legal values.
--
-- WHY IT IS NOT ONLY FOR DIRECT SALES
--
-- Nothing here mentions sales_channel. An online order can be urgent too — a
-- customer writes in and says they need it before Friday — and giving direct
-- sales a private notion of urgency would mean the delivery queue could not
-- treat the two the same. The form for online orders can grow the same picker
-- whenever somebody wants it.

-- 'normal' | 'urgent'. NOT NULL with a default, so every existing order and
-- every future write that does not mention it is normal — which is true, and
-- avoids a nullable third state meaning the same thing as one of the two.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS delivery_priority TEXT NOT NULL DEFAULT 'normal';

-- The constraint is what stops a typo in a future write path inventing a third
-- priority that no screen has a badge for. Added separately and guarded, so
-- re-running this file does not fail on an existing constraint.
DO $$
BEGIN
  ALTER TABLE orders
    ADD CONSTRAINT orders_delivery_priority_check
    CHECK (delivery_priority IN ('normal', 'urgent'));
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'orders_delivery_priority_check already exists';
END $$;

-- Urgent parcels are a small set that gets read constantly — the queue's whole
-- reason for showing them is "what must go out today" — so the index covers
-- only them. A full index on a column that is 'normal' for 99% of rows would
-- be mostly dead weight.
CREATE INDEX IF NOT EXISTS idx_orders_urgent
  ON orders (ordered_at DESC)
  WHERE delivery_priority = 'urgent';

-- ── The portal view has to be rebuilt ────────────────────────────────────
--
-- portal_orders is `SELECT o.*, …`, and that star was expanded when the view
-- was created — so a new column on `orders` does NOT appear in it until the
-- view is recreated, and the delivery queue reads the queue's columns from the
-- view. CREATE OR REPLACE VIEW cannot change an existing view's column list
-- (the same wall 0019 hit), so it has to be dropped and rebuilt.
--
-- The definition below is 0057's, character for character and deliberately
-- unchanged: work_at, work_day, work_at_is_assignment, courier_tracks,
-- delivery_stage and handover_state are all still exactly what they were.
-- Every one of them is load-bearing — the portal sorts on work_at and the
-- queue's whole "where is this parcel really" column is handover_state — and
-- retyping this by hand is how one of them quietly changes meaning. The only
-- difference in the result is the column `o.*` now brings with it.

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

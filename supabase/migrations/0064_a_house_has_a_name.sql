-- A house has a name, and a parcel that cannot find it comes back.
--
-- APPLY THIS BY HAND. Migrations here are not run automatically.
-- APPLY 0063 FIRST — this rebuilds the same view and expects its column.
--
-- WHY THIS EXISTS
--
-- The address this shop collects is two free-text lines. 19.7% of paid orders
-- have nothing in the second one at all, and 13.7% have a first line longer
-- than the fifty characters India Post allows per line — so the postal sheet
-- has to abbreviate and repack prose before it can book them
-- (packReceiverAddress in lib/india-post/bulk-sheet.ts).
--
-- Two lines of prose is the wrong shape for the one question a delivery agent
-- actually asks, which is "which house is it". Amazon and Flipkart both ask
-- for the house or building by name in its own box, and they ask because a
-- named house is findable when a street name is not.
--
-- WHAT THE FIELDS MEAN, AND WHY THE EXISTING TWO ARE NOT MOVED
--
--   house_name      "Thoppil House". The new required one, and the point of
--                   this migration.
--   door_no         "2B", a flat or floor. Separate from the house because a
--                   building can hold forty of them.
--   address_line1   area, street, locality — UNCHANGED. This is what the
--                   column has always mostly held, so nothing is migrated and
--                   no history moves.
--   address_line2   landmark — also unchanged. Both forms already label it
--                   "landmark / area".
--   address_type    home | office, defaulting to home.
--
-- Nothing is backfilled and nothing is rewritten. 5,598 existing addresses
-- keep exactly the text they have; the new columns are simply null on them,
-- and lib/address.ts renders a row with no house name exactly as it renders
-- today. A migration that tried to guess which half of a free-text line was a
-- house name would corrupt real addresses to make old rows look tidy.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS house_name TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS door_no TEXT;

-- NOT NULL with a default, like delivery_priority in 0063: every existing row
-- is a home delivery, which is true, and a nullable third state meaning the
-- same as 'home' would have to be handled everywhere forever.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS address_type TEXT NOT NULL DEFAULT 'home';

DO $$
BEGIN
  ALTER TABLE orders
    ADD CONSTRAINT orders_address_type_check
    CHECK (address_type IN ('home', 'office'));
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'orders_address_type_check already exists';
END $$;

COMMENT ON COLUMN orders.house_name IS
  'House or building by name — "Thoppil House". Required on new addresses from '
  '0064; null on the 5,598 collected before it. Composed into the printed '
  'address by lib/address.ts, which is the only place that ordering is decided.';

-- ── The portal view, again ───────────────────────────────────────────────
--
-- Same reason as 0063: portal_orders is SELECT o.*, that star was expanded when
-- the view was created, and three new columns do not reach the delivery queue
-- or the portal until it is rebuilt. Definition unchanged from 0057.
--
-- The DROP is not optional and was missing from the first version of this
-- file, which failed on a database that already had the view with
-- "42P07: relation portal_orders already exists". CREATE OR REPLACE cannot
-- stand in for it: replacing a view cannot change its column list, and a new
-- column list is the entire purpose here.

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

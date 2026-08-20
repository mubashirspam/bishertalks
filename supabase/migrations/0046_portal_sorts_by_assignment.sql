-- The portal lists parcels by the day they were ASSIGNED, not the day they
-- were ordered.
--
-- Why this was wrong: the portal is a worklist, and its day headings were the
-- customer's day rather than the agent's. Assignment lags ordering by anything
-- from a few hours to eight days, so a batch routed on one morning arrived on
-- screen scattered across a week of order dates. "What did I hand out today"
-- was a question the screen could not answer, which is the only question
-- somebody opening it actually has.
--
-- WHAT "ASSIGNED" MEANS HERE: `assigned_at` (0019), stamped when an agent is
-- picked on /admin/delivery. Not the courier routing — there is no timestamp
-- for that, and inventing one would mean backfilling ~250 parcels from
-- `updated_at`, which moves on any edit and would put confident wrong dates on
-- the screen.
--
-- THE FALLBACK, and it is load-bearing: about a quarter of the portal is
-- parcels routed straight to a courier with no agent, so `assigned_at` is NULL
-- on them. Sorting those last would push a quarter of the work below the fold;
-- dropping them would lose it. So `work_at` falls back to `ordered_at`, and
-- `work_at_is_assignment` says which of the two a row is using — the screen
-- labels it, because a date that silently means two different things is worse
-- than either.
--
-- `ist_day` stays. Nothing reads it after this migration, but a deploy is not
-- atomic: the running build orders by it, and removing the column would blank
-- the portal for whatever window separates the migration from the new code.

-- ─────────────────────────────────────────────────────────────────────────────
-- portal_orders, now carrying the work day
-- ─────────────────────────────────────────────────────────────────────────────
--
-- THE RULE from 0028, and its second half from 0040: rebuild this view whenever
-- `orders` changes, and copy the definition from the LATEST migration that
-- creates it — 0045 — never from an older one. The only change here is the
-- three `work_*` columns.

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

-- ─────────────────────────────────────────────────────────────────────────────
-- The index that makes the day filter a lookup
-- ─────────────────────────────────────────────────────────────────────────────
--
-- On the expression, not on `assigned_at`: the day picker filters on
-- COALESCE(assigned_at, ordered_at) as a range, and an index on the bare column
-- cannot serve that — a quarter of these rows have a NULL assigned_at and take
-- their value from the other column entirely.
--
-- It serves the FILTER, not the sort. The sort key is `work_day`, and the IST
-- conversion behind it is STABLE rather than IMMUTABLE, so it cannot be indexed
-- at all — Postgres sorts those in memory. That is fine at ~1,400 rows and is
-- noted here so nobody later mistakes the missing index for an oversight.

CREATE INDEX IF NOT EXISTS idx_orders_work_at
  ON orders ((COALESCE(assigned_at, ordered_at)) DESC);

NOTIFY pgrst, 'reload schema';

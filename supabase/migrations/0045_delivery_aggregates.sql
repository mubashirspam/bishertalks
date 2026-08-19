-- The delivery screen, answered by the database instead of by Node.
--
-- Two things this replaces, both of which read the same rows:
--
--   deliveryStageCounts  eight COUNT queries, one per tab
--   deliveryStats        every shippable parcel paged into Node, 1000 at a
--                        time, and reduced there
--
-- Neither was slow because the data is large — there are ~1,400 orders. They
-- were slow because they were many round trips, and until the app moved into
-- the same region as the database a round trip was ~450ms.
--
-- THE RISK THIS FILE HAS TO MANAGE is not performance, it is drift. The filters
-- exist in TypeScript (buildDeliveryQuery) and now also here, and if the two
-- ever disagree the tab counts stop matching the rows inside the tab — which
-- has happened before on this screen, and is worse than being slow. So the
-- filtering is written ONCE, in `delivery_scope`, and both functions below
-- select from it. Adding a filter means editing that one function and
-- buildDeliveryQuery, and nothing else.
--
-- The stage derivation moves into the view for the same reason: it existed in
-- SQL (applyDeliveryFilter) and in TypeScript (deliveryStage), in two shapes
-- that had to agree by hand.

-- ─────────────────────────────────────────────────────────────────────────────
-- portal_orders, now carrying the stage
-- ─────────────────────────────────────────────────────────────────────────────
--
-- THE RULE from 0028, and its second half from 0040: rebuild this view whenever
-- `orders` changes, and copy the definition from the LATEST migration that
-- creates it — 0044 — never from an older one. The only change here is the new
-- `delivery_stage` column.
--
-- It mirrors deliveryStage() in lib/delivery-stage.ts exactly, including the
-- part that is easy to get wrong: a parcel is 'assigned' if EITHER a courier or
-- an agent has it. Reading only the agent left parcels that were with Delhivery
-- showing as "New — not routed".
--
-- Having it as a column also fixes a live bug in applyDeliveryFilter: the
-- 'assigned' tab was expressed as an `or()`, and the search box uses the only
-- other `or()` PostgREST can safely carry — so searching while on that tab
-- could return the wrong rows. One equality cannot collide with anything.

DROP VIEW IF EXISTS portal_orders;

CREATE VIEW portal_orders AS
SELECT
  o.*,
  -- ordered_at is UTC; the agent's day is an IST calendar day. Without the
  -- conversion every order placed after 6:30pm IST sorts into tomorrow.
  (o.ordered_at AT TIME ZONE 'Asia/Kolkata')::date AS ist_day,
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

REVOKE ALL ON portal_orders FROM PUBLIC;
REVOKE ALL ON portal_orders FROM anon, authenticated;
GRANT SELECT ON portal_orders TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- The scope — every filter, written once
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Mirrors buildDeliveryQuery in lib/db/delivery-query.ts, minus the stage: the
-- counts group by it and the stats strip deliberately ignores it (narrowing to
-- one tab and then reporting "100% shipped" would be a mirror, not a fact).
--
-- Every parameter is nullable and a NULL means "no filter", so a caller passing
-- nothing gets the whole shippable queue. Ids arrive as text and are compared
-- as text on purpose — casting a parameter to uuid would throw on the string
-- "none", which is a real value here meaning "nobody".

-- Returns named columns rather than SETOF portal_orders, and that is not a
-- style choice. A function whose return type IS the view depends on the view's
-- composite type, and every future migration here begins with
-- `DROP VIEW IF EXISTS portal_orders` — which would fail on that dependency and
-- take the next schema change with it. The body may reference the view freely;
-- a SQL function body in a string literal creates no dependency. Only the
-- signature does.
--
-- These seven columns are everything the two aggregates below read. Adding to
-- the list is cheap; returning the whole view is a trap.

CREATE OR REPLACE FUNCTION delivery_scope(
  p_from     TIMESTAMPTZ DEFAULT NULL,
  p_to       TIMESTAMPTZ DEFAULT NULL,
  p_q        TEXT DEFAULT NULL,
  p_agent    TEXT DEFAULT NULL,
  p_courier  TEXT DEFAULT NULL,
  p_handover TEXT DEFAULT NULL,
  p_books    TEXT DEFAULT NULL,
  p_gift     TEXT DEFAULT NULL,
  p_signed   TEXT DEFAULT NULL
)
RETURNS TABLE (
  delivery_stage     TEXT,
  assigned_agent_id  UUID,
  assigned_at        TIMESTAMPTZ,
  courier_entered_at TIMESTAMPTZ,
  shipped_at         TIMESTAMPTZ,
  delivered_at       TIMESTAMPTZ,
  ordered_at         TIMESTAMPTZ
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    o.delivery_stage,
    o.assigned_agent_id,
    o.assigned_at,
    o.courier_entered_at,
    o.shipped_at,
    o.delivered_at,
    o.ordered_at
  FROM portal_orders o
  WHERE
    -- The definition of "shippable", same as buildDeliveryQuery's base scope.
    o.payment_status = 'paid'
    AND o.address_line1 IS NOT NULL

    AND (p_from IS NULL OR o.ordered_at >= p_from)
    AND (p_to   IS NULL OR o.ordered_at <  p_to)

    AND (
      p_agent IS NULL
      OR (p_agent = 'none' AND o.assigned_agent_id IS NULL)
      OR (p_agent <> 'none' AND o.assigned_agent_id::text = p_agent)
    )

    AND (
      p_courier IS NULL
      OR (p_courier = 'none' AND o.courier_id IS NULL)
      OR (p_courier <> 'none' AND o.courier_id::text = p_courier)
    )

    AND (p_handover IS NULL OR o.handover_state = p_handover)

    -- quantity is NOT NULL DEFAULT 1 and is_gift/is_signed NOT NULL DEFAULT
    -- FALSE, so plain comparisons catch every old row.
    AND (p_books IS NULL
         OR (p_books = 'multi'  AND o.quantity >= 2)
         OR (p_books = 'single' AND o.quantity  = 1))

    AND (p_gift IS NULL
         OR (p_gift = 'yes' AND o.is_gift)
         OR (p_gift = 'no'  AND NOT o.is_gift))

    AND (p_signed IS NULL OR p_signed <> 'yes' OR o.is_signed)

    -- Same five columns the TypeScript search covers, and the same characters
    -- stripped — %, comma and brackets are PostgREST syntax there and wildcards
    -- here, so a customer searching for "(" must not become a pattern.
    AND (
      p_q IS NULL
      OR translate(p_q, '%,()', '') = ''
      OR o.order_number    ILIKE '%' || translate(p_q, '%,()', '') || '%'
      OR o.buyer_name      ILIKE '%' || translate(p_q, '%,()', '') || '%'
      OR o.buyer_phone     ILIKE '%' || translate(p_q, '%,()', '') || '%'
      OR o.pincode         ILIKE '%' || translate(p_q, '%,()', '') || '%'
      OR o.tracking_number ILIKE '%' || translate(p_q, '%,()', '') || '%'
    )
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- The tab counts — one query instead of eight
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Stages with no parcels are simply absent from the result. The caller fills
-- them in as zero, which it has to do anyway to draw an empty tab.
--
-- "all" is not returned: the caller sums, so the total can never disagree with
-- the parts it is displayed beside.

CREATE OR REPLACE FUNCTION delivery_counts(
  p_from     TIMESTAMPTZ DEFAULT NULL,
  p_to       TIMESTAMPTZ DEFAULT NULL,
  p_q        TEXT DEFAULT NULL,
  p_agent    TEXT DEFAULT NULL,
  p_courier  TEXT DEFAULT NULL,
  p_handover TEXT DEFAULT NULL,
  p_books    TEXT DEFAULT NULL,
  p_gift     TEXT DEFAULT NULL,
  p_signed   TEXT DEFAULT NULL
)
RETURNS TABLE (stage TEXT, n BIGINT)
LANGUAGE sql
STABLE
AS $$
  SELECT s.delivery_stage, COUNT(*)
  FROM delivery_scope(p_from, p_to, p_q, p_agent, p_courier,
                      p_handover, p_books, p_gift, p_signed) s
  GROUP BY s.delivery_stage
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- The stats strip — one row instead of the whole table
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Returns jsonb because the shape is nested (totals, a row per agent, ageing,
-- a fortnight of throughput) and one document is easier to keep in step with
-- the TypeScript interface than four out parameters.
--
-- Agent names are deliberately NOT joined here. The caller already has the
-- staff list and knows what to call an agent who has since been switched off
-- ("Removed agent"); putting that string in the database would be a second
-- place to change it.
--
-- One deliberate correction while porting: staleness now measures from
-- ordered_at, not created_at. The TypeScript had ordered_at for the ageing
-- counters and created_at for the per-agent stale count — the same figure
-- measured two ways, one of which counted the days a customer spent deciding
-- as days we failed to ship.
--
-- `sampled` is gone from the maths: it existed because Node could only read
-- 20,000 rows before giving up, and an aggregate has no such ceiling. The
-- caller still reports false so the strip's contract does not change.

CREATE OR REPLACE FUNCTION delivery_stats_summary(
  p_from     TIMESTAMPTZ DEFAULT NULL,
  p_to       TIMESTAMPTZ DEFAULT NULL,
  p_q        TEXT DEFAULT NULL,
  p_agent    TEXT DEFAULT NULL,
  p_courier  TEXT DEFAULT NULL,
  p_handover TEXT DEFAULT NULL,
  p_books    TEXT DEFAULT NULL,
  p_gift     TEXT DEFAULT NULL,
  p_signed   TEXT DEFAULT NULL,
  p_days     INT DEFAULT 14
)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
  WITH scope AS (
    SELECT * FROM delivery_scope(p_from, p_to, p_q, p_agent, p_courier,
                                 p_handover, p_books, p_gift, p_signed)
  ),

  totals AS (
    SELECT jsonb_object_agg(delivery_stage, n) AS v
    FROM (SELECT delivery_stage, COUNT(*) AS n FROM scope GROUP BY 1) t
  ),

  -- Only parcels still ours to chase: routed, and not yet keyed into the
  -- courier's system.
  ageing AS (
    SELECT
      COUNT(*) FILTER (
        WHERE courier_entered_at IS NULL
          AND NOW() - COALESCE(assigned_at, ordered_at) >  INTERVAL '24 hours'
          AND NOW() - COALESCE(assigned_at, ordered_at) <= INTERVAL '48 hours'
      ) AS over24h,
      COUNT(*) FILTER (
        WHERE courier_entered_at IS NULL
          AND NOW() - COALESCE(assigned_at, ordered_at) > INTERVAL '48 hours'
      ) AS over48h,
      MIN(ordered_at) AS oldest_unshipped
    FROM scope
    WHERE delivery_stage = 'assigned'
  ),

  agents AS (
    SELECT COALESCE(jsonb_agg(a ORDER BY a.assigned DESC, a.id), '[]'::jsonb) AS v
    FROM (
      SELECT
        assigned_agent_id::text AS id,
        COUNT(*) FILTER (WHERE delivery_stage = 'assigned') AS assigned,
        COUNT(*) FILTER (
          WHERE delivery_stage = 'assigned' AND courier_entered_at IS NOT NULL
        ) AS confirmed,
        COUNT(*) FILTER (
          WHERE delivery_stage IN ('shipped', 'out_for_delivery')
        ) AS shipped,
        COUNT(*) FILTER (WHERE delivery_stage = 'delivered') AS delivered,
        COUNT(*) FILTER (WHERE delivery_stage = 'returned')  AS returned,
        COUNT(*) FILTER (
          WHERE delivery_stage = 'assigned'
            AND courier_entered_at IS NULL
            AND NOW() - COALESCE(assigned_at, ordered_at) > INTERVAL '24 hours'
        ) AS stale
      FROM scope
      WHERE assigned_agent_id IS NOT NULL
      GROUP BY assigned_agent_id
    ) a
  ),

  -- Shipped and delivered per IST day. A parcel contributes to both days if it
  -- shipped on one and arrived on another, which is what the chart shows.
  throughput AS (
    SELECT COALESCE(jsonb_agg(d ORDER BY d.day), '[]'::jsonb) AS v
    FROM (
      SELECT
        day,
        COUNT(*) FILTER (WHERE kind = 'shipped')   AS shipped,
        COUNT(*) FILTER (WHERE kind = 'delivered') AS delivered
      FROM (
        SELECT (shipped_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
               'shipped' AS kind
        FROM scope WHERE shipped_at IS NOT NULL
        UNION ALL
        SELECT (delivered_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
               'delivered' AS kind
        FROM scope WHERE delivered_at IS NOT NULL
      ) events
      GROUP BY day
      ORDER BY day DESC
      LIMIT p_days
    ) d
  )

  SELECT jsonb_build_object(
    'totals',     COALESCE((SELECT v FROM totals), '{}'::jsonb),
    'agents',     (SELECT v FROM agents),
    'throughput', (SELECT v FROM throughput),
    'ageing', jsonb_build_object(
      'over24h',         (SELECT over24h FROM ageing),
      'over48h',         (SELECT over48h FROM ageing),
      'oldestUnshipped', (SELECT oldest_unshipped FROM ageing)
    )
  )
$$;

-- Service-role only, like every other function here. These read every
-- customer's name, phone and pincode through the view.
REVOKE ALL ON FUNCTION delivery_scope(TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION delivery_counts(TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION delivery_stats_summary(TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION delivery_scope(TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION delivery_counts(TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION delivery_stats_summary(TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INT) TO service_role;

NOTIFY pgrst, 'reload schema';

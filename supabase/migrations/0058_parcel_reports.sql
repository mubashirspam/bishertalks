-- The reports screen, answered by the database.
--
-- Same architecture as 0045, for the same reason it gives: the filters exist in
-- TypeScript and in SQL, and if the two disagree a count stops matching the
-- list behind it — which is the one thing a report must never do. So the
-- filtering is written ONCE, in `report_scope`, and everything reads through
-- it: the summary tiles, the courier table, the row list, and the Excel export.
-- Adding a filter means editing that one function and `lib/report-filters.ts`,
-- and nothing else.
--
-- WHAT THIS ANSWERS that the delivery screen cannot:
--
--   * how many parcels each courier has, split by where they are
--   * which parcels are late, by a threshold the reader chooses
--   * how long parcels have been waiting, in buckets
--   * what was assigned / shipped / delivered on a given day or in a given month
--   * everything above as a spreadsheet
--
-- The delivery screen is a worklist: it shows what to do next, filtered to one
-- stage at a time, and its date filter is always the order date. This is the
-- other question — not "what do I do now" but "what happened, and what is
-- stuck".

-- ─────────────────────────────────────────────────────────────────────────────
-- THE SCOPE — every filter, written once
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Named columns rather than SETOF portal_orders, and that is not a style
-- choice — see the note in 0045. A function whose return type IS the view
-- depends on the view's composite type, and every migration that touches
-- `orders` begins with `DROP VIEW IF EXISTS portal_orders`, which would then
-- fail and take the next schema change with it.
--
-- Every parameter is nullable and NULL means "no filter", so a caller passing
-- nothing gets every parcel. Ids arrive as text and are compared as text on
-- purpose: casting to uuid would throw on the string "none", which is a real
-- value here meaning "nobody".
--
-- ── The three computed columns ──
--
-- days_pending    whole IST CALENDAR days from the order to its end — delivery,
--                 return, or now for anything still in flight. Calendar days,
--                 not 24-hour periods: a parcel ordered at 11pm and looked at
--                 at 9am the next morning is one day old, which is what a
--                 person means by "a day". Elapsed-hours arithmetic would call
--                 it zero.
-- days_in_transit shipped → delivered, or shipped → now. NULL if never shipped.
-- is_late         computed from p_late / p_late_from on EVERY row, and used as
--                 a filter only when p_only_late is true. Two separate things:
--                 the row list wants to show a late badge on a list that also
--                 contains parcels which are fine, and the "Late" tile wants a
--                 count of them within an unfiltered whole.
--
-- ── Why a NULL basis is not late ──
--
-- Lateness is measured from ordered_at (default), courier_assigned_at, or
-- shipped_at. Where that timestamp does not exist the parcel is NOT late: a
-- parcel that has never shipped cannot be "more than 10 days since shipping",
-- and reporting it as such would put every unrouted parcel at the top of a
-- list about parcels stuck in transit. Choosing a basis is choosing a
-- question, and the parcels that cannot answer it are not the answer.

CREATE OR REPLACE FUNCTION report_scope(
  -- Which date p_from / p_to test. 'ordered' (default), 'courier_assigned',
  -- 'agent_assigned', 'shipped', 'delivered'.
  --
  -- Anything but 'ordered' also REQUIRES that date to exist: counting by
  -- shipping date over parcels that never shipped is not a smaller answer, it
  -- is a wrong one. This is what makes "shipped this year" and "assigned on
  -- 24 August" mean what they say.
  p_by         TEXT DEFAULT 'ordered',
  p_from       TIMESTAMPTZ DEFAULT NULL,
  p_to         TIMESTAMPTZ DEFAULT NULL,
  p_courier    TEXT DEFAULT NULL,
  p_agent      TEXT DEFAULT NULL,
  -- Several at once, unlike the delivery screen's single tab: "in transit" is
  -- shipped + out for delivery, and asking for it should not take two reads.
  p_stages     TEXT[] DEFAULT NULL,
  p_handover   TEXT DEFAULT NULL,
  p_late       INT DEFAULT 10,
  p_late_from  TEXT DEFAULT 'ordered',
  p_only_late  BOOLEAN DEFAULT FALSE,
  p_age_min    INT DEFAULT NULL,
  p_age_max    INT DEFAULT NULL,
  p_books      TEXT DEFAULT NULL,
  p_gift       TEXT DEFAULT NULL,
  p_signed     TEXT DEFAULT NULL,
  p_q          TEXT DEFAULT NULL,
  p_state      TEXT DEFAULT NULL
)
RETURNS TABLE (
  order_number        TEXT,
  buyer_name          TEXT,
  buyer_phone         TEXT,
  address_line1       TEXT,
  address_line2       TEXT,
  city                TEXT,
  district            TEXT,
  state               TEXT,
  pincode             TEXT,
  amount_paise        INTEGER,
  refunded_paise      INTEGER,
  quantity            INT,
  is_gift             BOOLEAN,
  is_signed           BOOLEAN,
  courier_id          UUID,
  assigned_agent_id   UUID,
  delivery_stage      TEXT,
  handover_state      TEXT,
  status              TEXT,
  ordered_at          TIMESTAMPTZ,
  courier_assigned_at TIMESTAMPTZ,
  assigned_at         TIMESTAMPTZ,
  courier_entered_at  TIMESTAMPTZ,
  courier_sent_at     TIMESTAMPTZ,
  shipped_at          TIMESTAMPTZ,
  delivered_at        TIMESTAMPTZ,
  returned_at         TIMESTAMPTZ,
  tracking_number     TEXT,
  courier_reference   TEXT,
  postal_barcode      TEXT,
  days_pending        INT,
  days_in_transit     INT,
  is_late             BOOLEAN
)
LANGUAGE sql
STABLE
AS $$
  WITH computed AS (
    SELECT
      o.*,
      -- The date this report is counting by.
      CASE p_by
        WHEN 'courier_assigned' THEN o.courier_assigned_at
        WHEN 'agent_assigned'   THEN o.assigned_at
        WHEN 'shipped'          THEN o.shipped_at
        WHEN 'delivered'        THEN o.delivered_at
        ELSE o.ordered_at
      END AS basis_at,

      -- The date lateness is measured from, which is a different choice.
      CASE p_late_from
        WHEN 'courier_assigned' THEN o.courier_assigned_at
        WHEN 'shipped'          THEN o.shipped_at
        ELSE o.ordered_at
      END AS late_at,

      -- The parcel's journey ended here, or it has not ended.
      COALESCE(o.delivered_at, o.returned_at, NOW()) AS ended_at
    FROM portal_orders o
    WHERE
      -- The definition of "a parcel", identical to buildDeliveryQuery's base
      -- scope and delivery_scope's. A number on this screen is always findable
      -- on the delivery screen.
      o.payment_status = 'paid'
      AND o.address_line1 IS NOT NULL
  ),

  shaped AS (
    SELECT
      c.*,
      (
        (c.ended_at AT TIME ZONE 'Asia/Kolkata')::date
        - (c.ordered_at AT TIME ZONE 'Asia/Kolkata')::date
      )::int AS d_pending,
      CASE WHEN c.shipped_at IS NULL THEN NULL ELSE (
        (COALESCE(c.delivered_at, NOW()) AT TIME ZONE 'Asia/Kolkata')::date
        - (c.shipped_at AT TIME ZONE 'Asia/Kolkata')::date
      )::int END AS d_transit,
      (
        p_late IS NOT NULL
        AND p_late > 0
        AND c.late_at IS NOT NULL
        -- Only a parcel still owed to somebody can be late. A delivered one
        -- arrived, a returned one came back, and a cancelled one is not
        -- coming — none of them are waiting on anybody.
        AND c.delivery_stage NOT IN ('delivered', 'returned', 'cancelled')
        AND (
          (NOW() AT TIME ZONE 'Asia/Kolkata')::date
          - (c.late_at AT TIME ZONE 'Asia/Kolkata')::date
        ) > p_late
      ) AS late_flag
    FROM computed c
  )

  -- Every column cast to its declared type, which is not belt-and-braces.
  -- `orders` predates this migration folder — it was created in the Supabase
  -- console — so nothing in this repository states whether `order_number` is
  -- TEXT or VARCHAR, or `amount_paise` INTEGER or BIGINT. A SQL function whose
  -- body returns VARCHAR where its signature says TEXT fails at CALL time with
  -- "structure of query does not match function result type", which is a
  -- confusing error a long way from its cause. The casts make the signature
  -- true by construction.
  SELECT
    s.order_number::TEXT, s.buyer_name::TEXT, s.buyer_phone::TEXT,
    s.address_line1::TEXT, s.address_line2::TEXT, s.city::TEXT,
    s.district::TEXT, s.state::TEXT, s.pincode::TEXT,
    s.amount_paise::INTEGER, s.refunded_paise::INTEGER, s.quantity::INT,
    s.is_gift::BOOLEAN, s.is_signed::BOOLEAN,
    s.courier_id::UUID, s.assigned_agent_id::UUID,
    s.delivery_stage::TEXT, s.handover_state::TEXT, s.status::TEXT,
    s.ordered_at, s.courier_assigned_at, s.assigned_at,
    s.courier_entered_at, s.courier_sent_at,
    s.shipped_at, s.delivered_at, s.returned_at,
    s.tracking_number::TEXT, s.courier_reference::TEXT, s.postal_barcode::TEXT,
    s.d_pending, s.d_transit, s.late_flag
  FROM shaped s
  WHERE
    -- Counting by anything but the order date requires that date to exist.
    (p_by IS NULL OR p_by = 'ordered' OR s.basis_at IS NOT NULL)

    AND (p_from IS NULL OR s.basis_at >= p_from)
    AND (p_to   IS NULL OR s.basis_at <  p_to)

    AND (p_stages IS NULL OR s.delivery_stage = ANY(p_stages))

    AND (
      p_courier IS NULL
      OR (p_courier = 'none' AND s.courier_id IS NULL)
      OR (p_courier <> 'none' AND s.courier_id::text = p_courier)
    )

    AND (
      p_agent IS NULL
      OR (p_agent = 'none' AND s.assigned_agent_id IS NULL)
      OR (p_agent <> 'none' AND s.assigned_agent_id::text = p_agent)
    )

    AND (p_handover IS NULL OR s.handover_state = p_handover)

    -- quantity is NOT NULL DEFAULT 1 and is_gift/is_signed NOT NULL DEFAULT
    -- FALSE, so plain comparisons catch every old row.
    AND (p_books IS NULL
         OR (p_books = 'multi'  AND s.quantity >= 2)
         OR (p_books = 'single' AND s.quantity  = 1))

    AND (p_gift IS NULL
         OR (p_gift = 'yes' AND s.is_gift)
         OR (p_gift = 'no'  AND NOT s.is_gift))

    AND (p_signed IS NULL OR p_signed <> 'yes' OR s.is_signed)

    AND (NOT COALESCE(p_only_late, FALSE) OR s.late_flag)

    -- The ageing drill-down. Still-waiting parcels only, because an ageing
    -- bucket is about parcels somebody is owed — a delivered parcel's age is
    -- history, and mixing the two makes the buckets sum to more than the
    -- pipeline.
    --
    -- The three exclusions here MUST match the `ageing` CTE in report_summary
    -- exactly, cancelled included. They are the bar and the list behind it, and
    -- a bar reading 34 that opens a list of 41 is precisely the failure this
    -- whole file is arranged to prevent. Cancelled is the easy one to forget:
    -- a cancelled parcel's days_pending keeps climbing forever, so it lands in
    -- the oldest bucket and swamps exactly the list most worth reading.
    AND (p_age_min IS NULL OR (
      s.delivered_at IS NULL AND s.returned_at IS NULL
      AND s.delivery_stage <> 'cancelled'
      AND s.d_pending >= p_age_min
    ))
    AND (p_age_max IS NULL OR (
      s.delivered_at IS NULL AND s.returned_at IS NULL
      AND s.delivery_stage <> 'cancelled'
      AND s.d_pending <= p_age_max
    ))

    AND (p_state IS NULL OR lower(btrim(s.state)) = lower(btrim(p_state)))

    -- The same characters stripped as everywhere else — %, comma and brackets
    -- are PostgREST syntax there and wildcards here, so a customer whose name
    -- contains "(" must not become a pattern. Two fields wider than the
    -- delivery screen's search: the courier reference and the postal article
    -- number are how a parcel is named in a courier's own system, which is
    -- exactly what someone has in front of them when they come to this screen
    -- asking where something went.
    AND (
      p_q IS NULL
      OR translate(p_q, '%,()', '') = ''
      OR s.order_number      ILIKE '%' || translate(p_q, '%,()', '') || '%'
      OR s.buyer_name        ILIKE '%' || translate(p_q, '%,()', '') || '%'
      OR s.buyer_phone       ILIKE '%' || translate(p_q, '%,()', '') || '%'
      OR s.pincode           ILIKE '%' || translate(p_q, '%,()', '') || '%'
      OR s.tracking_number   ILIKE '%' || translate(p_q, '%,()', '') || '%'
      OR s.courier_reference ILIKE '%' || translate(p_q, '%,()', '') || '%'
      OR s.postal_barcode    ILIKE '%' || translate(p_q, '%,()', '') || '%'
    )
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- THE SUMMARY — one row for the whole top of the screen
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Returns jsonb because the shape is nested — tiles, ageing buckets, a row per
-- courier, a row per agent, a bar per month, a row per state — and one
-- document is easier to keep in step with a TypeScript interface than thirty
-- out parameters.
--
-- WHAT IT DELIBERATELY IGNORES: the stage chips, the ageing bucket, and the
-- late-only switch. It is the breakdown those three filters select FROM, and a
-- breakdown narrowed to one of its own rows is a mirror, not a fact — narrow
-- to Delivered and every tile would read 100% delivered. Same reasoning, and
-- the same rule, as delivery_stats_summary in 0045.
--
-- It passes p_late through, because the Late tile has to count with the
-- threshold the reader chose. Computing the flag is not filtering on it.
--
-- Names are NOT joined here. The caller already holds the courier and staff
-- lists, and knows what to call a courier switched off since or an agent
-- removed — putting those strings in a migration would be a second place to
-- change them.

CREATE OR REPLACE FUNCTION report_summary(
  p_by        TEXT DEFAULT 'ordered',
  p_from      TIMESTAMPTZ DEFAULT NULL,
  p_to        TIMESTAMPTZ DEFAULT NULL,
  p_courier   TEXT DEFAULT NULL,
  p_agent     TEXT DEFAULT NULL,
  p_handover  TEXT DEFAULT NULL,
  p_late      INT DEFAULT 10,
  p_late_from TEXT DEFAULT 'ordered',
  p_books     TEXT DEFAULT NULL,
  p_gift      TEXT DEFAULT NULL,
  p_signed    TEXT DEFAULT NULL,
  p_q         TEXT DEFAULT NULL,
  p_state     TEXT DEFAULT NULL,
  -- 'day' or 'month'. The caller picks: a fortnight of bars is readable, and
  -- so is a year of months, but a year of days is 365 slivers.
  p_bucket    TEXT DEFAULT 'month'
)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
  WITH scope AS (
    SELECT * FROM report_scope(
      p_by, p_from, p_to, p_courier, p_agent,
      NULL::TEXT[],          -- stages: this IS the stage breakdown
      p_handover,
      p_late, p_late_from,
      FALSE,                 -- only_late: this IS the late count
      -- Cast, not bare NULL: these are positional arguments and an untyped
      -- NULL would leave the parser guessing at the parameter's type.
      NULL::INT, NULL::INT,  -- ageing: this IS the ageing breakdown
      p_books, p_gift, p_signed, p_q, p_state
    )
  ),

  totals AS (
    SELECT jsonb_object_agg(delivery_stage, n) AS v
    FROM (SELECT delivery_stage, COUNT(*) AS n FROM scope GROUP BY 1) t
  ),

  headline AS (
    SELECT
      COUNT(*) AS parcels,
      COUNT(*) FILTER (WHERE is_late) AS late,
      COUNT(*) FILTER (WHERE delivery_stage IN ('new', 'assigned')) AS not_shipped,
      COUNT(*) FILTER (WHERE delivery_stage IN ('shipped', 'out_for_delivery')) AS in_transit,
      COUNT(*) FILTER (WHERE delivery_stage = 'delivered') AS delivered,
      COUNT(*) FILTER (WHERE delivery_stage = 'returned')  AS returned,
      COUNT(*) FILTER (WHERE delivery_stage = 'cancelled') AS cancelled,
      COALESCE(SUM(quantity), 0) AS books,
      -- What was kept, not what was charged: a refund came back out (0055).
      COALESCE(SUM(amount_paise - COALESCE(refunded_paise, 0)), 0) AS revenue_paise,
      -- Delivered parcels only. Averaging the ones still in flight would
      -- report a number that grows every day nothing happens.
      ROUND(AVG(days_pending) FILTER (WHERE delivered_at IS NOT NULL), 1) AS avg_days,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY days_pending)
        FILTER (WHERE delivered_at IS NOT NULL) AS median_days
    FROM scope
  ),

  -- How long the parcels still owed to somebody have been waiting. Undelivered
  -- and unreturned only — see the note on the ageing filter above.
  ageing AS (
    SELECT COALESCE(jsonb_object_agg(bucket, n), '{}'::jsonb) AS v
    FROM (
      SELECT
        CASE
          WHEN days_pending <= 2  THEN '0-2'
          WHEN days_pending <= 5  THEN '3-5'
          WHEN days_pending <= 10 THEN '6-10'
          WHEN days_pending <= 15 THEN '11-15'
          ELSE '16+'
        END AS bucket,
        COUNT(*) AS n
      FROM scope
      WHERE delivered_at IS NULL
        AND returned_at IS NULL
        AND delivery_stage <> 'cancelled'
      GROUP BY 1
    ) b
  ),

  -- The table this screen exists for. 'none' is a real row, not an omission:
  -- parcels nobody has routed are the largest pile on most days and the one
  -- most worth clicking.
  couriers AS (
    SELECT COALESCE(jsonb_agg(c ORDER BY c.parcels DESC), '[]'::jsonb) AS v
    FROM (
      SELECT
        COALESCE(courier_id::text, 'none') AS id,
        COUNT(*) AS parcels,
        COUNT(*) FILTER (WHERE delivery_stage IN ('new', 'assigned')) AS not_shipped,
        COUNT(*) FILTER (WHERE delivery_stage IN ('shipped', 'out_for_delivery')) AS in_transit,
        COUNT(*) FILTER (WHERE delivery_stage = 'delivered') AS delivered,
        COUNT(*) FILTER (WHERE delivery_stage = 'returned')  AS returned,
        COUNT(*) FILTER (WHERE delivery_stage = 'cancelled') AS cancelled,
        COUNT(*) FILTER (WHERE is_late) AS late,
        ROUND(AVG(days_pending) FILTER (WHERE delivered_at IS NOT NULL), 1) AS avg_days
      FROM scope
      GROUP BY 1
    ) c
  ),

  agents AS (
    SELECT COALESCE(jsonb_agg(a ORDER BY a.parcels DESC), '[]'::jsonb) AS v
    FROM (
      SELECT
        assigned_agent_id::text AS id,
        COUNT(*) AS parcels,
        COUNT(*) FILTER (WHERE delivery_stage IN ('new', 'assigned')) AS holding,
        COUNT(*) FILTER (WHERE delivery_stage IN ('shipped', 'out_for_delivery')) AS in_transit,
        COUNT(*) FILTER (WHERE delivery_stage = 'delivered') AS delivered,
        COUNT(*) FILTER (WHERE delivery_stage = 'returned')  AS returned,
        COUNT(*) FILTER (WHERE is_late) AS late
      FROM scope
      WHERE assigned_agent_id IS NOT NULL
      GROUP BY 1
    ) a
  ),

  -- Shipped and delivered over time. A parcel contributes to both series, on
  -- whichever day or month each event happened — which is the point: the gap
  -- between the two lines is how long the road is taking.
  --
  -- Ordered ascending and NOT limited: the caller chose the range, and a chart
  -- that silently drops its own earliest months would misreport a year.
  buckets AS (
    SELECT COALESCE(jsonb_agg(d ORDER BY d.bucket), '[]'::jsonb) AS v
    FROM (
      SELECT
        bucket,
        COUNT(*) FILTER (WHERE kind = 'shipped')   AS shipped,
        COUNT(*) FILTER (WHERE kind = 'delivered') AS delivered
      FROM (
        SELECT
          to_char(
            date_trunc(
              CASE WHEN p_bucket = 'day' THEN 'day' ELSE 'month' END,
              (shipped_at AT TIME ZONE 'Asia/Kolkata')
            ),
            CASE WHEN p_bucket = 'day' THEN 'YYYY-MM-DD' ELSE 'YYYY-MM' END
          ) AS bucket,
          'shipped' AS kind
        FROM scope WHERE shipped_at IS NOT NULL
        UNION ALL
        SELECT
          to_char(
            date_trunc(
              CASE WHEN p_bucket = 'day' THEN 'day' ELSE 'month' END,
              (delivered_at AT TIME ZONE 'Asia/Kolkata')
            ),
            CASE WHEN p_bucket = 'day' THEN 'YYYY-MM-DD' ELSE 'YYYY-MM' END
          ) AS bucket,
          'delivered' AS kind
        FROM scope WHERE delivered_at IS NOT NULL
      ) events
      GROUP BY bucket
    ) d
  ),

  -- Where the parcels go, and whether they arrive. Ten rows: this is a hint
  -- about geography, not a census, and a table of every state in India would
  -- push everything below it off the screen.
  states AS (
    SELECT COALESCE(jsonb_agg(s ORDER BY s.parcels DESC), '[]'::jsonb) AS v
    FROM (
      SELECT
        btrim(state) AS name,
        COUNT(*) AS parcels,
        COUNT(*) FILTER (WHERE delivery_stage = 'delivered') AS delivered,
        COUNT(*) FILTER (WHERE delivery_stage = 'returned')  AS returned,
        COUNT(*) FILTER (WHERE is_late) AS late,
        ROUND(AVG(days_pending) FILTER (WHERE delivered_at IS NOT NULL), 1) AS avg_days
      FROM scope
      WHERE state IS NOT NULL AND btrim(state) <> ''
      GROUP BY 1
      ORDER BY 2 DESC
      LIMIT 10
    ) s
  )

  SELECT jsonb_build_object(
    'totals',   COALESCE((SELECT v FROM totals), '{}'::jsonb),
    'ageing',   (SELECT v FROM ageing),
    'couriers', (SELECT v FROM couriers),
    'agents',   (SELECT v FROM agents),
    'buckets',  (SELECT v FROM buckets),
    'states',   (SELECT v FROM states),
    'bucket_unit', CASE WHEN p_bucket = 'day' THEN 'day' ELSE 'month' END,
    'headline', (
      SELECT jsonb_build_object(
        'parcels',       h.parcels,
        'late',          h.late,
        'not_shipped',   h.not_shipped,
        'in_transit',    h.in_transit,
        'delivered',     h.delivered,
        'returned',      h.returned,
        'cancelled',     h.cancelled,
        'books',         h.books,
        'revenue_paise', h.revenue_paise,
        'avg_days',      h.avg_days,
        'median_days',   h.median_days
      )
      FROM headline h
    )
  )
$$;

-- Service-role only, like every other function here. Both read every
-- customer's name, phone and address through the view.
REVOKE ALL ON FUNCTION report_scope(TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT[], TEXT, INT, TEXT, BOOLEAN, INT, INT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION report_summary(TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, INT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION report_scope(TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT[], TEXT, INT, TEXT, BOOLEAN, INT, INT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION report_summary(TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, INT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';

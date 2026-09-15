-- The courier's remark, as a filter on the reports screen.
--
-- The delivery portal already filters on it ("Any remark" — the last segment
-- of courier_last_scan: "Consignee Unavailable", "RTO Intransit", a hub name).
-- The reports screen could not, so "how many parcels are sitting at
-- Consignee Unavailable, and which" had to be counted by hand. This adds
-- p_remark to both functions, matched exactly the way the portal matches it
-- (lib/db/delivery-portal.ts): %, _, comma and brackets turned into spaces,
-- trimmed, then a case-insensitive substring of courier_last_scan.
--
-- The summary applies it too. Unlike stage/ageing/late-only it is not a
-- breakdown the summary is made of — it narrows WHICH parcels are counted,
-- the same kind of filter as courier or state.
--
-- courier_last_scan is also returned now, so the table and the export can show
-- the remark a row was selected by.
--
-- Adding a parameter and a result column changes both signatures, so the old
-- functions are dropped rather than replaced — CREATE OR REPLACE would leave
-- an overload behind for PostgREST to trip over. Everything else is 0058
-- verbatim; see that file for the reasoning behind each clause.

DROP FUNCTION IF EXISTS report_summary(TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, INT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS report_scope(TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT[], TEXT, INT, TEXT, BOOLEAN, INT, INT, TEXT, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION report_scope(
  p_by         TEXT DEFAULT 'ordered',
  p_from       TIMESTAMPTZ DEFAULT NULL,
  p_to         TIMESTAMPTZ DEFAULT NULL,
  p_courier    TEXT DEFAULT NULL,
  p_agent      TEXT DEFAULT NULL,
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
  p_state      TEXT DEFAULT NULL,
  -- The courier's own wording, substring. Last so every existing positional
  -- caller keeps its meaning.
  p_remark     TEXT DEFAULT NULL
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
  is_late             BOOLEAN,
  courier_last_scan   TEXT
)
LANGUAGE sql
STABLE
AS $$
  WITH computed AS (
    SELECT
      o.*,
      CASE p_by
        WHEN 'courier_assigned' THEN o.courier_assigned_at
        WHEN 'agent_assigned'   THEN o.assigned_at
        WHEN 'shipped'          THEN o.shipped_at
        WHEN 'delivered'        THEN o.delivered_at
        ELSE o.ordered_at
      END AS basis_at,
      CASE p_late_from
        WHEN 'courier_assigned' THEN o.courier_assigned_at
        WHEN 'shipped'          THEN o.shipped_at
        ELSE o.ordered_at
      END AS late_at,
      COALESCE(o.delivered_at, o.returned_at, NOW()) AS ended_at
    FROM portal_orders o
    WHERE
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
        AND c.delivery_stage NOT IN ('delivered', 'returned', 'cancelled')
        AND (
          (NOW() AT TIME ZONE 'Asia/Kolkata')::date
          - (c.late_at AT TIME ZONE 'Asia/Kolkata')::date
        ) > p_late
      ) AS late_flag,
      -- The portal's cleaning of the same value, so one remark picked on
      -- either screen selects the same parcels.
      btrim(translate(COALESCE(p_remark, ''), '%_,()', '     ')) AS remark_clean
    FROM computed c
  )

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
    s.d_pending, s.d_transit, s.late_flag,
    s.courier_last_scan::TEXT
  FROM shaped s
  WHERE
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

    AND (p_books IS NULL
         OR (p_books = 'multi'  AND s.quantity >= 2)
         OR (p_books = 'single' AND s.quantity  = 1))

    AND (p_gift IS NULL
         OR (p_gift = 'yes' AND s.is_gift)
         OR (p_gift = 'no'  AND NOT s.is_gift))

    AND (p_signed IS NULL OR p_signed <> 'yes' OR s.is_signed)

    AND (NOT COALESCE(p_only_late, FALSE) OR s.late_flag)

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

    AND (
      s.remark_clean = ''
      OR s.courier_last_scan ILIKE '%' || s.remark_clean || '%'
    )
$$;

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
  p_bucket    TEXT DEFAULT 'month',
  p_remark    TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
  WITH scope AS (
    SELECT * FROM report_scope(
      p_by, p_from, p_to, p_courier, p_agent,
      NULL::TEXT[],
      p_handover,
      p_late, p_late_from,
      FALSE,
      NULL::INT, NULL::INT,
      p_books, p_gift, p_signed, p_q, p_state,
      p_remark
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
      COALESCE(SUM(amount_paise - COALESCE(refunded_paise, 0)), 0) AS revenue_paise,
      ROUND(AVG(days_pending) FILTER (WHERE delivered_at IS NOT NULL), 1) AS avg_days,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY days_pending)
        FILTER (WHERE delivered_at IS NOT NULL) AS median_days
    FROM scope
  ),

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

REVOKE ALL ON FUNCTION report_scope(TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT[], TEXT, INT, TEXT, BOOLEAN, INT, INT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION report_summary(TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, INT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION report_scope(TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT[], TEXT, INT, TEXT, BOOLEAN, INT, INT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION report_summary(TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, INT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';

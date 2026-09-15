-- The reports screen learns about calling lists (0083) and the courier's scan.
--
-- APPLY AFTER 0083 — the function bodies below read call_tasks, and a SQL
-- function is checked against the tables it names when it is created.
--
-- WHAT CHANGES
--
--   * p_call — a filter on whether a parcel's customer has been put on a
--     calling list, so a list can be assigned from "not yet assigned" and the
--     same customers are never handed out twice:
--       'none'        never on any calling list
--       'open'        on a list that isn't done
--       'not_called'  on an open list, nobody has rung yet
--       'called'      rung at least once, on any list
--       'done'        was on a list, and every one of them is closed
--   * Returned columns for the table and the export: the courier's last scan
--     time, and the call summary — who it is with, the latest call status,
--     how many calls were made and on how many lists.
--
-- The call summary is two LATERAL reads per parcel, served by the order_id
-- index added here. Everything else is 0082 verbatim.

CREATE INDEX IF NOT EXISTS call_tasks_order_idx ON call_tasks (order_id);

-- Both earlier shapes: 0082's, and 0058's in case 0082 was never applied —
-- leaving either behind would make every call ambiguous.
DROP FUNCTION IF EXISTS report_summary(TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, INT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS report_scope(TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT[], TEXT, INT, TEXT, BOOLEAN, INT, INT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);
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
  p_remark     TEXT DEFAULT NULL,
  p_call       TEXT DEFAULT NULL
)
RETURNS TABLE (
  order_number          TEXT,
  buyer_name            TEXT,
  buyer_phone           TEXT,
  address_line1         TEXT,
  address_line2         TEXT,
  city                  TEXT,
  district              TEXT,
  state                 TEXT,
  pincode               TEXT,
  amount_paise          INTEGER,
  refunded_paise        INTEGER,
  quantity              INT,
  is_gift               BOOLEAN,
  is_signed             BOOLEAN,
  courier_id            UUID,
  assigned_agent_id     UUID,
  delivery_stage        TEXT,
  handover_state        TEXT,
  status                TEXT,
  ordered_at            TIMESTAMPTZ,
  courier_assigned_at   TIMESTAMPTZ,
  assigned_at           TIMESTAMPTZ,
  courier_entered_at    TIMESTAMPTZ,
  courier_sent_at       TIMESTAMPTZ,
  shipped_at            TIMESTAMPTZ,
  delivered_at          TIMESTAMPTZ,
  returned_at           TIMESTAMPTZ,
  tracking_number       TEXT,
  courier_reference     TEXT,
  postal_barcode        TEXT,
  days_pending          INT,
  days_in_transit       INT,
  is_late               BOOLEAN,
  courier_last_scan     TEXT,
  courier_last_scan_at  TIMESTAMPTZ,
  call_assigned_to_id   UUID,
  call_status           TEXT,
  call_attempts         INT,
  call_lists            INT,
  call_open             BOOLEAN,
  call_last_at          TIMESTAMPTZ
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
      btrim(translate(COALESCE(p_remark, ''), '%_,()', '     ')) AS remark_clean
    FROM computed c
  ),

  called AS (
    SELECT
      s.*,
      COALESCE(cagg.lists, 0)       AS c_lists,
      COALESCE(cagg.attempts, 0)    AS c_attempts,
      COALESCE(cagg.has_open, FALSE) AS c_open,
      cagg.last_at                  AS c_last_at,
      clast.assigned_to_id          AS c_assigned_to_id,
      clast.call_status             AS c_status
    FROM shaped s
    -- An aggregate with no GROUP BY is always exactly one row, zero lists
    -- included, so this never drops a parcel.
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*)::int                     AS lists,
        COALESCE(SUM(ct.attempts), 0)::int AS attempts,
        BOOL_OR(NOT ct.done)              AS has_open,
        MAX(ct.last_called_at)            AS last_at
      FROM call_tasks ct
      WHERE ct.order_id = s.id
    ) cagg ON TRUE
    -- The call that describes it now: the open one if there is one, otherwise
    -- the most recently assigned.
    LEFT JOIN LATERAL (
      SELECT ct.assigned_to_id, ct.call_status
      FROM call_tasks ct
      WHERE ct.order_id = s.id
      ORDER BY ct.done ASC, ct.assigned_at DESC
      LIMIT 1
    ) clast ON TRUE
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
    s.courier_last_scan::TEXT, s.courier_last_scan_at::TIMESTAMPTZ,
    s.c_assigned_to_id::UUID, s.c_status::TEXT,
    s.c_attempts::INT, s.c_lists::INT, s.c_open::BOOLEAN, s.c_last_at::TIMESTAMPTZ
  FROM called s
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

    AND (
      p_call IS NULL
      OR (p_call = 'none'       AND s.c_lists = 0)
      OR (p_call = 'open'       AND s.c_open)
      OR (p_call = 'not_called' AND s.c_open AND s.c_status = 'not_called')
      OR (p_call = 'called'     AND s.c_attempts > 0)
      OR (p_call = 'done'       AND s.c_lists > 0 AND NOT s.c_open)
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
  p_remark    TEXT DEFAULT NULL,
  p_call      TEXT DEFAULT NULL
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
      p_remark, p_call
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

REVOKE ALL ON FUNCTION report_scope(TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT[], TEXT, INT, TEXT, BOOLEAN, INT, INT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION report_summary(TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, INT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION report_scope(TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT[], TEXT, INT, TEXT, BOOLEAN, INT, INT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION report_summary(TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, INT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';

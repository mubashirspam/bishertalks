-- Moving stock from one shelf straight to another, not just off the general pile.
--
-- APPLY THIS BY HAND. Migrations here are not run automatically.
-- APPLY AFTER 0073 — this rebuilds book_stock_by_location again.
--
-- WHY THIS EXISTS
--
-- Every `in_transfer` so far has meant one specific move: out of the general
-- pool, onto a named shelf. That covers "books arrived and we're putting
-- some on KKR's shelf," but not "Ajmal is holding stock and some of it is
-- going to KKR instead" — a transfer that never touches the general pool at
-- all. Recording that as today's `in_transfer` would still (wrongly) debit
-- the general pool, which has nothing to do with an Ajmal-to-KKR move.
--
-- `from_location` names the source explicitly. NULL keeps meaning what it
-- always has — the general pool — so every transfer recorded before this
-- migration is still read exactly the same way with no backfill needed.

ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS from_location TEXT;

DO $$
BEGIN
  ALTER TABLE stock_movements
    ADD CONSTRAINT stock_movements_from_location_check
    CHECK (from_location IS NULL OR from_location IN ('kkr', 'ajmal', 'mubashir'));
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'stock_movements_from_location_check already exists';
END $$;

-- Only means anything on a transfer, and never as its own destination.
DO $$
BEGIN
  ALTER TABLE stock_movements
    ADD CONSTRAINT stock_movements_from_location_shape
    CHECK (
      (kind = 'in_transfer' OR from_location IS NULL)
      AND (from_location IS DISTINCT FROM location)
    );
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'stock_movements_from_location_shape already exists';
END $$;

COMMENT ON COLUMN stock_movements.from_location IS
  'Where a transfer left from — kkr/ajmal/mubashir, or NULL for the general '
  'pool (0074). Only meaningful when kind = in_transfer; every transfer '
  'recorded before this migration has NULL here and means exactly what it '
  'always did, out of the general pool.';

-- ── The view, once more ─────────────────────────────────────────────────────
--
-- Same reason as every migration since 0063: the new column does not reach
-- the view until it is rebuilt. The only real change from 0069/0073's
-- version is `transferred_out`: instead of one number assumed to always be
-- the general pool's, it is now grouped by from_location and joined per
-- shelf — so a shelf loses what actually left it, whether that is the
-- general pool or another named shelf.

DROP VIEW IF EXISTS book_stock_by_location;

CREATE VIEW book_stock_by_location AS
WITH order_location AS (
  SELECT
    o.quantity,
    o.status,
    CASE
      WHEN c.slug IN ('delhivery-sheet', 'kkr-india-post') THEN 'kkr'
      WHEN c.slug = 'mubashir-logistic'                    THEN 'mubashir'
      WHEN o.sales_channel = 'manual'                      THEN s.stock_location
      ELSE NULL
    END AS location
  FROM orders o
  LEFT JOIN couriers c ON c.id = o.courier_id
  LEFT JOIN staff    s ON s.id = o.manual_entered_by
  WHERE o.payment_status = 'paid'
),
sold AS (
  SELECT
    location,
    COALESCE(SUM(GREATEST(COALESCE(quantity, 1), 1)) FILTER (
      WHERE status IN ('shipped', 'out_for_delivery', 'delivered')
    ), 0)::BIGINT AS shipped_out,
    COALESCE(SUM(GREATEST(COALESCE(quantity, 1), 1)) FILTER (
      WHERE status IN ('confirmed', 'processing')
    ), 0)::BIGINT AS committed,
    COALESCE(SUM(GREATEST(COALESCE(quantity, 1), 1)) FILTER (
      WHERE status = 'returned'
    ), 0)::BIGINT AS came_back,
    COALESCE(SUM(GREATEST(COALESCE(quantity, 1), 1)) FILTER (
      WHERE status = 'cancelled'
    ), 0)::BIGINT AS cancelled
  FROM order_location
  GROUP BY location
),
moved AS (
  SELECT
    location,
    COALESCE(SUM(copies) FILTER (
      WHERE kind LIKE 'in_%' AND kind <> 'in_transfer'
    ), 0)::BIGINT AS adjust_in,
    COALESCE(SUM(copies) FILTER (WHERE kind LIKE 'out_%'), 0)::BIGINT AS adjust_out,
    COALESCE(SUM(copies) FILTER (WHERE kind = 'in_returned'), 0)::BIGINT AS returned_to_stock,
    COALESCE(SUM(copies) FILTER (WHERE kind = 'in_transfer'), 0)::BIGINT AS transferred_in
  FROM stock_movements
  GROUP BY location
),
-- Grouped by where each transfer LEFT FROM, not always assumed to be the
-- general pool — an Ajmal-to-KKR transfer debits Ajmal here, not general.
transferred_out AS (
  SELECT
    from_location,
    COALESCE(SUM(copies), 0)::BIGINT AS total
  FROM stock_movements
  WHERE kind = 'in_transfer'
  GROUP BY from_location
),
printed AS (
  SELECT COALESCE(SUM(copies), 0)::BIGINT AS total FROM print_runs
)
SELECT
  loc.location,
  CASE WHEN loc.location IS NULL THEN printed.total ELSE 0 END
    + COALESCE(moved.transferred_in, 0)                       AS printed_or_transferred_in,
  COALESCE(sold.shipped_out, 0)                                AS shipped_out,
  COALESCE(sold.committed, 0)                                  AS committed,
  COALESCE(sold.came_back, 0)                                  AS came_back,
  COALESCE(sold.cancelled, 0)                                  AS cancelled,
  COALESCE(moved.adjust_in, 0)                                 AS adjust_in,
  COALESCE(moved.adjust_out, 0)
    + COALESCE(transferred_out.total, 0)                       AS adjust_out,
  COALESCE(moved.returned_to_stock, 0)                         AS returned_to_stock,
  (
    CASE WHEN loc.location IS NULL THEN printed.total ELSE 0 END
    + COALESCE(moved.transferred_in, 0)
    - COALESCE(sold.shipped_out, 0)
    + COALESCE(moved.adjust_in, 0)
    - COALESCE(moved.adjust_out, 0)
    - COALESCE(transferred_out.total, 0)
  )                                                             AS on_hand,
  (
    CASE WHEN loc.location IS NULL THEN printed.total ELSE 0 END
    + COALESCE(moved.transferred_in, 0)
    - COALESCE(sold.shipped_out, 0)
    + COALESCE(moved.adjust_in, 0)
    - COALESCE(moved.adjust_out, 0)
    - COALESCE(transferred_out.total, 0)
    - COALESCE(sold.committed, 0)
  )                                                             AS free
FROM (VALUES (NULL::text), ('kkr'), ('ajmal'), ('mubashir')) AS loc(location)
LEFT JOIN sold             ON sold.location  IS NOT DISTINCT FROM loc.location
LEFT JOIN moved            ON moved.location IS NOT DISTINCT FROM loc.location
LEFT JOIN transferred_out  ON transferred_out.from_location IS NOT DISTINCT FROM loc.location
CROSS JOIN printed;

ALTER VIEW book_stock_by_location SET (security_invoker = on);

REVOKE ALL ON book_stock_by_location FROM PUBLIC;
REVOKE ALL ON book_stock_by_location FROM anon, authenticated;
GRANT SELECT ON book_stock_by_location TO service_role;

NOTIFY pgrst, 'reload schema';

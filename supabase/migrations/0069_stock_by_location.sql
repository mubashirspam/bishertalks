-- Stock, split by whose shelf it's actually on: KKR, Ajmal, or Mubashir.
--
-- APPLY THIS BY HAND. Migrations here are not run automatically.
--
-- WHY THIS EXISTS
--
-- book_stock (0056) answers "how many books does the shop have", which is one
-- pool. It stopped being the useful question the moment three different
-- people started holding physical copies: KKR Logistics ships from its own
-- counter, and Ajmal and Mubashir each hold and sell their own stock. "1,254
-- free to sell" says nothing about whether that is 1,200 sitting with KKR and
-- 54 with Ajmal, or the other way round — and only one of those tells anyone
-- whether Ajmal can promise a customer a book today.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- HOW A BOOK GETS A SHELF
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Printed stock is not split at the press — every run still lands in the one
-- pool book_stock already counts (unchanged by this migration). A book joins
-- a named shelf only when somebody records that it physically moved there —
-- a `stock_movements` row of kind `in_transfer`, tagged with the shelf it
-- went to. That is the ONE new kind of movement; everything else about
-- recording a correction is unchanged, except every kind may now optionally
-- carry the same shelf tag — "damaged, from Ajmal's shelf" is exactly as
-- valid as "damaged" with no shelf at all.
--
-- Once a book is on a shelf, what takes it back off is the same thing that
-- takes it out of the general pool today:
--
--   * an order whose courier is KKR Logistics or KKR India Post draws down
--     KKR's shelf — the parcel physically left KKR's counter
--   * an order whose courier is Mubashir Logistic draws down Mubashir's —
--     same reasoning, his own booking
--   * a direct sale (sales_channel = 'manual') draws down whichever shelf
--     the staff member who entered it is linked to (staff.stock_location,
--     this migration) — Ajmal's sales come off Ajmal's shelf
--   * anything else — an online order on Delhivery/Speed Post, or a direct
--     sale entered by someone with no shelf set — draws down the general
--     pool, exactly as it does today
--
-- A courier match wins over the staff match: a direct sale that gets routed
-- through Mubashir Logistic draws down Mubashir's shelf even if Ajmal typed
-- it in, because the physical account it left through is the stronger signal
-- of which stack of books actually got smaller.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY THE ARITHMETIC STILL ADDS UP
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Every `in_transfer` row is simultaneously an inflow to the shelf it names
-- and an outflow from the general pool — there is no paired row, the one
-- movement means both, which is why book_stock_by_location's general-pool
-- row subtracts every `in_transfer` regardless of which shelf it names. The
-- four shelves (general + KKR + Ajmal + Mubashir) always sum back to exactly
-- what book_stock already says, because nothing here creates or destroys a
-- book — it only says more precisely where each one is.

-- ── Which shelf a correction happened on ────────────────────────────────────
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS location TEXT;

DO $$
BEGIN
  ALTER TABLE stock_movements
    ADD CONSTRAINT stock_movements_location_check
    CHECK (location IS NULL OR location IN ('kkr', 'ajmal', 'mubashir'));
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'stock_movements_location_check already exists';
END $$;

-- A transfer with nowhere to go is not a transfer — see the CHECK below.
DO $$
BEGIN
  ALTER TABLE stock_movements
    ADD CONSTRAINT stock_movements_transfer_needs_location
    CHECK (kind <> 'in_transfer' OR location IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'stock_movements_transfer_needs_location already exists';
END $$;

COMMENT ON COLUMN stock_movements.location IS
  'Whose shelf this correction happened on — kkr/ajmal/mubashir, or NULL for '
  'the general pool. Required when kind = in_transfer, which is the only kind '
  'that means "moved onto this shelf" rather than "happened on it". See '
  '0069 and book_stock_by_location.';

-- `kind` widens to include `in_transfer` — drop and re-add rather than a
-- second constraint, so there is exactly one place naming what `kind` may be.
ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_kind_check;

ALTER TABLE stock_movements
  ADD CONSTRAINT stock_movements_kind_check
  CHECK (kind IN (
    'out_damaged', 'out_author', 'out_review', 'out_lost',
    'in_returned', 'in_correction', 'out_correction', 'in_transfer'
  ));

-- ── Which shelf a staff member's own direct sales come off ─────────────────
ALTER TABLE staff ADD COLUMN IF NOT EXISTS stock_location TEXT;

DO $$
BEGIN
  ALTER TABLE staff
    ADD CONSTRAINT staff_stock_location_check
    CHECK (stock_location IS NULL OR stock_location IN ('kkr', 'ajmal', 'mubashir'));
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'staff_stock_location_check already exists';
END $$;

COMMENT ON COLUMN staff.stock_location IS
  'Which shelf this person''s own direct sales draw down (0069). NULL for '
  'staff who do not hold physical stock — most of the table. Not scoped to '
  'a role the way courier_id is: Ajmal and Mubashir enter sales as whatever '
  'role they hold, not as a partner login.';

-- ── The answer, one row per shelf ───────────────────────────────────────────
CREATE OR REPLACE VIEW book_stock_by_location AS
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
  -- Same scope as book_stock: an unpaid order reserves nothing.
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
-- Every transfer leaves the general pool, whichever shelf it names — this is
-- the "out" half of the one row that is also an "in" for a named shelf.
transferred_out AS (
  SELECT COALESCE(SUM(copies), 0)::BIGINT AS total
  FROM stock_movements
  WHERE kind = 'in_transfer'
),
printed AS (
  SELECT COALESCE(SUM(copies), 0)::BIGINT AS total FROM print_runs
)
SELECT
  loc.location,
  -- The general pool's own inflow is the print runs; a named shelf's own
  -- inflow is what has been transferred onto it.
  CASE WHEN loc.location IS NULL THEN printed.total ELSE 0 END
    + COALESCE(moved.transferred_in, 0)                       AS printed_or_transferred_in,
  COALESCE(sold.shipped_out, 0)                                AS shipped_out,
  COALESCE(sold.committed, 0)                                  AS committed,
  COALESCE(sold.came_back, 0)                                  AS came_back,
  COALESCE(sold.cancelled, 0)                                  AS cancelled,
  COALESCE(moved.adjust_in, 0)                                 AS adjust_in,
  COALESCE(moved.adjust_out, 0)
    + CASE WHEN loc.location IS NULL THEN transferred_out.total ELSE 0 END
                                                                AS adjust_out,
  COALESCE(moved.returned_to_stock, 0)                         AS returned_to_stock,
  (
    CASE WHEN loc.location IS NULL THEN printed.total ELSE 0 END
    + COALESCE(moved.transferred_in, 0)
    - COALESCE(sold.shipped_out, 0)
    + COALESCE(moved.adjust_in, 0)
    - COALESCE(moved.adjust_out, 0)
    - CASE WHEN loc.location IS NULL THEN transferred_out.total ELSE 0 END
  )                                                             AS on_hand,
  (
    CASE WHEN loc.location IS NULL THEN printed.total ELSE 0 END
    + COALESCE(moved.transferred_in, 0)
    - COALESCE(sold.shipped_out, 0)
    + COALESCE(moved.adjust_in, 0)
    - COALESCE(moved.adjust_out, 0)
    - CASE WHEN loc.location IS NULL THEN transferred_out.total ELSE 0 END
    - COALESCE(sold.committed, 0)
  )                                                             AS free
FROM (VALUES (NULL::text), ('kkr'), ('ajmal'), ('mubashir')) AS loc(location)
LEFT JOIN sold             ON sold.location  IS NOT DISTINCT FROM loc.location
LEFT JOIN moved            ON moved.location IS NOT DISTINCT FROM loc.location
CROSS JOIN printed
CROSS JOIN transferred_out;

ALTER VIEW book_stock_by_location SET (security_invoker = on);

REVOKE ALL ON book_stock_by_location FROM PUBLIC;
REVOKE ALL ON book_stock_by_location FROM anon, authenticated;
GRANT SELECT ON book_stock_by_location TO service_role;

NOTIFY pgrst, 'reload schema';

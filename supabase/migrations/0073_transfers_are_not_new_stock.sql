-- A transfer moves stock between shelves. It has never once printed a book.
--
-- APPLY THIS BY HAND. Migrations here are not run automatically.
--
-- WHY THIS EXISTS
--
-- book_stock (0056) predates shelves entirely — it counts every `in_%`
-- movement as new stock arriving, which was true of every kind that existed
-- when it was written (in_returned, in_correction). Then `in_transfer`
-- arrived (0069) to move books from the general pool onto a named shelf,
-- and book_stock_by_location was taught that a transfer is balance-neutral —
-- an outflow from wherever it left, an inflow to wherever it landed — but
-- book_stock itself was never told. It kept summing every in_transfer as if
-- it were 6,000 more books printed, so setting KKR's shelf to its real
-- count of 47 by transferring 1,739 books onto it read on the business-wide
-- page as "1,739 MORE books now exist" — free to sell jumped from roughly
-- what was on the shelves to 1,704, none of which anyone could actually
-- ship. `in_correction` was tried first and made it worse in a different
-- way: a correction has no "from" side at all, so it inflated the same
-- total by the same 1,739 for a different reason.
--
-- THE FIX. `in_transfer` is excluded from `adjust_in` here, for exactly the
-- reason book_stock_by_location already excludes it from a shelf's own
-- adjust_in and instead reads it as `transferred_in` — a transfer is where
-- existing stock IS now, not stock that newly exists. Nothing else in this
-- view changes: a correction still means "we found more/fewer than the
-- books said," a return still credits stock back, and the only thing this
-- migration removes is transfers double-counting as both.

CREATE OR REPLACE VIEW book_stock AS
WITH runs AS (
  SELECT COALESCE(SUM(copies), 0)::BIGINT AS printed
  FROM print_runs
),
sold AS (
  SELECT
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
  FROM orders
  WHERE payment_status = 'paid'
),
moved AS (
  SELECT
    -- Not in_transfer — a transfer relocates stock this view already counts
    -- via `printed`; it is never a second arrival. See the migration header.
    COALESCE(SUM(copies) FILTER (
      WHERE kind LIKE 'in_%' AND kind <> 'in_transfer'
    ), 0)::BIGINT AS added,
    COALESCE(SUM(copies) FILTER (WHERE kind LIKE 'out_%'), 0)::BIGINT AS removed,
    COALESCE(SUM(copies) FILTER (WHERE kind = 'in_returned'), 0)::BIGINT AS resold
  FROM stock_movements
)
SELECT
  runs.printed,
  sold.shipped_out,
  sold.committed,
  sold.came_back,
  sold.cancelled,
  moved.added                                                    AS adjust_in,
  moved.removed                                                  AS adjust_out,
  moved.resold                                                   AS returned_to_stock,
  (runs.printed - sold.shipped_out + moved.added - moved.removed) AS on_hand,
  (runs.printed - sold.shipped_out + moved.added - moved.removed - sold.committed) AS free
FROM runs, sold, moved;

ALTER VIEW book_stock SET (security_invoker = on);

REVOKE ALL ON book_stock FROM PUBLIC;
REVOKE ALL ON book_stock FROM anon, authenticated;
GRANT SELECT ON book_stock TO service_role;

NOTIFY pgrst, 'reload schema';

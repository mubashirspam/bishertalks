-- How many books there are, and where they went.
--
-- APPLY THIS BY HAND. Migrations here are not run automatically. The read
-- layer treats a missing table as "inventory not set up" and the admin page
-- says so, so a deploy landing before this is applied degrades to a page that
-- explains itself rather than a crash.
--
-- WHY NOW: the shop had no idea how many books it had. The only number
-- anywhere was `business_costs.printing_paise`, which is a per-book cost for
-- the profit report and says nothing about quantity. With ~193 books a day
-- going out and 6,000 printed, "how many are left" stopped being a question
-- somebody could hold in their head.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- THE ONE DESIGN DECISION
-- ─────────────────────────────────────────────────────────────────────────────
--
-- **Sales are derived from `orders`. Only non-sale movements are logged here.**
--
-- The tempting design is a movement ledger that every sale also writes to.
-- It is wrong for the same reason `deliveryStage()` and `orderStage()` are
-- derived rather than stored: a second copy of a fact drifts the first time
-- somebody edits a row by hand, and then two screens disagree about how many
-- books exist with no way to tell which is lying.
--
-- `orders` already IS the record of what sold. So `stock_movements` below
-- carries only what orders cannot tell us — a damaged copy, one given to the
-- author, a miscount corrected, a returned parcel judged fit to sell again.
-- Every one of those is somebody making a decision, which is exactly the kind
-- of fact that has to be written down rather than computed.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- Print runs
-- ─────────────────────────────────────────────────────────────────────────────
--
-- A table, not a constant, because there will be a fifth edition and it should
-- not need a deploy. `lib/preorder.ts` holds EDITION_NUMBER for the copy on
-- the site; this holds the quantities, which is a different question.
CREATE TABLE IF NOT EXISTS print_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Which edition this run printed. Not unique: a single edition can be
  -- reprinted, and each delivery from the printer is its own run.
  edition       INT  NOT NULL CHECK (edition > 0),
  copies        INT  NOT NULL CHECK (copies > 0),

  -- When the books actually arrived, which is when they become stock. A run
  -- ordered but not delivered has no business being counted, so this is NOT
  -- NULL and a future run simply is not a row yet.
  received_on   DATE NOT NULL,

  -- What one copy cost to print, for this run. Per run rather than global
  -- because paper prices move, and the single figure in
  -- `business_costs.printing_paise` cannot describe two runs at once.
  -- Nullable: the quantity is the part inventory needs, and a run whose
  -- invoice has not arrived should still be countable.
  unit_cost_paise INT CHECK (unit_cost_paise IS NULL OR unit_cost_paise >= 0),

  printer       TEXT,
  note          TEXT,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by    UUID
);

CREATE INDEX IF NOT EXISTS idx_print_runs_received ON print_runs (received_on DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- Everything that happened to a book other than being sold
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `copies` is always POSITIVE and `kind` decides the sign. A signed integer
-- invites `-5` for "found five more", and then the log reads as arithmetic
-- rather than as events — you can no longer ask "how many were damaged" without
-- knowing which signs meant what.
CREATE TABLE IF NOT EXISTS stock_movements (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- out_damaged      : pulped, water-damaged, torn in transit — gone
  -- out_author       : copies to the author, staff, or the office shelf
  -- out_review       : press, influencers, giveaways
  -- out_lost         : cannot be found; deliberately distinct from damaged,
  --                    because a stocktake that keeps producing these is a
  --                    different problem from a printer producing bad copies
  -- in_returned      : an RTO parcel opened, inspected and judged sellable.
  --                    NEVER automatic — see the view below
  -- in_correction    : a stocktake found more than the books said
  -- out_correction   : a stocktake found fewer
  kind        TEXT NOT NULL CHECK (kind IN (
                'out_damaged', 'out_author', 'out_review', 'out_lost',
                'in_returned', 'in_correction', 'out_correction'
              )),
  copies      INT  NOT NULL CHECK (copies > 0),

  -- Why. Required, and that is the point: every row here is a human decision
  -- about physical stock, and a movement log full of unexplained adjustments
  -- is a log nobody trusts six weeks later.
  reason      TEXT NOT NULL CHECK (length(btrim(reason)) > 0),

  -- The parcel this came back from, for an in_returned. Free text rather than
  -- a foreign key for the same reason postal_barcodes.order_number is: the
  -- primary key on orders is `id` and order_number carries no unique
  -- constraint a REFERENCES could rely on.
  order_number TEXT,

  actor_email TEXT,
  actor_id    UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_created ON stock_movements (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_kind    ON stock_movements (kind);

-- ─────────────────────────────────────────────────────────────────────────────
-- The answer
-- ─────────────────────────────────────────────────────────────────────────────
--
-- A view so that "how many books are there" has ONE definition. Three numbers
-- come out of it and the difference between two of them is the whole reason
-- this exists:
--
--   on_hand    books physically on the shelf
--   committed  of those, already paid for by somebody waiting
--   free       what is genuinely available to sell
--
-- On the day this was written those were 3,565 / 2,311 / 1,254. "3,565 left"
-- and "1,254 left" describe very different businesses, and only one of them is
-- safe to keep selling against.
--
-- WHAT COUNTS AS GONE: shipped, out for delivery, delivered. A parcel that has
-- left the building is not stock, whatever happens to it next.
--
-- WHAT DOES NOT COME BACK BY ITSELF: a `returned` order. The book is somewhere
-- in the postal system or on a shelf, and it may be soaked. Only an explicit
-- `in_returned` movement puts it back — somebody has to open the parcel and
-- decide. Counting RTOs automatically would inflate stock with books that
-- cannot be sold, which is the one error that turns this screen into a liar.
--
-- CANCELLED orders count as nothing at all: they were never dispatched, so the
-- book never left. It needs no movement and no adjustment — it simply stays.
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
  -- Paid only. An unpaid order is an intention; it reserves nothing and has
  -- never been allowed to move a parcel.
  WHERE payment_status = 'paid'
),
moved AS (
  SELECT
    COALESCE(SUM(copies) FILTER (WHERE kind LIKE 'in_%'), 0)::BIGINT  AS added,
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
  -- Can go negative, and it must be allowed to. A negative free count means
  -- more books are sold than exist — which is a real and urgent state, and
  -- clamping it to zero would hide exactly the thing this screen is for.
  (runs.printed - sold.shipped_out + moved.added - moved.removed - sold.committed) AS free
FROM runs, sold, moved;

-- Postgres 15+, which is what Supabase runs. Written as a plain statement
-- rather than the DO/EXECUTE guard the earlier migrations use: that guard
-- carries semicolons inside its strings, and an editor that splits a script on
-- semicolons without understanding quoting tears the file apart there.
ALTER VIEW book_stock SET (security_invoker = on);

-- Never read by a browser. Everything goes through the service role, exactly
-- as postal_barcode_ranges and couriers do.
REVOKE ALL ON book_stock FROM PUBLIC;
REVOKE ALL ON book_stock FROM anon, authenticated;
GRANT SELECT ON book_stock TO service_role;

ALTER TABLE print_runs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed: what has been printed so far
-- ─────────────────────────────────────────────────────────────────────────────
--
-- 6,000 is every copy ever printed, across all editions — confirmed by the
-- shop rather than derived. It goes in as ONE run against the current edition
-- because the per-edition split is not known: the printing invoices have it,
-- and the schema takes as many rows as those turn out to describe.
--
-- `received_on` is the first order this database ever took, which is the
-- earliest date any of these books demonstrably existed. It is a floor, not a
-- fact, and the note says so.
--
-- Guarded, so re-running this migration cannot double the stock.
INSERT INTO print_runs (edition, copies, received_on, printer, note)
SELECT 4, 6000, '2026-06-28', NULL,
       'Seeded by migration 0056: every copy printed to date, across all editions, as one run. Split into one row per edition once the printing invoices are to hand. received_on is the first order date in this database, which is a floor rather than a fact.'
WHERE NOT EXISTS (SELECT 1 FROM print_runs);

NOTIFY pgrst, 'reload schema';

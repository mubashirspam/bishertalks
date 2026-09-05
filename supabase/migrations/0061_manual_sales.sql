-- The books sold off the platform, and the money that is not Razorpay's.
--
-- APPLY THIS BY HAND. Migrations here are not run automatically.
--
-- WHY THIS EXISTS
--
-- Some customers pay by scanning a QR code and then send their address over
-- WhatsApp. There is no checkout, no Razorpay order, no payment id — but there
-- IS a real book that has to be packed, routed, labelled, handed to a courier
-- and tracked, exactly like every other parcel.
--
-- Until now those sales had nowhere to live. Typing one in as a normal order
-- would put money into the revenue tiles that never went through Razorpay, so
-- the dashboard would stop agreeing with the settlement statement and nobody
-- would be able to see why. Keeping them out of the system entirely means the
-- parcel is invisible to delivery, which is the half that actually needs the
-- software.
--
-- So: same row, same delivery pipeline, and one column that says the money is
-- counted somewhere else.
--
-- WHY A COLUMN RATHER THAN A `source` VALUE
--
-- `source` already exists and already means something else — it is ATTRIBUTION
-- (facebook, instagram, direct, referral, google, other), the answer to "who
-- introduced this customer". A manual sale has an attribution too: somebody
-- who saw an Instagram post and paid by UPI is still `instagram`. Overloading
-- `source` would destroy that, and would silently corrupt every channel report
-- in lib/db/insights.ts the moment the first manual order was entered.
--
-- These are two independent facts about one order — where the customer came
-- from, and how the money reached us — so they get two columns.
--
-- WHY NOT INFER IT FROM `razorpay_payment_id IS NULL`
--
-- It would work today: all 5,238 paid orders carry a payment id, so the
-- absence of one is currently a perfect marker. It is still the wrong test.
-- An inferred flag cannot be filtered on in the database without a full scan,
-- cannot carry the payment method or reference, and would quietly reclassify
-- any future paid order whose payment id failed to write. A fact this load
-- bearing gets stated, not deduced.

-- ── The channel ─────────────────────────────────────────────────────────────
--
-- Defaults to 'online' so every existing row, and every row the checkout
-- writes without knowing about this column, is correct without a backfill.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS sales_channel TEXT NOT NULL DEFAULT 'online';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_sales_channel_check'
  ) THEN
    ALTER TABLE orders ADD CONSTRAINT orders_sales_channel_check
      CHECK (sales_channel IN ('online', 'manual'));
  END IF;
END $$;

-- Partial, because 'online' is and will remain almost every row — an index
-- over the whole table would be read past rather than used. Every query that
-- excludes manual sales is answered by the table; every query that WANTS them
-- is answered by this.
CREATE INDEX IF NOT EXISTS orders_manual_idx
  ON orders (ordered_at DESC)
  WHERE sales_channel <> 'online';

-- ── How the money actually arrived ──────────────────────────────────────────
--
-- Nullable, and meaningless on an online order — Razorpay's own columns say it
-- there. On a manual sale this is the only record of the payment that exists,
-- so it is worth a column rather than a line in `notes` that nobody can search.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS manual_payment_method TEXT,
  -- The UPI reference, the bank transaction id, or whatever was written on the
  -- receipt. Free text on purpose: it is somebody else's identifier and this
  -- system has no business validating its shape.
  ADD COLUMN IF NOT EXISTS manual_payment_ref TEXT,
  -- Who typed it in. A manual order has no customer-side audit trail at all —
  -- no checkout session, no payment webhook — so the one accountability fact
  -- available is which member of staff entered it.
  ADD COLUMN IF NOT EXISTS manual_entered_by UUID REFERENCES staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS manual_entered_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_manual_payment_method_check'
  ) THEN
    ALTER TABLE orders ADD CONSTRAINT orders_manual_payment_method_check
      CHECK (
        manual_payment_method IS NULL
        OR manual_payment_method IN ('upi', 'cash', 'bank', 'other')
      );
  END IF;
END $$;

-- A manual sale must say it is one, and an online order must not carry the
-- manual payment fields. Cheap to enforce, and it makes "which of these is the
-- truth" un-askable later.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_manual_fields_check'
  ) THEN
    ALTER TABLE orders ADD CONSTRAINT orders_manual_fields_check
      CHECK (
        sales_channel = 'manual'
        OR (manual_payment_method IS NULL AND manual_payment_ref IS NULL)
      );
  END IF;
END $$;

COMMENT ON COLUMN orders.sales_channel IS
  'How the money reached us: online (Razorpay checkout) or manual (QR/UPI/cash, '
  'address taken over WhatsApp). NOT attribution — that is orders.source. '
  'Manual sales are excluded from every revenue, book and stock figure; see '
  'lib/db/sales-channel.ts, which is the only place that decision is written down.';

-- ── Stock ───────────────────────────────────────────────────────────────────
--
-- Direct sales are held out of the book counts too. That is a deliberate
-- instruction from the shop, and it has a cost worth writing down: a book sold
-- at the counter physically leaves the shelf, so `on_hand` will now read higher
-- than the number of books actually in the room, and `free` will not fall when
-- one goes out. The low-stock warning is correspondingly optimistic.
--
-- It is one predicate. If the count ever needs to include them again — and the
-- day this shop sells a hundred books directly it probably will — delete the
-- `AND sales_channel = 'online'` line below and nothing else changes.

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
    -- Direct sales are reported on their own and counted nowhere else (0061).
    AND sales_channel = 'online'
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

ALTER VIEW book_stock SET (security_invoker = on);
GRANT SELECT ON book_stock TO service_role;

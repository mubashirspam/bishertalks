-- Article numbers for India Post, and the stock they come out of.
--
-- APPLY THIS BY HAND. Migrations here are not run automatically — see the
-- error text in lib/db/delivery-portal.ts, which exists because 0024 was left
-- unapplied and an agent got "column does not exist" on a screen they were
-- standing in front of.
--
-- WHY: this is the one thing about India Post that has no counterpart anywhere
-- in this system. Delhivery assigns a waybill in the same response that
-- accepts the shipment — the number arrives with the answer. India Post allots
-- us a *range* of article numbers up front and we mint from it ourselves,
-- before booking, and each one is spent whether or not the booking that used
-- it succeeded.
--
-- That makes an article number a consumable with a finite stock, and stock has
-- to be counted somewhere that survives a restart. Hence two tables rather
-- than a counter in the code.
--
-- The rule that shapes both of them: A NUMBER IS NEVER RETURNED TO STOCK.
-- Not on a refused booking, not on a timeout, not on an admin undoing
-- something. A booking whose outcome we never learned may well have registered
-- that number at their end, and two parcels travelling under one article
-- number is not a thing we can fix from here — India Post's own tracking would
-- have to choose between them, and it would choose wrongly for one customer.
-- Wasting a number costs nothing; reusing one costs a parcel.

-- ─────────────────────────────────────────────────────────────────────────────
-- The ranges they allot
-- ─────────────────────────────────────────────────────────────────────────────
--
-- One row per allotment. `next_serial` is the cursor: everything below it has
-- been handed out, everything from it to `serial_to` is free. Kept as a cursor
-- rather than derived by counting postal_barcodes, because the allocator has
-- to claim numbers in one statement under concurrency and MAX()+1 over a
-- growing table is exactly the pattern that hands the same number to two
-- requests.
CREATE TABLE IF NOT EXISTS postal_barcode_ranges (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  courier_id    UUID NOT NULL REFERENCES couriers(id) ON DELETE RESTRICT,

  -- "ET" and "IN" in ET21433001XIN. Two letters each, checked here as well as
  -- in lib/india-post/article-number.ts: a range typed into the admin with a
  -- wrong prefix produces numbers that are structurally perfect and belong to
  -- somebody else's allotment.
  prefix        TEXT NOT NULL CHECK (prefix ~ '^[A-Z]{2}$'),
  suffix        TEXT NOT NULL DEFAULT 'IN' CHECK (suffix ~ '^[A-Z]{2}$'),

  -- The eight-digit serial, as a number because the allocator counts through
  -- it. Zero-padded back to eight digits when the barcode is built.
  serial_from   BIGINT NOT NULL CHECK (serial_from BETWEEN 0 AND 99999999),
  serial_to     BIGINT NOT NULL CHECK (serial_to   BETWEEN 0 AND 99999999),
  next_serial   BIGINT NOT NULL,

  -- Set when next_serial passes serial_to. A stamp rather than a boolean, so
  -- "when did we run out" is answerable — it is the question that decides how
  -- early to ask for the next allotment.
  exhausted_at  TIMESTAMPTZ,

  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT postal_range_ordered CHECK (serial_to >= serial_from),
  CONSTRAINT postal_range_cursor_in_bounds
    CHECK (next_serial >= serial_from AND next_serial <= serial_to + 1)
);

-- Two allotments of the same prefix must not overlap. Postgres can enforce
-- this properly with an exclusion constraint over the serial interval, which
-- is worth the btree_gist extension: an overlap is not a data-entry annoyance,
-- it is two orders eventually carrying the same article number.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE postal_barcode_ranges
  DROP CONSTRAINT IF EXISTS postal_ranges_do_not_overlap;

ALTER TABLE postal_barcode_ranges
  ADD CONSTRAINT postal_ranges_do_not_overlap
  EXCLUDE USING gist (
    prefix WITH =,
    suffix WITH =,
    int8range(serial_from, serial_to, '[]') WITH &&
  );

-- The allocator's lookup: the oldest range with anything left in it.
CREATE INDEX IF NOT EXISTS idx_postal_ranges_open
  ON postal_barcode_ranges (courier_id, created_at)
  WHERE exhausted_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- Every number ever handed out
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Written at allocation, not at booking. That is the whole point: if the
-- process dies between claiming a number and using it, the number is still
-- recorded as gone, which is the safe direction to be wrong in.
CREATE TABLE IF NOT EXISTS postal_barcodes (
  barcode       TEXT PRIMARY KEY CHECK (barcode ~ '^[A-Z]{2}[0-9]{9}[A-Z]{2}$'),
  range_id      UUID NOT NULL REFERENCES postal_barcode_ranges(id) ON DELETE RESTRICT,

  -- Deliberately NOT a foreign key to orders(order_number). The primary key on
  -- orders is `id`, and order_number has no unique constraint this migration
  -- can rely on — a REFERENCES against it fails to apply with "no unique
  -- constraint matching given keys". The unique index below is what actually
  -- enforces one number per order, which is the property that matters.
  --
  -- It also means a deleted order leaves the number behind as an orphan, which
  -- is the right outcome: the number is still spent, and the row is the only
  -- record of what became of it.
  order_number  TEXT,

  -- allocated : minted and assigned to an order, not yet at India Post
  -- booked    : India Post accepted it
  -- spent     : used and unusable — a refused booking, or an outcome we never
  --             learned. Terminal, and deliberately not distinguishable from a
  --             successful booking as far as reuse is concerned.
  state         TEXT NOT NULL DEFAULT 'allocated'
                CHECK (state IN ('allocated', 'booked', 'spent')),

  allocated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  booked_at     TIMESTAMPTZ,
  -- Why it was spent, when it was. Read by nobody automatically; it exists so
  -- a person asking "what happened to ET21433017IN" gets an answer.
  error         TEXT,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One live number per order, and the only thing enforcing it — see the note on
-- the column. Partial, so the rows belonging to no order (a booking that was
-- refused before it was attached, an order since deleted) do not collide with
-- each other on NULL.
CREATE UNIQUE INDEX IF NOT EXISTS idx_postal_barcodes_order
  ON postal_barcodes (order_number)
  WHERE order_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_postal_barcodes_state
  ON postal_barcodes (state, allocated_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- The order's side of it
-- ─────────────────────────────────────────────────────────────────────────────
--
-- NOT tracking_number, and this is the important part.
--
-- portal_orders reads a non-empty tracking_number as proof a parcel is with a
-- courier: `WHEN COALESCE(o.tracking_number,'') <> '' THEN 'with_courier'`.
-- An allocated-but-unbooked article number is not that — the parcel is still
-- on our shelf and India Post has never heard of it. Writing it to
-- tracking_number would move a row to "with courier" on the strength of a
-- number we minted ourselves.
--
-- So it lands here at allocation, and is copied into tracking_number only when
-- India Post accepts the booking. At that moment every existing screen, the
-- poller and the public tracking page start working on it with no change.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS postal_barcode TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_postal_barcode
  ON orders (postal_barcode) WHERE postal_barcode IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- Claiming numbers
-- ─────────────────────────────────────────────────────────────────────────────
--
-- One statement, because two requests routing overlapping batches must not be
-- able to take the same serial. Same shape and same reasoning as
-- mark_courier_entered (0024) and claimForSend (lib/db/courier-send.ts): a
-- conditional UPDATE that returns what it moved is the only lock needed.
--
-- Returns the first serial claimed and how many, rather than the numbers
-- themselves: building the barcode means computing a check digit, and that
-- logic lives in TypeScript where it is unit-tested against the specification.
-- Duplicating a weighted-modulus-11 in PL/pgSQL to save one loop would be two
-- implementations of the one thing that must never disagree.
--
-- `wanted` may be partially satisfied: a range with three left gives three.
-- The caller asks again for the rest, or reports the shortfall. It must never
-- silently give fewer and let the caller assume otherwise, which is why the
-- count comes back explicitly.
CREATE OR REPLACE FUNCTION claim_postal_serials(
  p_courier_id UUID,
  p_wanted     INT
)
RETURNS TABLE (
  range_id     UUID,
  prefix       TEXT,
  suffix       TEXT,
  first_serial BIGINT,
  claimed      INT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_range   postal_barcode_ranges%ROWTYPE;
  v_free    BIGINT;
  v_take    INT;
BEGIN
  IF p_wanted IS NULL OR p_wanted <= 0 THEN
    RETURN;
  END IF;

  -- The oldest range with room, locked so a concurrent claim waits rather than
  -- reading the same cursor. SKIP LOCKED is deliberately NOT used: we want the
  -- second caller to take the *next* numbers from this range, not to skip past
  -- it to a later one and leave a hole.
  SELECT * INTO v_range
    FROM postal_barcode_ranges
   WHERE courier_id = p_courier_id
     AND exhausted_at IS NULL
     AND next_serial <= serial_to
   ORDER BY created_at
   FOR UPDATE
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_free := v_range.serial_to - v_range.next_serial + 1;
  v_take := LEAST(p_wanted, v_free)::INT;

  UPDATE postal_barcode_ranges
     SET next_serial  = v_range.next_serial + v_take,
         exhausted_at = CASE
           WHEN v_range.next_serial + v_take > serial_to THEN NOW()
           ELSE NULL
         END
   WHERE id = v_range.id;

  range_id     := v_range.id;
  prefix       := v_range.prefix;
  suffix       := v_range.suffix;
  first_serial := v_range.next_serial;
  claimed      := v_take;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION claim_postal_serials(UUID, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_postal_serials(UUID, INT) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- How much is left
-- ─────────────────────────────────────────────────────────────────────────────
--
-- For the admin panel and the low-stock warning. A view rather than a query in
-- the app so that "unused" has one definition: what the cursors say is left,
-- not what counting rows suggests.
CREATE OR REPLACE VIEW postal_barcode_stock AS
SELECT
  r.courier_id,
  COUNT(*) FILTER (WHERE r.exhausted_at IS NULL)                    AS open_ranges,
  COALESCE(SUM(GREATEST(r.serial_to - r.next_serial + 1, 0)), 0)    AS unused,
  COALESCE(SUM(r.serial_to - r.serial_from + 1), 0)                 AS allotted,
  MIN(r.created_at)                                                  AS oldest_range_at
FROM postal_barcode_ranges r
GROUP BY r.courier_id;

DO $$
BEGIN
  EXECUTE 'ALTER VIEW postal_barcode_stock SET (security_invoker = on)';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'security_invoker not supported here; relying on grants';
END $$;

REVOKE ALL ON postal_barcode_stock FROM PUBLIC;
REVOKE ALL ON postal_barcode_stock FROM anon, authenticated;
GRANT SELECT ON postal_barcode_stock TO service_role;

-- Neither table is ever read by a browser. Everything goes through the service
-- role, exactly as couriers and courier_serviceability do.
ALTER TABLE postal_barcode_ranges ENABLE ROW LEVEL SECURITY;
ALTER TABLE postal_barcodes       ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

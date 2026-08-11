-- Delivery portal: the 'returned' status.
--
-- The portal (/admin/delivery-portal) is the agent's working screen — a
-- spreadsheet of the day's parcels with a tick per fulfilment stage. Four of
-- those stages already exist as order statuses; 'returned' does not. A parcel
-- that comes back is currently either left as 'delivered' (a lie, and it pays
-- out a referral commission) or marked 'cancelled' (which reads as "the
-- customer changed their mind before we shipped"). Neither is the truth.
--
-- 'returned' means: we shipped it, and it came back to us.

-- The status set was never constrained — the column was created outside these
-- migrations. Find and drop whatever CHECK is on it (matched by content, since
-- the name depends on how it was created), then state the allowed set
-- explicitly so the next person can read it here.
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'orders'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%delivered%'
  LOOP
    EXECUTE format('ALTER TABLE orders DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN (
    'confirmed', 'processing', 'shipped', 'out_for_delivery',
    'delivered', 'cancelled', 'returned'
  ));

-- When it came back. Same shape as shipped_at / delivered_at: stamped on first
-- entry only, so re-marking doesn't rewrite history.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS returned_at TIMESTAMPTZ;

-- set_delivery_status gains the returned_at stamp. Everything else is
-- unchanged — this is the same function the delivery list and the order detail
-- page already call, so the portal can't drift from them.
CREATE OR REPLACE FUNCTION set_delivery_status(
  p_order_numbers TEXT[],
  p_status        TEXT,
  p_courier       TEXT DEFAULT NULL
)
RETURNS SETOF TEXT
LANGUAGE sql
AS $$
  UPDATE orders SET
    status       = p_status,
    courier_name = COALESCE(NULLIF(p_courier, ''), courier_name),
    shipped_at   = CASE WHEN p_status IN ('shipped', 'out_for_delivery')
                        THEN COALESCE(shipped_at, NOW()) ELSE shipped_at END,
    delivered_at = CASE WHEN p_status = 'delivered'
                        THEN COALESCE(delivered_at, NOW()) ELSE delivered_at END,
    returned_at  = CASE WHEN p_status = 'returned'
                        THEN COALESCE(returned_at, NOW()) ELSE returned_at END,
    updated_at   = NOW()
  WHERE order_number = ANY(p_order_numbers)
  RETURNING order_number;
$$;

-- CREATE OR REPLACE resets grants on some Postgres versions. Re-apply: this is
-- service-role only, because a publicly callable function that writes order
-- status by order number would let anyone mark anyone's parcel delivered.
REVOKE ALL ON FUNCTION set_delivery_status(text[], text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION set_delivery_status(text[], text, text) TO service_role;

-- The portal's default view: one IST day of parcels, newest first.
CREATE INDEX IF NOT EXISTS idx_orders_portal
  ON orders (created_at DESC)
  WHERE payment_status = 'paid' AND address_line1 IS NOT NULL;

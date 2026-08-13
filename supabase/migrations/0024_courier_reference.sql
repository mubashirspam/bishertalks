-- The courier's reference number, and confirming a batch in one round trip.
--
-- The portal can now hand an agent a Delhivery bulk-upload sheet instead of
-- making them retype fifty addresses into the courier's site. That sheet needs
-- a "Reference No" per parcel — BISH + the last five digits of the customer's
-- mobile — and the courier rejects a file that reuses one it has already seen.
--
-- Two things follow from that, and both need the database:
--
--   1. The reference has to be remembered. Generating it fresh each time would
--      be fine until two customers share their last five digits, and the
--      second sheet would be rejected weeks after the first was uploaded. The
--      unique index is what makes "is this one taken?" answerable at all.
--
--   2. Downloading the sheet IS entering the addresses with the courier, so
--      those fifty parcels get their Confirmed tick the moment the file is
--      built. Fifty separate updates from the route is the shape that hangs
--      halfway through and leaves a sheet in the agent's hands whose parcels
--      the portal still shows as new. One statement, or none.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS courier_reference TEXT;

-- Partial, so the thousands of orders that never went out on a sheet don't all
-- collide on NULL. This index is also the read path: the route asks which of
-- the ~100 candidate references for a batch already exist.
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_courier_reference
  ON orders (courier_reference)
  WHERE courier_reference IS NOT NULL;

-- ── Confirm a batch ─────────────────────────────────────────────────────────
-- Two parallel arrays rather than JSON: the caller has an order number and a
-- reference for each row, and unnest() of the pair is the cheapest way to join
-- them onto the table in a single UPDATE.
--
-- Both writes COALESCE, so re-downloading a sheet is harmless: a parcel keeps
-- the moment it was first entered with the courier, and keeps the reference
-- that was already printed on the courier's copy. Returns what actually
-- changed — the route sends the same list to the audit log, and the paid check
-- here means a refunded order silently drops out rather than logging a lie.
CREATE OR REPLACE FUNCTION mark_courier_entered(
  p_order_numbers TEXT[],
  p_references TEXT[]
)
RETURNS SETOF TEXT
LANGUAGE sql
AS $$
  UPDATE orders o SET
    courier_entered_at = COALESCE(o.courier_entered_at, NOW()),
    courier_reference  = COALESCE(o.courier_reference, r.reference),
    updated_at         = NOW()
  FROM unnest(p_order_numbers, p_references) AS r(order_number, reference)
  WHERE o.order_number = r.order_number
    AND o.payment_status = 'paid'
  RETURNING o.order_number;
$$;

-- Writes order state by order number, like every other bulk RPC here (0005).
REVOKE ALL ON FUNCTION mark_courier_entered(text[], text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION mark_courier_entered(text[], text[]) TO service_role;

-- portal_orders is `SELECT o.*`, which Postgres expanded to the column list as
-- it stood when the view was created (0021). Without this it would never see
-- courier_reference, and the portal reads through the view.
DROP VIEW IF EXISTS portal_orders;

CREATE VIEW portal_orders AS
SELECT
  o.*,
  -- created_at is UTC; the agent's day is an IST calendar day. Without the
  -- conversion every order placed after 6:30pm IST sorts into tomorrow.
  (o.created_at AT TIME ZONE 'Asia/Kolkata')::date AS ist_day,
  -- "Nobody has entered this with the courier yet."
  (o.courier_entered_at IS NULL) AS needs_entry
FROM orders o;

DO $$
BEGIN
  EXECUTE 'ALTER VIEW portal_orders SET (security_invoker = on)';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'security_invoker not supported here; relying on grants';
END $$;

REVOKE ALL ON portal_orders FROM PUBLIC;
REVOKE ALL ON portal_orders FROM anon, authenticated;
GRANT SELECT ON portal_orders TO service_role;

NOTIFY pgrst, 'reload schema';

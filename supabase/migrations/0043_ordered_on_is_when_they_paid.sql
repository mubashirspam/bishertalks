-- "Ordered on" should mean the day they paid.
--
-- The order row is written the moment a customer types a valid mobile number
-- into the checkout — that is what /api/leads is for, so an abandoned checkout
-- leaves a name and an address to follow up rather than nothing. If they come
-- back four days later and pay, /api/orders/create finds that pending row and
-- updates it instead of inserting a second one, deliberately, so one customer
-- stays one row from first keystroke to delivery.
--
-- Which means created_at has never been the order date. It is the funnel-entry
-- date, and for a lead that came back it is nowhere near the payment. ORD-LVH745
-- reads "ordered 14 Aug, 6:59 am" and was paid on 18 Aug at 11:13 pm; the admin
-- list sorts it five days down, the date filters miss it entirely, and the
-- revenue charts count its money on the wrong day.
--
-- Three columns' worth of meaning, so three columns:
--
--   created_at  — when checkout began. Unchanged, and still the honest answer
--                 to "when did this person first show up?"
--   paid_at     — when the money landed and the order was confirmed. NULL until
--                 it is, which is also how an unpaid lead stays distinguishable.
--   ordered_at  — what every screen should sort, filter and display by.
--
-- NOTHING IS BACKFILLED. Existing rows keep exactly the date they show today:
-- ordered_at is generated, not written, so an old order with no paid_at simply
-- falls through to its created_at and nobody's history moves. Orders paid from
-- here on get the real date.

-- Nullable, no default. A default of NOW() would stamp every existing unpaid
-- lead as paid-this-instant, which is the opposite of leaving old rows alone.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

-- The one date the screens use. Generated rather than maintained in the
-- application: it can never drift from its two inputs, it cannot be forgotten
-- on a new write path, and PostgREST can order and filter on it directly, which
-- a COALESCE in the query cannot do cleanly.
--
-- STORED rather than VIRTUAL because it is indexed below, and because every
-- list read touches it while writes are comparatively rare.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS ordered_at TIMESTAMPTZ
  GENERATED ALWAYS AS (COALESCE(paid_at, created_at)) STORED;

-- The admin list sorts on this on every page load, and the date filters range
-- over it. created_at's own index stays — the funnel reports still use it.
CREATE INDEX IF NOT EXISTS orders_ordered_at_idx ON orders (ordered_at DESC);

-- Stamp paid_at at the moment of the transition, wherever it happens.
--
-- A trigger rather than two lines of TypeScript, because there are two writers
-- today — /api/orders/verify (the browser handler) and claimPaidTransition (the
-- webhook and the admin's manual sync) — and they race each other by design.
-- Both are guarded by .neq('payment_status','paid'), so exactly one wins the
-- claim and exactly one fires this. A third path added later, or somebody
-- flipping a row to paid by hand in the Supabase UI, gets the timestamp too;
-- that is the part application code cannot promise.
--
-- IS DISTINCT FROM, not <>, because payment_status could be NULL on some path
-- we have not thought of and NULL <> 'paid' is NULL, which would skip the stamp.
--
-- It never overwrites: an explicit paid_at on the UPDATE wins, and an order
-- that somehow goes paid -> refunded -> paid keeps the date it was first paid.
CREATE OR REPLACE FUNCTION stamp_paid_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.payment_status = 'paid'
     AND OLD.payment_status IS DISTINCT FROM 'paid'
     AND NEW.paid_at IS NULL
  THEN
    NEW.paid_at := NOW();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS orders_stamp_paid_at ON orders;
CREATE TRIGGER orders_stamp_paid_at
  BEFORE UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION stamp_paid_at();

-- An order can also be born paid, on any path that inserts an already-settled
-- row. Same rule, separate trigger because there is no OLD on an INSERT.
CREATE OR REPLACE FUNCTION stamp_paid_at_on_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.payment_status = 'paid' AND NEW.paid_at IS NULL THEN
    NEW.paid_at := NOW();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS orders_stamp_paid_at_insert ON orders;
CREATE TRIGGER orders_stamp_paid_at_insert
  BEFORE INSERT ON orders
  FOR EACH ROW
  EXECUTE FUNCTION stamp_paid_at_on_insert();

-- Rebuild portal_orders so it can see the two new columns.
--
-- THE RULE from 0028: adding a column to `orders` means rebuilding this view in
-- the same migration, because `SELECT o.*` was expanded into a fixed column
-- list the day the view was created. And its second half, learned the hard way
-- in 0040: copy the definition from the LATEST migration that creates the view,
-- which is 0039 — with the couriers join, `courier_tracks` and
-- `handover_state`. Copying an older body forward silently drops all three.
--
-- One deliberate change from 0039: ist_day now comes from ordered_at rather
-- than created_at. It is "which day's parcels are these?", and the portal only
-- ever shows paid orders — so for every row it displays, ordered_at IS the
-- payment date. Left on created_at, a parcel paid for last night would sort
-- into the packing list of the day its customer first opened the checkout.

DROP VIEW IF EXISTS portal_orders;

CREATE VIEW portal_orders AS
SELECT
  o.*,
  -- ordered_at is UTC; the agent's day is an IST calendar day. Without the
  -- conversion every order placed after 6:30pm IST sorts into tomorrow.
  (o.ordered_at AT TIME ZONE 'Asia/Kolkata')::date AS ist_day,
  -- "Nobody has entered this with the courier yet."
  (o.courier_entered_at IS NULL) AS needs_entry,

  -- Real, not TRUE. Drives every "is no waybill a problem here?" answer.
  ((c.config ->> 'tracking') IS NOT NULL) AS courier_tracks,

  CASE
    -- Sent by some other service, reported to us in a spreadsheet.
    WHEN o.transport_mode IS NOT NULL THEN 'other_transport'

    -- A waybill is proof somebody has it, whoever they are.
    WHEN COALESCE(o.tracking_number, '') <> '' THEN 'with_courier'

    WHEN o.courier_id IS NULL OR c.id IS NULL THEN 'unassigned'

    -- Ours still — assigned, but the courier has not been given the data.
    WHEN o.courier_entered_at IS NULL THEN 'to_hand_over'

    -- Handed over to a partner that tells us nothing. There is no confirmation
    -- to wait for, so this is the end of the line until somebody types a
    -- tracking number in or ticks a stage.
    WHEN (c.config ->> 'tracking') IS NULL THEN 'handed_over'

    -- Handed over to a partner we can ask, and we have not asked yet.
    WHEN o.courier_checked_at IS NULL THEN 'awaiting_manifest'

    -- We asked, and they have no record of it.
    ELSE 'not_manifested'
  END AS handover_state

FROM orders o
LEFT JOIN couriers c ON c.id = o.courier_id;

-- Run the view as the caller, so it can never be a way around RLS on orders.
DO $$
BEGIN
  EXECUTE 'ALTER VIEW portal_orders SET (security_invoker = on)';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'security_invoker not supported here; relying on grants';
END $$;

-- Dropping the view dropped its grants with it. Service-role only: the anon
-- key ships to every browser, and this view carries every customer's name,
-- mobile and home address.
REVOKE ALL ON portal_orders FROM PUBLIC;
REVOKE ALL ON portal_orders FROM anon, authenticated;
GRANT SELECT ON portal_orders TO service_role;

NOTIFY pgrst, 'reload schema';

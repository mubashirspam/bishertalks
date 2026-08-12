-- Delivery portal: the worklist order.
--
-- The portal opened newest-first on created_at. That is the right *day* order,
-- but inside a day it mixes the parcels with work left to do among the ones
-- already handled, so an agent scrolls looking for the un-ticked rows. The
-- order the work actually happens in is:
--
--   1. newest IST day first        — today's parcels are the day's job
--   2. inside a day, not-yet-entered first — that is the to-do list
--   3. inside those, newest first  — unchanged
--
-- Neither of the first two keys is a column PostgREST can .order() by: "IST
-- day" is an expression over created_at, and "not yet entered" is a predicate
-- over two columns. Hence a view — it gives both keys a name, and keeps the
-- definition of an IST day in one place next to istDayStartUTC(), which the
-- portal's date filter already uses.

CREATE OR REPLACE VIEW portal_orders AS
SELECT
  o.*,
  -- created_at is UTC; the agent's day is an IST calendar day. Without the
  -- conversion every order placed after 6:30pm IST sorts into tomorrow.
  (o.created_at AT TIME ZONE 'Asia/Kolkata')::date AS ist_day,
  -- "Nobody has started this one."
  --
  -- Deliberately matches the Confirmed tick in the grid rather than the "To
  -- enter" filter: the tick reads a parcel at Packed or beyond as entered even
  -- when courier_entered_at is null, because you cannot pack a parcel you never
  -- entered. Only rows still at 'confirmed' genuinely have nothing done to
  -- them. The filter still keys off the raw column, so a parcel shipped before
  -- migration 0016 (no timestamp, but long since handled) sorts correctly here
  -- while remaining visible under "To enter" — the two disagree only for those
  -- pre-0016 rows, and only in that one direction.
  (o.courier_entered_at IS NULL AND o.status = 'confirmed') AS needs_entry
FROM orders o;

-- Run the view as the caller, so it can never be a way around RLS on orders.
-- Wrapped because the option is Postgres 15+; on an older server the REVOKE
-- below is what keeps the view unreachable, and the migration should not fail
-- over a defence in depth.
DO $$
BEGIN
  EXECUTE 'ALTER VIEW portal_orders SET (security_invoker = on)';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'security_invoker not supported here; relying on grants';
END $$;

-- Supabase grants the public schema to anon and authenticated by default, and
-- the anon key ships to every browser. A readable view over orders would hand
-- out every customer's name, phone and address, so take it back explicitly:
-- this is service-role only, like the delivery RPCs.
REVOKE ALL ON portal_orders FROM PUBLIC;
REVOKE ALL ON portal_orders FROM anon, authenticated;
GRANT SELECT ON portal_orders TO service_role;

-- PostgREST serves from a cached schema. Supabase usually reloads it on DDL by
-- itself, but ask explicitly — until it does, the view 404s and the portal
-- falls back to the old ordering.
NOTIFY pgrst, 'reload schema';

-- No index for the new sort: `AT TIME ZONE` is STABLE, not IMMUTABLE, so the
-- expression cannot be indexed. The partial index from 0015 still serves the
-- filters and Postgres sorts the (small, day-sized) result. If the orders table
-- ever grows past what a sort node handles comfortably, the fix is a stored
-- ist_day column maintained by a trigger — not an index on this expression.

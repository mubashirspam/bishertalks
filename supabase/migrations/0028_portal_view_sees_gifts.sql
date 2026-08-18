-- Rebuild portal_orders so it can see the gift columns.
--
-- 0027 added is_gift and gift_message to orders and stopped there. The portal
-- reads `portal_orders`, which is `SELECT o.*` — and Postgres expands that star
-- once, when the view is created, into the column list as it stood that day.
-- The view has been frozen at 0024's columns ever since, so the portal's query
-- has been failing on "column portal_orders.is_gift does not exist" and quietly
-- falling back to the plain orders table.
--
-- Nothing looked broken, which is the part worth stating: the fallback returns
-- the right parcels, so the grid rendered and the gift badges appeared. What it
-- loses is the ordering — ist_day and needs_entry only exist on the view, so
-- the fallback sorts on created_at alone and the day's to-do list stops being
-- collected at the top of the day.
--
-- THE RULE, because this is the third time (0019, 0024, now): adding a column
-- to `orders` means rebuilding this view in the same migration. CREATE OR
-- REPLACE cannot do it — it refuses to change an existing view's column list —
-- so it is always DROP then CREATE, and the grants below have to come with it.
--
-- The definition is otherwise untouched from 0024.

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

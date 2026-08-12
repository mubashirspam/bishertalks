-- "Confirmed" means the column, and only the column.
--
-- The portal grid decided a parcel was confirmed two ways: courier_entered_at
-- was set, OR the parcel had reached Packed — on the reasoning that you cannot
-- pack a parcel you never entered with the courier. That inference was there to
-- cover rows from before migration 0016 added the column, and it quietly became
-- the source of a lie:
--
--   * The portal showed 102 parcels ticked Confirmed.
--   * /admin/delivery counted 1, because it counts the timestamp.
--   * Clicking undo on any of the other 101 wrote NULL over NULL. Nothing
--     changed, no count moved, and the tick came back on the next reload.
--
-- Two halves to the fix. This file is the data half: give every parcel that has
-- moved past 'confirmed' the timestamp it should have had, so the inference is
-- no longer load-bearing. The other half is in PortalGrid, which stops
-- inferring — after this, the column is the answer everywhere, undo clears
-- something real, and the counts move when it does.

-- The date used is the one that best says when it happened, in order of how
-- much we trust it. label_downloaded_at first: under the old rule a parcel only
-- reached 'processing' by having its label printed, so that IS the moment. Then
-- shipped_at, then when it was assigned, and created_at as the backstop — it is
-- NOT NULL, so no row is left without a date.
UPDATE orders
SET courier_entered_at = COALESCE(
      label_downloaded_at,
      shipped_at,
      assigned_at,
      created_at
    ),
    updated_at = NOW()
WHERE courier_entered_at IS NULL
  AND payment_status = 'paid'
  AND address_line1 IS NOT NULL
  -- Only parcels that actually moved. A parcel still at 'confirmed' has not
  -- been entered with anyone, which is the whole point of the New pile.
  AND status IN ('processing', 'shipped', 'out_for_delivery', 'delivered', 'returned');

-- needs_entry loses the same inference, for the same reason: it drove the
-- portal's sort ("not started yet, first") while the "To enter" filter next to
-- it keyed off the raw column, so the two disagreed on exactly these rows. One
-- definition now — no timestamp, no entry.
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

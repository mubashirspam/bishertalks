-- The parcel state, computed once, in the database.
--
-- 0034 added the columns; this makes the state derivable from them in SQL
-- rather than only in TypeScript. That matters for a reason beyond tidiness:
-- a state you cannot filter on is a state you cannot work from. Deriving it in
-- application code would mean loading every parcel to find the seven that need
-- attention, and neither counting nor paging would work.
--
-- One expression, one source of truth. The TypeScript keeps the labels and the
-- hints — what each state is *called* — and reads the value rather than
-- recomputing it, so the two can no longer disagree.
--
-- The order of the branches IS the model. See docs/delivery-states.md.

DROP VIEW IF EXISTS portal_orders;

CREATE VIEW portal_orders AS
SELECT
  o.*,

  -- created_at is UTC; the agent's day is an IST calendar day. Without the
  -- conversion every order placed after 6:30pm IST sorts into tomorrow.
  (o.created_at AT TIME ZONE 'Asia/Kolkata')::date AS ist_day,

  -- "Nobody has entered this with the courier yet."
  (o.courier_entered_at IS NULL) AS needs_entry,

  -- Does this parcel's courier report its own scans? Drives whether "no
  -- waybill" is a problem or simply how that courier works.
  ((c.config ->> 'tracking') IS NOT NULL) AS courier_tracks,

  CASE
    -- A waybill is proof the courier has it. First, because it settles the
    -- question outright whatever else the row says.
    WHEN COALESCE(o.tracking_number, '') <> '' THEN 'with_courier'

    WHEN o.courier_id IS NULL OR c.id IS NULL THEN 'unrouted'

    -- Cannot be delivered by this courier. Nothing else matters until it is
    -- re-routed, so this outranks the error states below.
    WHEN o.pincode_serviceable IS FALSE THEN 'unserviceable'

    -- A send we started and could not confirm. Above every other error,
    -- because it is the only one where the obvious action — retry — is wrong.
    WHEN COALESCE(o.courier_send_error, '') <> '' AND o.courier_sent_at IS NOT NULL
      THEN 'held'
    WHEN COALESCE(o.courier_send_error, '') <> '' THEN 'send_failed'

    -- A courier that never reports back. Its parcels are finished from our
    -- side the moment they are handed over; they must not sit in "awaiting"
    -- forever waiting for a confirmation that cannot arrive.
    WHEN (c.config ->> 'tracking') IS NULL THEN
      CASE WHEN o.courier_entered_at IS NOT NULL THEN 'handed_over' ELSE 'ready' END

    -- Trackable courier, not yet handed over.
    WHEN o.courier_entered_at IS NULL THEN
      CASE WHEN o.pincode_serviceable IS NULL THEN 'checking' ELSE 'ready' END

    -- Handed over, and no waybill has come back. Three reasons, three actions.
    WHEN COALESCE(o.courier_reference, '') = '' THEN 'legacy_unmatched'
    WHEN o.courier_checked_at IS NOT NULL THEN 'not_received'
    ELSE 'unconfirmed'
  END AS handover_state

FROM orders o
LEFT JOIN couriers c ON c.id = o.courier_id;

-- Run as the caller, so the view can never be a way around RLS on orders.
DO $$
BEGIN
  EXECUTE 'ALTER VIEW portal_orders SET (security_invoker = on)';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'security_invoker not supported here; relying on grants';
END $$;

-- Service-role only. This carries every customer's name, mobile and address,
-- and the anon key ships to every browser.
REVOKE ALL ON portal_orders FROM PUBLIC;
REVOKE ALL ON portal_orders FROM anon, authenticated;
GRANT SELECT ON portal_orders TO service_role;

NOTIFY pgrst, 'reload schema';

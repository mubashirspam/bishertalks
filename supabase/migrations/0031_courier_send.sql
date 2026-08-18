-- Recording a parcel the courier has accepted.
--
-- One statement rather than a read-then-write, because two of the three columns
-- have conditions attached and doing that in the application means a race
-- between the send route and an agent ticking the same parcel in the portal.
--
--   tracking_number      the waybill. Overwritten: the courier has just told us
--                        what this parcel is called, and that is now the truth,
--                        whatever anyone typed in the box earlier.
--
--   courier_entered_at   "this parcel is with the courier" — the same meaning it
--                        has had since 0016, set by every handoff. COALESCEd, so
--                        a parcel someone had already ticked keeps the moment it
--                        really happened rather than being back-stamped now.
--
--   courier_send_error   cleared. The send worked; a stale rejection sitting on
--                        the row would have the admin chasing a fixed problem.
--
-- courier_sent_at is deliberately NOT touched here. It was set when the parcel
-- was claimed, before the API call — see lib/db/courier-send.ts for why that
-- ordering is what stops one order becoming two parcels.

CREATE OR REPLACE FUNCTION record_courier_sent(
  p_order_number TEXT,
  p_waybill      TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
AS $$
  UPDATE orders SET
    tracking_number    = NULLIF(p_waybill, ''),
    courier_entered_at = COALESCE(courier_entered_at, NOW()),
    courier_send_error = NULL,
    updated_at         = NOW()
  WHERE order_number = p_order_number
  RETURNING TRUE;
$$;

-- Writes order state by order number, like every other bulk RPC here (0005).
REVOKE ALL ON FUNCTION record_courier_sent(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION record_courier_sent(text, text) TO service_role;

NOTIFY pgrst, 'reload schema';

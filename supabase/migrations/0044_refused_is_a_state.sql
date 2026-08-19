-- A refused parcel is a state, not a toast.
--
-- When Delhivery rejects a shipment inside a batch it otherwise accepted, the
-- send route releases the claim and writes the reason to courier_send_error.
-- That was the whole of it: the reason showed on the row if you happened to
-- scroll to it, the summary said "2 refused" and named neither, and the parcel
-- fell back to reading `to_hand_over` — indistinguishable from one nobody had
-- got to yet. The two need opposite things done to them.
--
-- So refusal gets its own handover_state, which makes it filterable, countable,
-- and something a person can be sent to fix.
--
-- The condition is deliberately narrow:
--
--   courier_send_error IS NOT NULL   the courier told us why
--   courier_sent_at IS NULL          and the claim was given back
--
-- Both halves matter. `markSendUncertain` writes an error and KEEPS the claim,
-- because a send whose outcome nobody knows may well have created a shipment —
-- those parcels are held, not refused, and must stay out of this state or
-- somebody will re-send a parcel that already exists.
--
-- Placed after the waybill and unassigned checks: a parcel that ended up with a
-- waybill is with the courier whatever happened on the way, and one with no
-- courier at all is unassigned first.
--
-- No columns change here. Only the view.

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

    -- The courier looked at this one and said no. It is routed, nobody has it,
    -- and it will sit here forever unless a person moves it somewhere else —
    -- which is exactly why it must not read as "to hand over".
    WHEN o.courier_send_error IS NOT NULL AND o.courier_sent_at IS NULL
      THEN 'send_refused'

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

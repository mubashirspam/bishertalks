-- Cash on delivery: a sale confirmed today, paid for at the door.
--
-- APPLY THIS BY HAND. Migrations here are not run automatically.
-- APPLY AFTER 0066 — this rebuilds portal_orders again and expects its columns.
--
-- WHY THIS EXISTS
--
-- Every direct sale until now was money already in hand: the customer paid by
-- UPI or cash at the moment staff typed the order in, and `payment_status` was
-- 'paid' from the very first write (see manual_payment_method, migration 0061,
-- and app/api/admin/orders/manual/route.ts). COD is a different shape of sale
-- — confirmed now, paid when the courier hands the parcel over — and recording
-- it as already-paid would tell the dashboard money arrived that has not, and
-- would let a referrer's commission approve before the shop has the cash to
-- pay it out of.
--
-- `delivery_mode` names WHICH KIND of sale this is. `payment_status` keeps its
-- existing meaning exactly — has the money actually landed. A COD order is
-- created 'pending' and stays that way until the delivery portal's Collect
-- action confirms the cash, at which point it becomes 'paid' the same way an
-- online payment does — see collectCodPayment() in lib/db/delivery.ts.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_mode TEXT NOT NULL DEFAULT 'normal';

DO $$
BEGIN
  ALTER TABLE orders
    ADD CONSTRAINT orders_delivery_mode_check
    CHECK (delivery_mode IN ('normal', 'cod'));
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'orders_delivery_mode_check already exists';
END $$;

COMMENT ON COLUMN orders.delivery_mode IS
  'normal (paid up front, the only kind before this migration) or cod (paid '
  'at the door). Only ever cod on a direct sale — online checkout always '
  'goes through Razorpay first. Does not change what payment_status means; '
  'see ready_for_delivery below for the column that actually reads both.';

-- ── Queue eligibility, without a second `or()` ──────────────────────────────
--
-- Every delivery query narrows to `payment_status = 'paid'` — five call sites
-- across lib/db/delivery-query.ts and lib/db/delivery-portal.ts, none of them
-- centralised. A COD order is deliberately unpaid at this point, so the naive
-- fix is `payment_status = 'paid' OR delivery_mode = 'cod'` at each site.
--
-- That fix is unsafe here specifically. portalQuery() in delivery-portal.ts
-- already spends this exact query's one safe `or()` on "assigned_agent_id OR
-- courier_id is not null", and says so in its own comment: "the scope above
-- already spends this query's one `or`, and PostgREST combining several
-- top-level `or` parameters is not something to rest a packing instruction
-- on." The delivery queue's own stage filter hit the same wall once already
-- (0045) and was rewritten to read a precomputed column for exactly this
-- reason — see applyDeliveryFilter() in lib/delivery-stage.ts.
--
-- A generated column does the same thing here: one equality, computed by
-- Postgres from the two columns beside it, so it can never drift out of sync
-- with them the way a value the application had to remember to write back
-- could.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ready_for_delivery BOOLEAN
  GENERATED ALWAYS AS (payment_status = 'paid' OR delivery_mode = 'cod') STORED;

COMMENT ON COLUMN orders.ready_for_delivery IS
  'Paid, or COD and therefore deliberately not paid yet. What every delivery '
  'query should filter on instead of payment_status = ''paid'' directly — see '
  'the migration this column was added in for why.';

-- ── The portal view, again ───────────────────────────────────────────────
--
-- Same reason as 0063/0064: portal_orders is SELECT o.*, that star was
-- expanded when the view was created, and the two new columns above do not
-- reach the delivery queue or the portal until it is rebuilt. Definition
-- unchanged from 0064 — copied verbatim, not retyped, for the reason 0064's
-- own comment gives: retyping this by hand is how one of the CASE branches
-- quietly changes meaning.

DROP VIEW IF EXISTS portal_orders;

CREATE VIEW portal_orders AS
SELECT
  o.*,
  -- ordered_at is UTC; the agent's day is an IST calendar day. Without the
  -- conversion every order placed after 6:30pm IST sorts into tomorrow.
  (o.ordered_at AT TIME ZONE 'Asia/Kolkata')::date AS ist_day,

  -- When this parcel became somebody's job. The portal's sort key and the
  -- day its date picker filters on.
  COALESCE(o.assigned_at, o.ordered_at) AS work_at,
  (COALESCE(o.assigned_at, o.ordered_at) AT TIME ZONE 'Asia/Kolkata')::date
    AS work_day,
  -- FALSE means the row above is the order date standing in for an assignment
  -- that never happened. The grid says so rather than letting one column mean
  -- two things depending on the row.
  (o.assigned_at IS NOT NULL) AS work_at_is_assignment,

  -- "Nobody has entered this with the courier yet."
  (o.courier_entered_at IS NULL) AS needs_entry,

  -- Real, not TRUE. Drives every "is no waybill a problem here?" answer.
  ((c.config ->> 'tracking') IS NOT NULL) AS courier_tracks,

  -- Where the parcel is in the queue. Must match deliveryStage().
  CASE
    WHEN o.status = 'returned'         THEN 'returned'
    WHEN o.status = 'cancelled'        THEN 'cancelled'
    WHEN o.status = 'delivered'        THEN 'delivered'
    WHEN o.status = 'out_for_delivery' THEN 'out_for_delivery'
    WHEN o.status = 'shipped'          THEN 'shipped'
    -- 'confirmed' / 'processing' — being routed is what separates them, and a
    -- courier routes a parcel just as much as an agent does.
    WHEN o.courier_id IS NOT NULL OR o.assigned_agent_id IS NOT NULL
      THEN 'assigned'
    ELSE 'new'
  END AS delivery_stage,

  CASE
    -- Sent by some other service, reported to us in a spreadsheet.
    WHEN o.transport_mode IS NOT NULL THEN 'other_transport'

    -- A waybill is proof somebody has it, whoever they are.
    WHEN COALESCE(o.tracking_number, '') <> '' THEN 'with_courier'

    WHEN o.courier_id IS NULL OR c.id IS NULL THEN 'unassigned'

    -- The courier looked at this one and said no. It is routed, nobody has it,
    -- and it will sit here forever unless a person moves it somewhere else.
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

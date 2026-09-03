-- A refund is its own fact, and it is not the same fact as a cancellation.
--
-- Today the two are conflated by omission. An order cancelled in the admin gets
-- status = 'cancelled' and nothing else happens to the money: `amount_paise`
-- still reads ₹699, `payment_status` still reads 'paid', and every screen that
-- sums revenue — the dashboard, the charts, /admin/reports — counts it in full.
-- Meanwhile the refund itself happened somewhere this system never looks: the
-- Razorpay dashboard. So the books say we kept money the bank has already sent
-- back.
--
-- The fix is NOT to treat cancelled as refunded. Most cancellations never see a
-- rupee returned — a parcel stopped before it shipped, a duplicate order, a
-- customer who changed their mind before we charged anything worth returning.
-- Inferring the refund from the cancellation would replace one wrong number
-- with a different wrong number. Only Razorpay knows what was actually sent
-- back, so only Razorpay may write these columns.
--
-- WHY payment_status IS LEFT ALONE. It is tempting to flip it to 'refunded'
-- (the enum in lib/types/order.ts has always had the value, unused). But that
-- column answers "did the money land?", and ~40 queries across this codebase
-- ask it with .eq('payment_status','paid') — the delivery portal, the label
-- print, the invoice, the course grant, the referral ledger, orderStage(). A
-- full refund would silently drop the order out of all of them, including the
-- ones that are simply history. It is the same rule the referral ledger already
-- states in 0008: money that moved is a fact, and a later reversal is a second
-- fact recorded beside it, not an edit to the first.
--
-- So: the payment stays paid, and the refund sits next to it. Revenue becomes
-- amount_paise - refunded_paise everywhere it is summed, which has the property
-- the enum could never have had — PARTIAL REFUNDS COME OUT RIGHT. Sending ₹200
-- back on a ₹699 order is not a state, it is a number, and it is the case this
-- shop will hit most often (a damaged copy, a delivery fee waived, a gift
-- charge returned).

-- How much of this order's money has actually gone back to the customer.
--
-- Cumulative across every refund on the payment, not the amount of the latest
-- one: Razorpay allows several partial refunds against one payment, and the
-- webhook writes this from `payment.amount_refunded` — the gateway's own
-- running total — rather than adding up events itself. That makes a redelivered
-- webhook a no-op instead of a double count, which matters because Razorpay
-- retries and this endpoint has no way to tell a retry from a second refund.
--
-- 0, never NULL: it is summed on every revenue screen, and a NULL in that
-- position turns a whole day's total into NULL.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS refunded_paise INTEGER NOT NULL DEFAULT 0;

-- When the money went back. NULL while refunded_paise is 0.
--
-- Stamped from the refund's own created_at where Razorpay gives us one, so a
-- refund backfilled months later lands on the day it actually happened rather
-- than the day somebody ran the script.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;

-- The most recent refund's id (rfnd_...). Not a key — a payment can carry
-- several — but it is the handle for reading one back off Razorpay when a
-- figure is questioned, and it is how a human tells "we recorded the refund"
-- apart from "somebody typed a number in".
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS razorpay_refund_id TEXT;

-- Refunds are a rounding error in row count and the thing you most want listed.
-- Partial, so it costs nothing on the ~99% of orders that were never refunded.
CREATE INDEX IF NOT EXISTS orders_refunded_idx
  ON orders (refunded_at DESC)
  WHERE refunded_paise > 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- portal_orders, rebuilt for the three new columns
-- ─────────────────────────────────────────────────────────────────────────────
--
-- THE RULE from 0028, and its second half from 0040: adding a column to
-- `orders` means rebuilding this view in the same migration, because `SELECT
-- o.*` was expanded into a fixed column list the day the view was created —
-- and copy the body from the LATEST migration that creates it, which is 0046,
-- never from an older one. Nothing below differs from 0046; the columns arrive
-- through the o.* expansion.

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

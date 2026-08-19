-- Signing is free.
--
-- 0040 shipped signed copies as a paid add-on at ₹99 a book. That was wrong
-- about the product: signing is what makes the gift option worth choosing, not
-- a second thing to sell inside it. A customer who has already paid to have a
-- parcel wrapped and a card written should be able to tick "signed" and see the
-- total not move.
--
-- So the flag stays and the money goes. `orders.is_signed` still says what has
-- to happen to the parcel, and `gift_settings.signed_is_enabled` still decides
-- whether the option is on offer — but there is no fee, no per-copy
-- arithmetic, and nothing to snapshot.
--
-- Written as its own migration rather than as an edit to 0040, which has
-- already been applied. A migration that has run is history; the way to change
-- what it did is another one.

-- Nothing here should ever have been charged, but "should" is not a guarantee,
-- and the columns about to be dropped are the only record of it if it was.
-- Refuse rather than destroy: a signing charge on a real order is money a
-- customer paid, and it belongs on their invoice.
DO $$
DECLARE
  charged INT;
BEGIN
  SELECT COUNT(*) INTO charged FROM orders WHERE signed_charge_paise > 0;
  IF charged > 0 THEN
    RAISE EXCEPTION
      'Refusing to drop signed_charge_paise: % order(s) were actually charged for signing. Refund or reconcile them first, then re-run.',
      charged;
  END IF;
END $$;

-- The view has to go first: it is SELECT o.*, so it depends on every column of
-- orders, and DROP COLUMN would fail on that dependency. It is rebuilt below.
DROP VIEW IF EXISTS portal_orders;

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_signed_charge_check;
ALTER TABLE orders DROP COLUMN IF EXISTS signed_charge_paise;

-- orders_signed_needs_gift_check stays. Signing is still only ever offered
-- inside the gift option, and free does not mean unconditional — a signed
-- order that nobody is wrapping is still a parcel with no card in it.

ALTER TABLE gift_settings DROP CONSTRAINT IF EXISTS gift_settings_signed_charge_check;
ALTER TABLE gift_settings DROP COLUMN IF EXISTS signed_charge_paise;

-- Rebuild portal_orders, unchanged from 0039 apart from the column that just
-- left `orders`.
--
-- THE RULE, restated because dropping a column is the same trap as adding one:
-- copy the definition from the LATEST migration that creates this view. That is
-- 0039 — with the couriers join, `courier_tracks` and `handover_state`. 0040
-- copied 0028's older body by mistake and took all three out; do not repeat it.

CREATE VIEW portal_orders AS
SELECT
  o.*,
  -- created_at is UTC; the agent's day is an IST calendar day. Without the
  -- conversion every order placed after 6:30pm IST sorts into tomorrow.
  (o.created_at AT TIME ZONE 'Asia/Kolkata')::date AS ist_day,
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

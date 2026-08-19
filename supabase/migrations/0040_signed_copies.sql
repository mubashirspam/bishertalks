-- Signed copies.
--
-- A second paid add-on, offered inside the gift box at checkout: the author
-- signs the books before they are wrapped. Priced per copy rather than per
-- order, which is the one place it differs from wrapping (0027) — one ribbon
-- goes round a parcel however many books are inside it, but five books is five
-- signatures.
--
-- Only ever sold with wrapping. That is a product decision, not a technical
-- one, but it is enforced here as well as in lib/gift.ts: a signed copy that
-- is not a gift would arrive in an ordinary jiffy bag with no card and nothing
-- to say why it is worth what was paid for it.
--
-- The charge is snapshotted on the order for the same reason as
-- gift_charge_paise: raising the fee next month must not rewrite what last
-- month's customers were charged.
--
-- FALSE and 0 as defaults make every existing row correct as it stands. None
-- of them were signed, and that is now what they say.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_signed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS signed_charge_paise INT NOT NULL DEFAULT 0;

DO $$
BEGIN
  -- The ceiling is the per-copy cap below (100000) times MAX_BOOKS in
  -- lib/quantity.ts (10). Raising either one without the other prices a charge
  -- this constraint then refuses, and the checkout fails at its last step —
  -- exactly the trap gift_charge_paise documents. Keep the three in step.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_signed_charge_check'
  ) THEN
    ALTER TABLE orders ADD CONSTRAINT orders_signed_charge_check
      CHECK (
        signed_charge_paise >= 0
        AND signed_charge_paise <= 1000000
        AND (is_signed OR signed_charge_paise = 0)
      );
  END IF;

  -- Signing is sold inside the gift option and nowhere else. Without this an
  -- order could be flagged for signing with no wrapping and no card, which is
  -- not a thing that was ever on sale.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_signed_needs_gift_check'
  ) THEN
    ALTER TABLE orders ADD CONSTRAINT orders_signed_needs_gift_check
      CHECK (NOT is_signed OR is_gift);
  END IF;
END $$;

-- No index of its own. Signed orders are a subset of gift orders, and
-- orders_gift_idx (0027) already collects those — a second partial index on a
-- rarer flag would be read by nothing the first one does not already serve.

-- The switch and the fee, alongside wrapping's own (0029).
--
-- Same table rather than one of its own: this is an option inside the gift box,
-- it is read on exactly the same code paths, and a second single-row settings
-- table would mean a second round trip on every checkout render to answer half
-- of one question.
ALTER TABLE gift_settings
  ADD COLUMN IF NOT EXISTS signed_is_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- What one signed copy costs, in paise — per book. Switched on by default at
-- ₹99, so the option is live as soon as this migration is applied; turn it off
-- in Admin → Promos if it should not be on sale yet.
--
-- The cap here is per copy. See orders_signed_charge_check above for why it is
-- a tenth of that constraint's ceiling.
ALTER TABLE gift_settings
  ADD COLUMN IF NOT EXISTS signed_charge_paise INT NOT NULL DEFAULT 9900;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'gift_settings_signed_charge_check'
  ) THEN
    ALTER TABLE gift_settings ADD CONSTRAINT gift_settings_signed_charge_check
      CHECK (signed_charge_paise >= 0 AND signed_charge_paise <= 100000);
  END IF;
END $$;

-- Rebuild portal_orders so it can see the two new columns.
--
-- THE RULE from 0028, fourth time of asking: adding a column to `orders` means
-- rebuilding this view in the same migration, because `SELECT o.*` was expanded
-- into a fixed column list the day the view was created. CREATE OR REPLACE
-- cannot do it — it refuses to change an existing view's column list — so it is
-- DROP then CREATE, and the grants have to come with it.
--
-- AND THE SECOND HALF OF THE RULE, which 0028 did not spell out and which this
-- migration got wrong first time round: copy the definition from the LATEST
-- migration that creates this view, not from the one that happens to explain
-- the rule. Six migrations have redefined it since 0028 — the current shape is
-- 0039's, with the couriers join, `courier_tracks` and `handover_state`.
-- Copying 0028's body forward silently drops all three, and the portal fails
-- with "column portal_orders.handover_state does not exist" while every filter
-- that reads it stops working.
--
-- The definition below is otherwise untouched from 0039.

DROP VIEW IF EXISTS portal_orders;

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

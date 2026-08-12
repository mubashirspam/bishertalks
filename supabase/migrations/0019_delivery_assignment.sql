-- Parcels belong to a delivery agent.
--
-- Until now the delivery queue's two working stages were derived from whether
-- a label PDF had been generated:
--
--   "New — label not printed"   label_downloaded_at IS NULL
--   "Printed — ready to ship"   label_downloaded_at IS NOT NULL
--
-- That was fine with one delivery agent, because "printed" and "handed over"
-- were the same event. With several agents it stops describing anything: a
-- printed label says a sheet came out of a printer, not who is taking the
-- parcel to the courier. And the portal at /admin/delivery-portal showed every
-- agent every parcel, which is the real problem — nobody knows whose work is
-- whose.
--
-- So the stage becomes assignment:
--
--   "New"                       assigned_agent_id IS NULL
--   "Assigned — ready to ship"  assigned_agent_id IS NOT NULL
--
-- Printing a label is now an action that assigns, rather than the thing being
-- tracked; label_downloaded_at stays as information (was it printed, how many
-- times) and no longer decides anything.

-- ----------------------------------------------------------------------------
-- COLUMNS
-- ----------------------------------------------------------------------------

-- ON DELETE SET NULL, not CASCADE: removing a staff member must never delete
-- orders. The parcels fall back to unassigned and show up as New again, which
-- is exactly the right thing to happen when an agent leaves.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS assigned_agent_id UUID
  REFERENCES staff(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS assigned_by UUID
  REFERENCES staff(id) ON DELETE SET NULL;

-- The portal's whole query: one agent's parcels, newest first. Partial on the
-- shippable scope for the same reason as idx_orders_portal — an unpaid order
-- with no address is never in either screen.
CREATE INDEX IF NOT EXISTS idx_orders_assigned_agent
  ON orders (assigned_agent_id, created_at DESC)
  WHERE payment_status = 'paid' AND address_line1 IS NOT NULL;

-- And the delivery queue's "New" tab, which is the inverse.
CREATE INDEX IF NOT EXISTS idx_orders_unassigned
  ON orders (created_at DESC)
  WHERE payment_status = 'paid' AND address_line1 IS NOT NULL
    AND assigned_agent_id IS NULL;

-- ----------------------------------------------------------------------------
-- BACKFILL
--
-- Everything already in flight belongs to the agent who has been doing this
-- work all along — the one existing delivery account. Two rules:
--
--   printed, or already shipped/delivered/returned  →  that agent
--   everything else                                 →  stays New
--
-- The second half matters as much as the first: parcels nobody had printed yet
-- are genuinely unassigned, and putting them in front of an agent would be
-- inventing history. They land in "New" and get assigned deliberately.
--
-- Deliberately fails loudly rather than guessing. If this raises, name the
-- agent by hand: SET assigned_agent_id = '<staff id>'.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_count INT;
  v_agent UUID;
  v_rows  INT;
BEGIN
  SELECT count(*) INTO v_count FROM staff WHERE role = 'delivery' AND is_active;

  IF v_count <> 1 THEN
    RAISE EXCEPTION
      'Expected exactly one active delivery agent to inherit existing parcels, found %. Assign them by hand and re-run the rest of this migration.',
      v_count;
  END IF;

  SELECT id INTO v_agent FROM staff WHERE role = 'delivery' AND is_active;

  UPDATE orders SET
    assigned_agent_id = v_agent,
    -- When it effectively happened, not when this migration ran — the printed
    -- date is the moment that parcel became someone's job.
    assigned_at = COALESCE(label_downloaded_at, shipped_at, created_at),
    updated_at  = NOW()
  WHERE payment_status = 'paid'
    AND address_line1 IS NOT NULL
    AND assigned_agent_id IS NULL          -- idempotent: re-running is a no-op
    AND (
      label_downloaded_at IS NOT NULL
      OR status IN ('shipped', 'out_for_delivery', 'delivered', 'returned')
    );

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RAISE NOTICE 'Assigned % existing parcels to staff %', v_rows, v_agent;
END $$;

-- ----------------------------------------------------------------------------
-- ASSIGNING
--
-- One round trip for a batch, like the other delivery mutations: handing a
-- day's post to an agent is one action and should either take or not.
-- p_agent_id NULL unassigns, which is how a mis-assignment is taken back.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION assign_orders(
  p_order_numbers TEXT[],
  p_agent_id      UUID DEFAULT NULL,
  p_actor_id      UUID DEFAULT NULL
)
RETURNS SETOF TEXT
LANGUAGE sql
AS $$
  UPDATE orders SET
    assigned_agent_id = p_agent_id,
    assigned_at = CASE WHEN p_agent_id IS NULL THEN NULL ELSE NOW() END,
    assigned_by = CASE WHEN p_agent_id IS NULL THEN NULL ELSE p_actor_id END,
    updated_at  = NOW()
  -- Same shippable scope the delivery list and the label sheet use. An unpaid
  -- order, or one with no address, is not a parcel and cannot be handed to
  -- anyone — it belongs in the funnel at /admin/orders.
  WHERE order_number = ANY(p_order_numbers)
    AND payment_status = 'paid'
    AND address_line1 IS NOT NULL
  RETURNING order_number;
$$;

-- Service-role only, like set_delivery_status. A publicly callable function
-- that reassigns parcels by order number would let anyone move someone else's
-- work onto their own screen.
REVOKE ALL ON FUNCTION assign_orders(text[], uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION assign_orders(text[], uuid, uuid) TO service_role;

-- ----------------------------------------------------------------------------
-- PORTAL VIEW
--
-- Rebuilt rather than replaced: the view is `SELECT o.*`, and the columns
-- added above land in the middle of that expansion — CREATE OR REPLACE VIEW
-- cannot change the column list of an existing view. Same definition as
-- migration 0018 otherwise; see there for what the two derived columns are
-- for. Everything the portal filters and sorts by now comes from here.
-- ----------------------------------------------------------------------------
DROP VIEW IF EXISTS portal_orders;

CREATE VIEW portal_orders AS
SELECT
  o.*,
  -- created_at is UTC; the agent's day is an IST calendar day. Without the
  -- conversion every order placed after 6:30pm IST sorts into tomorrow.
  (o.created_at AT TIME ZONE 'Asia/Kolkata')::date AS ist_day,
  -- "Nobody has started this one." Matches the Confirmed tick in the grid,
  -- which reads a parcel at Packed or beyond as entered even without the
  -- timestamp — you cannot pack a parcel you never entered.
  (o.courier_entered_at IS NULL AND o.status = 'confirmed') AS needs_entry
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

-- ----------------------------------------------------------------------------
-- PERMISSIONS
--
-- 'delivery.status' — "mark parcels shipped and delivered" from the delivery
-- list — is gone: statuses are now ticked off in the portal by the agent
-- holding the parcel, and the bulk endpoint behind that capability has been
-- deleted. The capability it becomes is the one that replaced it on that
-- screen: handing parcels to an agent.
--
-- Rewritten in the array rather than left to rot, because the array is the
-- truth (see 0007) and a stale key silently grants nothing.
-- ----------------------------------------------------------------------------
UPDATE staff
SET permissions = array_replace(permissions, 'delivery.status', 'delivery.assign'),
    updated_at  = NOW()
WHERE 'delivery.status' = ANY(permissions);

NOTIFY pgrst, 'reload schema';

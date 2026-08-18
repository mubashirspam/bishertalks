-- Logistics partners, as rows.
--
-- Until now there was exactly one courier and it was implicit: lib/courier-sheet
-- builds a Delhivery bulk-upload file, KKR Logistics uploads it by hand, and
-- nothing in the database says any of that. Adding a second partner meant a
-- migration, a deploy, and a new branch in every screen that shows a parcel.
--
-- So the partner list becomes data. Adding Speed Post, another express service,
-- or a rider we hand parcels to directly is then a row — and only a partner
-- with an API we actually call needs code written for it.
--
-- KKR is not a rival to Delhivery, which is the thing worth writing down here:
-- KKR is our pickup franchise INSIDE Delhivery's network. That is why
-- COURIER_DEFAULTS.pickupLocation has always been 'KKR LOGISTICS FRANCHISE'.
-- Both seeded rows below go to the same place; they differ only in how the
-- parcel gets there — an API call, or a spreadsheet somebody re-uploads.
--
-- Nothing in this migration sends anything anywhere. It is the vocabulary the
-- later phases need, and every existing order keeps working untouched.

-- ----------------------------------------------------------------------------
-- COURIERS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS couriers (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,

  -- What a human calls it. Renameable — nothing in the code reads this.
  name TEXT NOT NULL,

  -- What the code calls it, and the only stable handle: an adapter is selected
  -- by slug, so renaming a partner in the admin can never unhook its
  -- integration. Immutable in practice; the admin screen will not offer it for
  -- editing once a partner has carried a parcel.
  slug TEXT NOT NULL UNIQUE,

  -- The one field with behaviour attached — how a parcel physically leaves us:
  --
  --   'api'    we call the partner and they have it. Delhivery only, for now,
  --            and the only kind that needs an adapter written.
  --   'sheet'  we produce the .xlsx they upload themselves. Today's flow.
  --   'manual' we hand it over or post it, and someone types the tracking
  --            number in afterwards. This is the escape hatch: it is how a new
  --            partner works on the day it is added, with no code at all.
  handoff TEXT NOT NULL CHECK (handoff IN ('api', 'sheet', 'manual')),

  -- Whatever one partner needs and the others don't: pickup location, client
  -- name, service mode. JSONB rather than columns because the fields are
  -- per-partner by definition — a column that only one row ever fills in is a
  -- column every other row has to explain.
  --
  -- Never secrets. Tokens stay in the environment; this row is readable by
  -- anything holding the service key and is shown in an admin form.
  config JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Switched off rather than deleted, so a partner we stop using keeps its
  -- history. The FK below enforces the same thing from the other side.
  is_active BOOLEAN NOT NULL DEFAULT TRUE,

  sort_order INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_couriers_active
  ON couriers (sort_order, name) WHERE is_active;

DROP TRIGGER IF EXISTS couriers_updated_at ON couriers;
CREATE TRIGGER couriers_updated_at
  BEFORE UPDATE ON couriers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ----------------------------------------------------------------------------
-- SEED
--
-- Two rows, both going to Delhivery, differing only in the handoff. The sheet
-- row is what happens today and stays the fallback for an API outage — a day's
-- parcels should not be stuck because a token expired.
--
-- pickup_location must match a warehouse Delhivery has registered, exactly, or
-- their create call rejects the whole payload. It is seeded with the name we
-- already print on the sheet; Phase 0 of the plan confirms it with them.
-- ----------------------------------------------------------------------------
INSERT INTO couriers (name, slug, handoff, config, sort_order)
VALUES
  (
    'Delhivery',
    'delhivery',
    'api',
    '{"pickup_location": "KKR LOGISTICS FRANCHISE", "mode": "surface"}'::jsonb,
    10
  ),
  (
    'Delhivery — Excel sheet',
    'delhivery-sheet',
    'sheet',
    '{"pickup_location": "KKR LOGISTICS FRANCHISE", "mode": "surface"}'::jsonb,
    20
  )
ON CONFLICT (slug) DO NOTHING;

-- ----------------------------------------------------------------------------
-- ORDERS
-- ----------------------------------------------------------------------------

-- Who carries this parcel. NULL means nobody has decided yet, which is where
-- every order starts — deliberately not defaulted to a partner, because
-- "assigned to Delhivery" is a decision someone makes, and a default would put
-- parcels in front of a courier that nobody chose.
--
-- ON DELETE RESTRICT: a partner that has carried a parcel cannot be deleted out
-- from under its history. Deactivate it instead. A partner added by mistake,
-- with no orders, still deletes cleanly.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS courier_id UUID
  REFERENCES couriers(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_orders_courier ON orders (courier_id)
  WHERE courier_id IS NOT NULL;

-- When the partner accepted it. Distinct from courier_entered_at, which is the
-- portal's "this parcel is with the courier" tick and is set by every handoff:
-- this one is specifically "an API call succeeded", and it is what makes a
-- re-send detectable.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS courier_sent_at TIMESTAMPTZ;

-- The last rejection, kept so a failure is visible on the screen rather than
-- only in a log nobody is watching. Cleared on a successful send.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS courier_send_error TEXT;

-- The most recent scan from the partner, for the portal and the order page.
-- Free text on purpose — it is the courier's own wording, shown as-is, and
-- normalising it would mean guessing at statuses we have not seen yet.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS courier_last_scan TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS courier_last_scan_at TIMESTAMPTZ;

-- Parcels that have already gone out on a sheet. courier_reference is set by
-- one thing only — buildCourierSheet, via mark_courier_entered (0024) — so it
-- is exact evidence of which handoff carried them, and backfilling makes the
-- delivery list honest about history from the first load rather than showing a
-- year of parcels as having no courier at all.
UPDATE orders o
SET courier_id = c.id
FROM couriers c
WHERE c.slug = 'delhivery-sheet'
  AND o.courier_id IS NULL
  AND o.courier_reference IS NOT NULL;

-- ----------------------------------------------------------------------------
-- PORTAL VIEW
--
-- Rebuilt because it is `SELECT o.*`, which Postgres expanded into a fixed
-- column list when the view was created — the new columns above are invisible
-- to it until it is dropped and recreated, and the portal's query then fails on
-- them. See 0028, which is this exact mistake being fixed after the fact.
--
-- Same definition as 0028 otherwise.
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- RLS — deny by default, like every other admin table here. The anon key ships
-- to every browser, and a writable couriers row is a way to redirect a day's
-- parcels to a pickup location we don't own.
-- ----------------------------------------------------------------------------
ALTER TABLE couriers ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

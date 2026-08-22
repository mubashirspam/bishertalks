-- A delivery login belongs to a courier partner.
--
-- APPLY THIS BY HAND. Migrations here are not run automatically — see the
-- error text in lib/db/delivery-portal.ts, which exists because 0024 was left
-- unapplied and an agent got "column does not exist" on a screen they were
-- standing in front of.
--
-- WHY: partner staff are about to log in. Mubashir Logistic has existed as a
-- courier since 0039; what has never existed is a way for their people to see
-- their own parcels and nobody else's. The portal answered "whose parcel is
-- this" with `assigned_agent_id` — a person — and docs/delivery-model.md
-- settled some time ago that the honest answer is the courier:
--
--   Who sees a parcel in the portal is answered by the courier, not by an
--   agent: KKR's login sees Delhivery parcels because that is their courier.
--
-- The data agrees. Of 512 live parcels, 487 carry a courier_id and 198 carry
-- an agent. Scoping by agent would hide 61% of the work from the only person
-- doing it — which is exactly what has been happening: the portal *showed*
-- kkrlogistic all 512 while every route refused to act on 314 of them.
--
-- `assigned_agent_id` is NOT removed. It stops being the scoping key and stays
-- as what it always was underneath: a note of which named person is carrying a
-- parcel, still filterable by an owner on /admin/delivery-portal.

-- ─────────────────────────────────────────────────────────────────────────────
-- The link
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Nullable, and null is the normal state: owners, managers and support are not
-- partner logins and must not be scoped to anything. The code reads null on a
-- *delivery* login as "sees nothing", never as "sees everything" — a partner
-- account created without a courier has to fail closed, because the failure in
-- the other direction hands one partner every other partner's customers.
--
-- ON DELETE SET NULL rather than CASCADE: deleting a courier must not delete
-- the people. It leaves their login intact and showing nothing, which is a
-- state an owner can see and fix.

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS courier_id uuid REFERENCES couriers(id) ON DELETE SET NULL;

COMMENT ON COLUMN staff.courier_id IS
  'The delivery partner this login belongs to. Scopes the delivery portal to '
  'that courier''s parcels. NULL for staff who are not partner logins.';

-- Small table, but every portal page load resolves the signed-in staff row and
-- the admin screens list partner logins per courier.
CREATE INDEX IF NOT EXISTS idx_staff_courier ON staff (courier_id)
  WHERE courier_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill 1: the login that already exists
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `kkrlogistic` is KKR Logistics, who are a Delhivery franchise — the courier
-- row with slug 'delhivery'. Without this the moment the new code ships their
-- portal goes empty, which is the one outcome worse than the bug being fixed.
--
-- Matched on role AND slug rather than on the name, so a renamed login still
-- gets it and a non-delivery account never does.

UPDATE staff
SET courier_id = (SELECT id FROM couriers WHERE slug = 'delhivery'),
    updated_at = NOW()
WHERE role = 'delivery'
  AND courier_id IS NULL
  AND (SELECT id FROM couriers WHERE slug = 'delhivery') IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill 2: parcels that name an agent but no courier
-- ─────────────────────────────────────────────────────────────────────────────
--
-- 25 live parcels were assigned to a person before routing became a courier
-- decision. Once the portal scopes on courier_id they belong to nobody and
-- vanish from the only screen anyone would find them on. So they inherit the
-- courier of the agent they were given to.
--
-- Deliberately not touching delivered/returned/cancelled rows: they are
-- finished, nothing will act on them again, and rewriting history to make a
-- filter tidy is how a report starts lying.

UPDATE orders o
SET courier_id = s.courier_id,
    updated_at = NOW()
FROM staff s
WHERE o.assigned_agent_id = s.id
  AND o.courier_id IS NULL
  AND s.courier_id IS NOT NULL
  AND o.status NOT IN ('delivered', 'returned', 'cancelled');

NOTIFY pgrst, 'reload schema';

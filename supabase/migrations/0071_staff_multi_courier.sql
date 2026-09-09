-- A staff login can carry more than one delivery partner.
--
-- APPLY THIS BY HAND. Migrations here are not run automatically.
--
-- WHY THIS EXISTS
--
-- staff.courier_id (0047) is one partner per login. That was right for the
-- shop this started as — one partner login, one partner — and stops being
-- right the moment a single login needs to see more than one courier's
-- parcels: someone who works both KKR Logistics and Mubashir Logistic today
-- has to be given two separate accounts, or one account scoped to only half
-- their actual work.
--
-- A real join table, not a wider array column. `staff.permissions` is
-- text[] on purpose — see 0007's own comment: "the list is short, fixed, and
-- read on every admin page load; a join table would buy nothing but
-- queries." Couriers are the opposite case: a real table with its own
-- lifecycle (couriers get added and switched off), and staff_couriers needs
-- the same ON DELETE behaviour staff.courier_id already had — a courier
-- removed must cleanly drop the link, not leave a dangling id sitting in an
-- array nothing validates. course_access (0001) is the template.
--
-- staff.courier_id is NOT dropped. It is backfilled into the new table and
-- then simply stops being what the code reads for scoping — removing a
-- column by hand, on a table nothing here can roll back, is a risk this
-- migration does not need to take to do its job.

CREATE TABLE IF NOT EXISTS staff_couriers (
  staff_id   UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  courier_id UUID NOT NULL REFERENCES couriers(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (staff_id, courier_id)
);

CREATE INDEX IF NOT EXISTS idx_staff_couriers_courier ON staff_couriers (courier_id);

COMMENT ON TABLE staff_couriers IS
  'Which delivery partners a staff login may see and act on in the delivery '
  'portal (0071). Replaces staff.courier_id as the source of truth for '
  'scoping — see lib/delivery/scope.ts. A login with no rows here sees '
  'nothing, exactly as courier_id IS NULL did.';

ALTER TABLE staff_couriers ENABLE ROW LEVEL SECURITY;

-- Every existing single link becomes its first row here. ON CONFLICT DO
-- NOTHING makes re-running this migration harmless.
INSERT INTO staff_couriers (staff_id, courier_id)
SELECT id, courier_id FROM staff WHERE courier_id IS NOT NULL
ON CONFLICT (staff_id, courier_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';

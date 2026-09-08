-- A shared list of things staff need to do, and who is doing them.
--
-- APPLY THIS BY HAND. Migrations here are not run automatically.
--
-- WHY THIS EXISTS
--
-- "Customer says delivered but not received", "check this tracking", "fix
-- this address" — none of these are an order's own status, and none of them
-- had anywhere to live before this. They happened over chat, or not at all,
-- and there was no way to see who was meant to be handling one or whether it
-- had been.
--
-- WHY A NEW TABLE AND NOT A COLUMN ON `orders`
--
-- Most orders never need a task, some need several, and a task is not always
-- about an order at all — "internal" and "other" exist because plenty of
-- what staff hand each other has no order behind it. A one-to-many thing that
-- is sometimes zero-to-many does not belong bolted onto the row it is
-- usually, but not always, about.
--
-- order_number/customer_name/customer_phone are a SNAPSHOT taken when the
-- task is created, not a live join through order_id. A task has to still read
-- sensibly if the order it names is edited later, or if there never was one —
-- "enter manually" for a customer not in the system at all is a real path
-- (see the admin's task form), and order_id is simply null then.

CREATE TABLE IF NOT EXISTS tasks (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  title              text NOT NULL,
  description        text,

  category           text NOT NULL DEFAULT 'other',
  priority           text NOT NULL DEFAULT 'normal',  -- 'normal' | 'urgent'
  status             text NOT NULL DEFAULT 'open',     -- 'open' | 'in_progress' | 'solved'

  order_id           uuid REFERENCES orders(id) ON DELETE SET NULL,
  order_number       text,
  customer_name      text,
  customer_phone     text,

  -- Attribution pair, same shape as expenses.actor_id/actor_email (0062):
  -- the id for joining while the staff row exists, the email so the trail
  -- still reads once it doesn't.
  created_by_id      uuid REFERENCES staff(id) ON DELETE SET NULL,
  created_by_email   text NOT NULL,
  assigned_to_id     uuid REFERENCES staff(id) ON DELETE SET NULL,
  assigned_to_email  text,

  -- Denormalised for the list screen, which shows "solved 2h ago by X"
  -- without a join. The audit log (see below) still carries the full history.
  solved_at          timestamptz,
  solved_by_email    text,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  ALTER TABLE tasks
    ADD CONSTRAINT tasks_category_check
    CHECK (category IN (
      'delivery_issue', 'marked_delivered_not_received', 'tracking_request',
      'payment_issue', 'address_correction', 'order_issue', 'customer_query',
      'internal', 'other'
    ));
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'tasks_category_check already exists';
END $$;

DO $$
BEGIN
  ALTER TABLE tasks
    ADD CONSTRAINT tasks_priority_check
    CHECK (priority IN ('normal', 'urgent'));
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'tasks_priority_check already exists';
END $$;

DO $$
BEGIN
  ALTER TABLE tasks
    ADD CONSTRAINT tasks_status_check
    CHECK (status IN ('open', 'in_progress', 'solved'));
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'tasks_status_check already exists';
END $$;

-- The board's own queue tabs: everything open, or one assignee's queue.
CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks (status, created_at DESC);
CREATE INDEX IF NOT EXISTS tasks_assigned_idx ON tasks (assigned_to_id, status);
CREATE INDEX IF NOT EXISTS tasks_created_idx ON tasks (created_at DESC);

-- Urgent tasks are a small set read constantly — the nav badge and the Urgent
-- tab both ask "how many, and which" — so, same reasoning as
-- idx_orders_urgent (0063), the index covers only them rather than the
-- 'normal' majority.
CREATE INDEX IF NOT EXISTS tasks_urgent_idx ON tasks (created_at DESC)
  WHERE priority = 'urgent' AND status != 'solved';

-- Service-role only, like every other internal-only table. The anon key ships
-- to every browser, and this table carries customer names and phone numbers
-- typed in by hand.
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

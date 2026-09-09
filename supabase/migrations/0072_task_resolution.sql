-- A fourth status, and a real answer for "how was this solved".
--
-- APPLY THIS BY HAND. Migrations here are not run automatically.
--
-- WHY THIS EXISTS
--
-- Open → In progress → Solved was the whole lifecycle, and it left two real
-- gaps. First, a task that is genuinely stuck on somebody else — waiting on
-- the courier to answer, waiting on the customer to reply — was filed as
-- "in progress", which is not true and which buried it among tasks somebody
-- is actively working. `waiting` names that state honestly.
--
-- Second, marking a task Solved recorded WHO and WHEN (solved_at,
-- solved_by_email — 0066) but never WHAT. A delivery task closed with no
-- note is a customer's problem that vanished with no record of what fixed
-- it — the next person who opens the same customer's next task has nothing
-- to go on. `resolution_note` is that record. `resolution_tracking_id`
-- alongside it is the specific, common case for delivery tasks: a "marked
-- delivered, not received" ticket is usually solved by finding — or
-- issuing — the waybill or article number that actually explains what
-- happened, and that number deserves its own field, not a sentence it has
-- to be dug out of.
--
-- Neither resolution field is required at the database layer — plenty of
-- tasks (internal, customer_query) have nothing delivery-shaped to log a
-- tracking id against, and a CHECK that demanded one for every solve would
-- be exactly the kind of rule that gets worked around with a dot typed into
-- a box. The prompt for both lives in the UI, where it can vary by category
-- instead.

-- Widen rather than a second constraint, so there is exactly one place
-- naming what `status` may be.
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_check;

ALTER TABLE tasks
  ADD CONSTRAINT tasks_status_check
  CHECK (status IN ('open', 'in_progress', 'waiting', 'solved'));

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS resolution_note TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS resolution_tracking_id TEXT;

COMMENT ON COLUMN tasks.resolution_note IS
  'What actually fixed it, written when a task is marked solved (0072). Not '
  'required — plenty of tasks have nothing more to say than the status '
  'change itself — but asked for by the UI on every solve.';
COMMENT ON COLUMN tasks.resolution_tracking_id IS
  'The waybill, article number or other tracking id that explains how a '
  'delivery-shaped task was actually resolved (0072). Optional, and only '
  'ever meaningful alongside resolution_note — see lib/tasks.ts for which '
  'categories the UI prompts for it on.';, 

NOTIFY pgrst, 'reload schema';

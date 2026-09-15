-- Customer care calling lists.
--
-- APPLY THIS BY HAND. Migrations here are not run automatically.
--
-- WHY THIS EXISTS
--
-- The reports screen finds the parcels worth a phone call ("Consignee
-- Unavailable", "late over 10 days"), and until now the only thing to do with
-- that list was download it and hand somebody a spreadsheet — no record of who
-- rang whom, whether they picked up, or when to try again. This is that record.
--
-- WHY NOT THE `tasks` TABLE
--
-- A task is one piece of work somebody writes up by hand. A calling list is
-- hundreds of near-identical rows created in one click from a filter, each
-- with its own attempt count, call-back time and outcome. Mixing the two
-- would bury the hand-written tasks under the generated ones, and neither
-- screen's filters fit the other's rows.
--
-- ONE OPEN CALL PER ORDER
--
-- Assigning the same filter twice must not ring the same customer twice, so
-- an order has at most one call that isn't done (the partial unique index).
-- Once closed, a later list can open a fresh one — the old row stays as
-- history.
--
-- Customer name, phone and the courier remark are NOT copied here: they're
-- read live from `orders` through order_id, because the remark is the one
-- thing that changes between assigning a list and making the call, and a
-- corrected phone number must reach the person dialling it.

CREATE TABLE IF NOT EXISTS call_tasks (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  order_id             uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_number         text NOT NULL,

  assigned_to_id       uuid REFERENCES staff(id) ON DELETE SET NULL,
  assigned_to_email    text,
  assigned_by_email    text NOT NULL,
  assigned_at          timestamptz NOT NULL DEFAULT now(),
  -- Free text naming the list it came from ("Consignee Unavailable 15 Sep"),
  -- so a staff member can tell two batches apart.
  batch_label          text,

  -- The latest outcome. Every attempt is kept in call_attempts below.
  call_status          text NOT NULL DEFAULT 'not_called'
    CHECK (call_status IN ('not_called', 'attended', 'not_attended', 'switched_off', 'wrong_number')),
  flags                text[] NOT NULL DEFAULT '{}'
    CHECK (flags <@ ARRAY[
      'recall', 'urgent', 'not_received', 'address_issue',
      'wants_cancel', 'says_delivered', 'escalate'
    ]::text[]),
  note                 text,
  callback_at          timestamptz,

  attempts             int NOT NULL DEFAULT 0,
  last_called_at       timestamptz,
  last_called_by_email text,

  done                 boolean NOT NULL DEFAULT false,
  done_at              timestamptz,
  done_by_email        text,

  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS call_tasks_one_open_per_order
  ON call_tasks (order_id) WHERE NOT done;
CREATE INDEX IF NOT EXISTS call_tasks_assignee_idx
  ON call_tasks (assigned_to_id, done, assigned_at DESC);
CREATE INDEX IF NOT EXISTS call_tasks_callback_idx
  ON call_tasks (callback_at) WHERE NOT done AND callback_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS call_tasks_flags_idx
  ON call_tasks USING gin (flags);

-- Every call made, not just the last one — "rang three times, never picked
-- up" is the fact that decides whether to keep trying.
CREATE TABLE IF NOT EXISTS call_attempts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_task_id  uuid NOT NULL REFERENCES call_tasks(id) ON DELETE CASCADE,
  outcome       text NOT NULL
    CHECK (outcome IN ('attended', 'not_attended', 'switched_off', 'wrong_number')),
  note          text,
  callback_at   timestamptz,
  staff_id      uuid REFERENCES staff(id) ON DELETE SET NULL,
  staff_email   text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS call_attempts_task_idx
  ON call_attempts (call_task_id, created_at DESC);

-- Service role only, like every other table the admin reads: both hold
-- customer phone numbers by way of the order.
ALTER TABLE call_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_attempts ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

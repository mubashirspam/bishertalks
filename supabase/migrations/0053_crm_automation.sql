-- 0053 · CRM automation: tags, relationship stage, button payloads, and the
-- follow-up queue.
--
-- Additive only. Everything here hangs off tables 0052 already created —
-- deliberately, because a second `customers` table alongside whatsapp_contacts
-- is how one person ends up with two stop flags, one of which nothing checks.
--
-- Safe to run twice.

-- ── Contacts: what we know about the relationship ───────────────────────────
--
-- `current_stage` is the RELATIONSHIP stage — delivered_confirmed,
-- active_reader, slow_reader — and only that. The funnel stage (never started
-- / payment started / failed / paid) is derived per person in
-- lib/crm/people.ts from the orders themselves, and a stored copy of a derived
-- thing drifts from it within a week. Store only what nothing else knows.
ALTER TABLE whatsapp_contacts
  ADD COLUMN IF NOT EXISTS tags          text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS current_stage text,
  ADD COLUMN IF NOT EXISTS source        text;

CREATE INDEX IF NOT EXISTS whatsapp_contacts_tags_idx
  ON whatsapp_contacts USING gin (tags);

CREATE INDEX IF NOT EXISTS whatsapp_contacts_stage_idx
  ON whatsapp_contacts (current_stage)
  WHERE current_stage IS NOT NULL;

-- Adding a tag without a read-modify-write, so two button taps arriving
-- together cannot lose one of the two tags. The guard makes it idempotent:
-- tagging someone twice updates no rows.
CREATE OR REPLACE FUNCTION crm_add_tag(p_contact_id uuid, p_tag text)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE whatsapp_contacts
     SET tags = array_append(tags, p_tag),
         updated_at = now()
   WHERE id = p_contact_id
     AND NOT (tags @> ARRAY[p_tag]);
$$;

-- ── Messages: what the customer actually tapped ─────────────────────────────
--
-- The button's id, not its title. Titles are reworded, translated and repeated
-- across flows — "Need Help" appears in three of them — so a payload is the
-- only thing a flow can be replayed or audited against.
ALTER TABLE whatsapp_messages
  ADD COLUMN IF NOT EXISTS button_payload text,
  ADD COLUMN IF NOT EXISTS order_id       uuid REFERENCES orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS whatsapp_messages_payload_idx
  ON whatsapp_messages (button_payload)
  WHERE button_payload IS NOT NULL;

-- ── The follow-up queue ─────────────────────────────────────────────────────
--
-- One row per planned message. Nothing sends from a request handler; the
-- worker at /api/cron/whatsapp-automation drains this, and every row still
-- passes the gate individually — so a customer who opts out at 4pm is refused
-- on their own row at 5pm rather than messaged because a rule fired at noon.
CREATE TABLE IF NOT EXISTS whatsapp_automation_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id     uuid NOT NULL REFERENCES whatsapp_contacts(id) ON DELETE CASCADE,
  order_id       uuid REFERENCES orders(id) ON DELETE SET NULL,

  -- What this is, in our own words: reading_followup_10d, later_reminder,
  -- feedback_30d. Stable across template renames.
  event_type     text NOT NULL,
  template_name  text,

  scheduled_at   timestamptz NOT NULL,
  executed_at    timestamptz,

  -- pending | sending | sent | refused | failed | cancelled
  --
  -- `sending` is a claim, held for as long as one worker run takes. It exists
  -- so two overlapping runs cannot both take the same row, and so a row left
  -- behind by a crashed worker is visible as stuck rather than retried
  -- forever. crm_release_stale_events() puts those back.
  status         text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','sending','sent','refused','failed','cancelled')),

  -- Why, when it did not send. A refusal is a decision and is never retried;
  -- a failure may be, once.
  refusal_code   text,
  error          text,
  attempts       int NOT NULL DEFAULT 0,

  -- Which button, or which rule, put this here. Answers "why is this customer
  -- getting a message in nine days" without reading the code.
  created_reason text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- The worker's only query: what is due.
CREATE INDEX IF NOT EXISTS wae_due_idx
  ON whatsapp_automation_events (scheduled_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS wae_contact_idx
  ON whatsapp_automation_events (contact_id, status);

-- One pending event of a kind per contact per order.
--
-- This is what makes the rules idempotent, and it settles a collision the
-- brief contains: "when the customer taps Received, schedule the 10-day
-- follow-up" and "10 days after delivered_at, send the 10-day follow-up" are
-- two rules that both fire for the same person. With this index the second is
-- a no-op, and the click wins — which is the right way round, because a tap is
-- the customer saying the book arrived and a courier scan is only a guess.
--
-- COALESCE rather than a nullable column in the key: in Postgres two NULLs are
-- distinct, so without it every unordered event would be allowed twice.
CREATE UNIQUE INDEX IF NOT EXISTS wae_one_pending_idx
  ON whatsapp_automation_events (
    contact_id,
    event_type,
    COALESCE(order_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE status = 'pending';

-- Claim due rows in one statement.
--
-- The claim IS the update. Reading first and updating after is the version of
-- this that double-sends when a run overlaps itself, and a cron that overlaps
-- itself is a normal Tuesday.
--
-- SKIP LOCKED so a second worker takes the next rows rather than blocking on
-- the first worker's.
CREATE OR REPLACE FUNCTION crm_claim_due_events(p_limit int DEFAULT 100)
RETURNS SETOF whatsapp_automation_events
LANGUAGE sql
AS $$
  UPDATE whatsapp_automation_events
     SET status = 'sending', updated_at = now()
   WHERE id IN (
     SELECT id
       FROM whatsapp_automation_events
      WHERE status = 'pending'
        AND scheduled_at <= now()
      ORDER BY scheduled_at
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
   )
  RETURNING *;
$$;

-- A worker that died mid-run leaves rows claimed. Anything held for more than
-- an hour is not being worked on by anybody.
CREATE OR REPLACE FUNCTION crm_release_stale_events()
RETURNS int
LANGUAGE plpgsql
AS $$
DECLARE released int;
BEGIN
  UPDATE whatsapp_automation_events
     SET status = 'pending', updated_at = now()
   WHERE status = 'sending'
     AND updated_at < now() - interval '1 hour';
  GET DIAGNOSTICS released = ROW_COUNT;
  RETURN released;
END;
$$;

-- Service role only, like every other table in 0052. Nothing here is ever read
-- from the browser.
ALTER TABLE whatsapp_automation_events ENABLE ROW LEVEL SECURITY;

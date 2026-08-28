-- ─────────────────────────────────────────────────────────────────────────────
-- The WhatsApp CRM: contacts, conversations, campaigns, and the consent record
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Built around one constraint: the sending number must not lose its quality
-- rating or its registration. Everything here exists to make that the default
-- rather than something a careful person remembers.
--
-- notification_log is untouched. It already records every automated outbound
-- message with its delivered/read receipts and failure codes (0014, 0025), and
-- splitting that history in two to fit a new table would lose the answer to
-- "what did this customer get?" for every order placed so far.

-- ── Contacts: the consent record ────────────────────────────────────────────
--
-- Keyed on the phone number, deliberately, and not on the order or the user.
-- One person places three orders under two spellings of their name; consent
-- belongs to whoever owns the handset. A stop flag that lived on an order row
-- could be escaped by placing another order, which is exactly the thing that
-- must never happen.
--
-- `phone` is stored the way toWhatsAppNumber() produces it — 12 digits, country
-- code first, no plus. Anything else and two rows describe one person.

CREATE TABLE IF NOT EXISTS whatsapp_contacts (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone          TEXT NOT NULL UNIQUE CHECK (phone ~ '^91[6-9][0-9]{9}$'),
  display_name   TEXT,

  -- Best-effort links. A contact can exist with neither: someone can message
  -- the number without ever having ordered.
  user_id        UUID,
  last_order_number TEXT,

  -- ── The stop flag ──
  -- Set: never message again, whatever the category. Cleared only by an admin
  -- action that writes an audit row.
  opt_out_at     TIMESTAMPTZ,
  opt_out_reason TEXT,
  opt_out_source TEXT CHECK (opt_out_source IN ('customer', 'staff', 'system')),

  -- Marketing needs a positive signal, not merely the absence of a stop.
  marketing_opt_in_at TIMESTAMPTZ,

  -- Opens the 24-hour window in which free text is allowed.
  last_inbound_at  TIMESTAMPTZ,
  last_outbound_at TIMESTAMPTZ,

  -- Unread count for the inbox, maintained by the webhook and cleared on read.
  unread_count   INT NOT NULL DEFAULT 0,
  assigned_to    UUID,

  -- Meta will not tell us we were blocked. Repeated undeliverable sends are
  -- the closest signal there is, and enough of them auto-sets the stop flag.
  failed_streak  INT NOT NULL DEFAULT 0,

  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wa_contacts_inbox
  ON whatsapp_contacts (last_inbound_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_wa_contacts_optout
  ON whatsapp_contacts (opt_out_at) WHERE opt_out_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wa_contacts_unread
  ON whatsapp_contacts (unread_count) WHERE unread_count > 0;

-- ── Messages: one thread per contact ────────────────────────────────────────
--
-- Both directions in one table. A conversation read from two tables joined by
-- timestamp is a conversation that will eventually render out of order.

CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id    UUID NOT NULL REFERENCES whatsapp_contacts(id) ON DELETE CASCADE,
  direction     TEXT NOT NULL CHECK (direction IN ('in', 'out')),

  -- Meta's message id. Unique so a webhook retry cannot duplicate a message,
  -- and so a status callback can find the row it belongs to.
  wamid         TEXT UNIQUE,

  kind          TEXT NOT NULL DEFAULT 'text'
                  CHECK (kind IN ('text', 'template', 'image', 'audio',
                                  'video', 'document', 'sticker', 'other')),
  body          TEXT,
  template_name TEXT,

  -- Outbound only. Mirrors notification_log's vocabulary on purpose.
  status        TEXT CHECK (status IN ('queued','sent','delivered','read','failed')),
  error         TEXT,
  error_code    INT,

  -- Who sent it: a staff id for a hand-typed reply, null for automated.
  sent_by       UUID,
  campaign_id   UUID,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wa_messages_thread
  ON whatsapp_messages (contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wa_messages_campaign
  ON whatsapp_messages (campaign_id) WHERE campaign_id IS NOT NULL;

-- ── Number health ───────────────────────────────────────────────────────────
--
-- History, not one mutable row. The useful question is "when did this start
-- slipping", and that needs yesterday's value to compare against.

CREATE TABLE IF NOT EXISTS whatsapp_number_health (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  checked_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  quality_rating  TEXT,
  messaging_tier  TEXT,
  number_status   TEXT,
  name_status     TEXT,
  error           TEXT
);

CREATE INDEX IF NOT EXISTS idx_wa_health_recent
  ON whatsapp_number_health (checked_at DESC);

-- ── Template status, synced from Meta ───────────────────────────────────────
--
-- So the send gate can refuse an unapproved template without a Graph round
-- trip in the send path, and the campaign composer can grey out what cannot
-- be sent.

CREATE TABLE IF NOT EXISTS whatsapp_template_status (
  name            TEXT NOT NULL,
  language        TEXT NOT NULL,
  status          TEXT NOT NULL,
  category        TEXT,
  rejected_reason TEXT,
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (name, language)
);

-- ── Campaigns ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS whatsapp_campaigns (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name           TEXT NOT NULL,
  template_name  TEXT NOT NULL,
  segment        JSONB NOT NULL DEFAULT '{}'::jsonb,

  status         TEXT NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','sending','paused','done','halted')),
  -- Why a halt happened, in words. A campaign that stopped itself must say so.
  halt_reason    TEXT,

  -- Required, and low by default. A campaign with no ceiling is the one that
  -- costs the number its rating.
  recipient_cap  INT NOT NULL DEFAULT 50 CHECK (recipient_cap > 0),

  sent_count     INT NOT NULL DEFAULT 0,
  failed_count   INT NOT NULL DEFAULT 0,
  refused_count  INT NOT NULL DEFAULT 0,
  optout_count   INT NOT NULL DEFAULT 0,

  created_by     UUID,
  created_by_email TEXT,
  started_at     TIMESTAMPTZ,
  finished_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Campaign recipients: the queue, and the audit of who got what ───────────
--
-- One row per contact per campaign, unique-indexed. That single constraint is
-- what makes the worker safe to retry: a second attempt at an already-sent row
-- cannot insert, so it cannot double-send.

CREATE TABLE IF NOT EXISTS whatsapp_campaign_recipients (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id   UUID NOT NULL REFERENCES whatsapp_campaigns(id) ON DELETE CASCADE,
  contact_id    UUID NOT NULL REFERENCES whatsapp_contacts(id) ON DELETE CASCADE,
  order_number  TEXT,

  state         TEXT NOT NULL DEFAULT 'queued'
                  CHECK (state IN ('queued','sent','failed','refused')),
  -- Populated for 'refused'. A refusal is a recorded outcome with a reason,
  -- never a silent skip — this column is what makes "why didn't they get it?"
  -- answerable on screen.
  refuse_reason TEXT,
  error         TEXT,
  wamid         TEXT,
  attempts      INT NOT NULL DEFAULT 0,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at  TIMESTAMPTZ,

  UNIQUE (campaign_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_wa_recipients_queue
  ON whatsapp_campaign_recipients (campaign_id, state)
  WHERE state = 'queued';

-- ── Settings: one row, and the kill switch ──────────────────────────────────
--
-- Same single-row shape as checkout_settings. The kill switch is here rather
-- than in an environment variable so it can be flipped in a second from the
-- admin, without a deploy — which is what you want at 11pm when something is
-- going wrong.

CREATE TABLE IF NOT EXISTS whatsapp_settings (
  id                  BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),

  -- The big red button. TRUE stops every outbound message, including order
  -- notifications: if something is wrong enough to hit this, it is wrong
  -- enough to stop everything.
  sending_paused      BOOLEAN NOT NULL DEFAULT FALSE,
  paused_reason       TEXT,
  paused_at           TIMESTAMPTZ,
  paused_by_email     TEXT,

  -- Self-imposed, well under Meta's tier, so order notifications always have
  -- headroom. Campaigns draw only from what transactional sending leaves.
  daily_budget        INT NOT NULL DEFAULT 250 CHECK (daily_budget > 0),
  campaign_daily_cap  INT NOT NULL DEFAULT 100 CHECK (campaign_daily_cap >= 0),

  -- Per contact, campaign messages only. Order notifications are exempt.
  min_days_between_campaigns INT NOT NULL DEFAULT 7,
  max_campaigns_per_30_days  INT NOT NULL DEFAULT 3,

  -- Halt a running campaign at this opt-out rate, as a percentage of messages
  -- sent. Two per hundred is already bad.
  halt_optout_percent NUMERIC(5,2) NOT NULL DEFAULT 2.0,

  -- How long inbound message bodies are kept. The consent record outlives it.
  retain_messages_days INT NOT NULL DEFAULT 365,

  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO whatsapp_settings (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;

-- ── Lock everything down ────────────────────────────────────────────────────
--
-- These tables carry every customer's phone number and the contents of what
-- they wrote to us. The anon key ships to every browser; nothing here may be
-- reachable with it. Same posture as portal_orders.

ALTER TABLE whatsapp_contacts             ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_messages             ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_campaigns            ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_campaign_recipients  ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_number_health        ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_template_status      ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_settings             ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'whatsapp_contacts', 'whatsapp_messages', 'whatsapp_campaigns',
    'whatsapp_campaign_recipients', 'whatsapp_number_health',
    'whatsapp_template_status', 'whatsapp_settings'
  ] LOOP
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO service_role', t);
  END LOOP;
END $$;

-- ── Counting today's sends, for the budget check ────────────────────────────
--
-- A function rather than a view: the gate calls it on every send, and it must
-- read the two places outbound messages are recorded — notification_log for
-- automated events, whatsapp_messages for replies and campaigns.
--
-- An automated send lands in BOTH tables: notification_log is the event ledger
-- that owns idempotency, whatsapp_messages is the conversation the customer
-- sees. Counting both would double every order notification, so the second
-- half counts only CRM-originated rows — a reply has `sent_by`, a campaign
-- message has `campaign_id`, and an automated one has neither.
--
-- 'today' is an IST calendar day. Meta's own limit is a rolling 24 hours,
-- which is stricter in the morning and looser at night; a calendar day is what
-- a person can reason about, and the budget sits far enough under the tier
-- that the difference has no consequence.

CREATE OR REPLACE FUNCTION whatsapp_sent_today()
RETURNS TABLE (total BIGINT, campaign BIGINT)
LANGUAGE sql
STABLE
AS $$
  WITH bounds AS (
    SELECT (date_trunc('day', NOW() AT TIME ZONE 'Asia/Kolkata')
             AT TIME ZONE 'Asia/Kolkata') AS day_start
  )
  SELECT
    (SELECT COUNT(*) FROM notification_log, bounds
       WHERE created_at >= bounds.day_start
         AND status IN ('sent','delivered','read'))
    + (SELECT COUNT(*) FROM whatsapp_messages, bounds
         WHERE created_at >= bounds.day_start
           AND direction = 'out'
           AND (sent_by IS NOT NULL OR campaign_id IS NOT NULL)
           AND status IN ('sent','delivered','read')) AS total,
    (SELECT COUNT(*) FROM whatsapp_messages, bounds
       WHERE created_at >= bounds.day_start
         AND direction = 'out'
         AND campaign_id IS NOT NULL
         AND status IN ('sent','delivered','read')) AS campaign
$$;

NOTIFY pgrst, 'reload schema';

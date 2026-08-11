-- WhatsApp notification log.
--
-- Sending moved out of this app and into a Make.com scenario, which means the
-- one question support actually gets — "did the customer get the message?" —
-- can no longer be answered by grepping Vercel logs. This table answers it.
--
-- It is also the dedupe key. Two things race to confirm a payment (the browser
-- calling /api/orders/verify and the Razorpay webhook) and the atomic
-- pending→paid claim only covers the events that hang off it; a manual re-send
-- or a Make retry is outside that. The UNIQUE constraint on event_id is what
-- makes every send exactly-once regardless of which path got there first:
-- insert first, send only if the insert won.
--
-- Lifecycle of a row:
--   queued   inserted by the app, webhook POSTed to Make
--   sent     Make called /api/notify/callback after the message went out
--   failed   Make's error handler called back, or the webhook POST itself died
--   skipped  no MAKE_WEBHOOK_URL configured (local dev)

CREATE TABLE IF NOT EXISTS notification_log (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,

  -- "<order_number>:<event>", plus a counter where repeats are legitimate
  -- (address reminders) or a timestamp for a deliberate admin re-send.
  event_id TEXT NOT NULL UNIQUE,

  -- Dotted wire name, e.g. 'order.shipped'. Matches the scenario's router.
  event TEXT NOT NULL,

  -- Null for course grants made without an order (admin grant, CSV import).
  order_number TEXT,

  phone TEXT NOT NULL,

  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'sent', 'failed', 'skipped')),

  -- Reported back by Make, so the log says which WhatsApp provider was live at
  -- the time. Changing provider is a Make-side change with no deploy here, and
  -- without this the history becomes ambiguous.
  provider TEXT,
  provider_message_id TEXT,
  error TEXT,

  -- What we actually sent. Contains the customer's phone and address, so this
  -- is PII — see the cleanup note at the bottom. Kept because replaying a
  -- failed message from the exact original payload beats reconstructing it.
  payload JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The order detail screen: every message this customer was sent, newest first.
CREATE INDEX IF NOT EXISTS idx_notification_log_order
  ON notification_log (order_number, created_at DESC);

-- The worklist that matters — anything that never made it out.
CREATE INDEX IF NOT EXISTS idx_notification_log_unfinished
  ON notification_log (created_at DESC)
  WHERE status IN ('queued', 'failed');

-- Make calls back keyed on event_id; keep that lookup cheap. (UNIQUE already
-- creates an index, this is a no-op reminder that the callback depends on it.)

-- Service role only. Nothing here is ever read from the browser — the admin
-- screens go through the server, and the payload column holds phone numbers
-- and delivery addresses.
ALTER TABLE notification_log ENABLE ROW LEVEL SECURITY;

-- Housekeeping: payload is PII and stops being useful once the parcel arrives.
-- Run periodically (Supabase scheduled query) to blank old payloads while
-- keeping the audit trail:
--
--   UPDATE notification_log SET payload = NULL
--   WHERE created_at < NOW() - INTERVAL '90 days' AND payload IS NOT NULL;

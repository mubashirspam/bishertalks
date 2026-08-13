-- Real delivery receipts, now that we send the messages ourselves.
--
-- Under Make.com a notification had two possible endings: 'queued' if the
-- scenario accepted it, or 'sent' if the scenario bothered to call back. Both
-- meant "handed over" — neither meant the customer's phone ever showed it. The
-- question support actually gets is "did they get the message", and the log
-- could not answer it.
--
-- Meta answers it. Every message reports back as it moves:
--
--   sent       Meta accepted it and pushed it toward the handset
--   delivered  it reached the phone
--   read       the customer opened it (unless they've turned receipts off)
--   failed     it will not arrive, with a reason worth reading
--
-- Two of those are new states, so the constraint has to make room. 'queued'
-- stays for the Make path and for the moment between claiming an event and
-- getting a wamid back; 'skipped' stays for local dev with no credentials.

ALTER TABLE notification_log DROP CONSTRAINT IF EXISTS notification_log_status_check;

ALTER TABLE notification_log ADD CONSTRAINT notification_log_status_check
  CHECK (status IN ('queued', 'sent', 'delivered', 'read', 'failed', 'skipped'));

-- Meta's numeric reason for a failure — 131026 "not a WhatsApp user", 132015
-- "template paused", and so on. The text is already in `error`; the code is
-- what you can count, and counting is how you find out that a whole template
-- is being refused rather than one customer having a bad number.
ALTER TABLE notification_log ADD COLUMN IF NOT EXISTS error_code INT;

-- Status callbacks arrive keyed on the message id and nothing else, several
-- times per message. Without this every receipt is a sequential scan of the
-- whole log, and there are four of them for every message we send.
CREATE INDEX IF NOT EXISTS idx_notification_log_message_id
  ON notification_log (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';

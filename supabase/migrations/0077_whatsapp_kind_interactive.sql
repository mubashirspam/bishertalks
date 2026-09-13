-- whatsapp_messages.kind never allowed 'interactive', though
-- sendSessionButtons (lib/crm/send.ts) has recorded automated flow replies
-- with that kind since 0053_crm_automation.sql. recordOutbound swallows a
-- failed insert into a console.error rather than throwing, so this has most
-- likely been failing silently the whole time: the WhatsApp message itself
-- still sent, only the CRM's own log row for it never got written. Past
-- rows can't be recovered — a rejected insert leaves nothing behind — this
-- only fixes it going forward.

-- Found by column rather than assumed by name: an inline CHECK like this
-- one gets Postgres's default `<table>_<column>_check` name, but relying on
-- that guess and getting it wrong would silently leave the old, narrower
-- constraint in place alongside a new one — the insert this migration
-- exists to fix would keep failing, just against a different constraint.
DO $$
DECLARE
  existing text;
BEGIN
  SELECT con.conname INTO existing
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_attribute att
    ON att.attrelid = rel.oid AND att.attnum = ANY(con.conkey)
  WHERE rel.relname = 'whatsapp_messages'
    AND con.contype = 'c'
    AND att.attname = 'kind';

  IF existing IS NOT NULL THEN
    EXECUTE format('ALTER TABLE whatsapp_messages DROP CONSTRAINT %I', existing);
  END IF;
END $$;

ALTER TABLE whatsapp_messages
  ADD CONSTRAINT whatsapp_messages_kind_check
  CHECK (kind IN (
    'text', 'template', 'image', 'audio', 'video', 'document', 'sticker',
    'other', 'interactive'
  ));

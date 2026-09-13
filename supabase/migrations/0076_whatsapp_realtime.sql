-- Realtime for the CRM inbox, via broadcast rather than exposing the table.
--
-- whatsapp_messages stays exactly as locked down as it has always been —
-- service_role only, no policy for anon/authenticated. Turning that on so a
-- browser could subscribe to it directly (Postgres Changes) would be a real
-- change to the table's security posture, and is deliberately not what this
-- does.
--
-- Instead: a trigger announces "this contact's thread changed" down a
-- broadcast channel, and a separate authorization check — on Realtime's own
-- realtime.messages, not on whatsapp_messages — decides who may listen. The
-- browser never queries the table itself; on a broadcast it re-fetches the
-- thread through the existing, permission-checked API route, the same one
-- the 10-second poll already calls. This migration only makes that re-fetch
-- happen sooner — it changes nothing about who can read what.

-- ----------------------------------------------------------------------------
-- Who may listen to a CRM thread's channel.
--
-- Mirrors requirePermission("crm.view") exactly: same table, same columns,
-- same rule — owner short-circuits, everyone else needs the permission and
-- must be active. SECURITY DEFINER because `staff` has RLS enabled with no
-- policy for `authenticated` (see 0007_staff.sql) — this function is the one
-- place allowed to read it on that role's behalf, and only to answer yes/no.
CREATE OR REPLACE FUNCTION public.is_crm_viewer()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM staff
    WHERE auth_user_id = auth.uid()
      AND is_active
      AND (role = 'owner' OR 'crm.view' = ANY(permissions))
  );
$$;

REVOKE ALL ON FUNCTION public.is_crm_viewer() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_crm_viewer() TO authenticated;

-- ----------------------------------------------------------------------------
-- Authorization: who can subscribe to a `crm-thread:<contact_id>` channel.
--
-- Not narrowed to "the contact this staff member is assigned to" — the app
-- itself doesn't gate reading a thread that way today (any crm.view holder
-- can open any conversation), so a tighter rule here would just be a second,
-- inconsistent access model to maintain alongside requirePermission.
-- ----------------------------------------------------------------------------
-- Not `ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY` here: Supabase
-- already has it on for this table and reserves that toggle to itself — a
-- project's own `postgres` role can create policies on it (the supported,
-- documented path for broadcast authorization) but isn't the table's owner,
-- so that ALTER fails with "must be owner of table messages". Policy creation
-- below is the actual mechanism and doesn't need it.
DROP POLICY IF EXISTS "crm staff can receive thread broadcasts" ON realtime.messages;
CREATE POLICY "crm staff can receive thread broadcasts"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  realtime.topic() LIKE 'crm-thread:%'
  AND public.is_crm_viewer()
);

-- ----------------------------------------------------------------------------
-- Broadcast every insert, and every status change, to its contact's channel.
--
-- AFTER, not BEFORE, and wrapped so a broadcast failure can never fail the
-- write it's riding on: this only announces "go re-fetch", it doesn't carry
-- the message itself to the browser, and the 10-second poll is still there
-- as a backstop if a broadcast is ever dropped.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.whatsapp_messages_broadcast()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM realtime.broadcast_changes(
    'crm-thread:' || COALESCE(NEW.contact_id, OLD.contact_id)::text,
    TG_OP,
    TG_OP,
    TG_TABLE_NAME,
    TG_TABLE_SCHEMA,
    NEW,
    OLD
  );
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'whatsapp_messages_broadcast failed: %', SQLERRM;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS whatsapp_messages_broadcast_trigger ON whatsapp_messages;
CREATE TRIGGER whatsapp_messages_broadcast_trigger
AFTER INSERT OR UPDATE OF status ON whatsapp_messages
FOR EACH ROW EXECUTE FUNCTION public.whatsapp_messages_broadcast();

-- ----------------------------------------------------------------------------
-- Apply this by hand (Supabase SQL editor, or however 0001–0075 were
-- applied) and check for two things before relying on it:
--
-- 1. `realtime.broadcast_changes` exists on this project's Realtime
--    extension version. If CREATE FUNCTION above errors on it, the project's
--    Realtime is older than this feature — check Database > Extensions.
-- 2. After applying, open a conversation in two admin sessions and send a
--    reply from one: the other should update well before its next 10-second
--    poll would have fired. If it doesn't update any faster than the poll,
--    the broadcast path isn't reaching the browser (check the browser
--    console for a Realtime auth/subscribe error) — the CRM still works
--    either way, just on the poll alone, which is why this is safe to apply
--    and debug live rather than needing a rollback plan.
-- ----------------------------------------------------------------------------

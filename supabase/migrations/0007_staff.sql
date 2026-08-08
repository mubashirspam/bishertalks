-- Staff accounts, roles and permissions.
--
-- Until now authorisation was one line — `user.email === ADMIN_EMAIL` — which
-- means hiring a delivery agent required handing over the owner's password.
-- This adds real accounts.
--
-- The model: a role is a PRESET, the permissions array is the TRUTH. Choosing
-- "Delivery agent" fills in the usual capabilities; the owner can then tick or
-- untick individual ones for that person. Checks are always against the array,
-- never against the role name — so a hand-tuned account behaves exactly as the
-- screen showed it.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ----------------------------------------------------------------------------
-- STAFF — one row per person who can log into /admin.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS staff (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,

  -- The Supabase Auth account they sign in with. ON DELETE CASCADE so removing
  -- the login removes the access; there is no such thing as a staff row that
  -- can't be traced to an account.
  auth_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,

  email TEXT UNIQUE NOT NULL,
  name  TEXT NOT NULL,
  phone TEXT,

  role TEXT NOT NULL DEFAULT 'support'
    CHECK (role IN ('owner', 'manager', 'delivery', 'support')),

  -- Capability keys from lib/permissions.ts. Kept as text[] rather than a
  -- join table: the list is short, fixed, and read on every admin page load —
  -- a join table would buy nothing but queries.
  permissions TEXT[] NOT NULL DEFAULT '{}',

  -- The on/off switch. Checked live on every request rather than baked into
  -- the session token, so switching someone off takes effect immediately
  -- instead of whenever their JWT happens to expire.
  is_active BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES staff(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_staff_auth_user ON staff (auth_user_id);
CREATE INDEX IF NOT EXISTS idx_staff_email ON staff (lower(email));
CREATE INDEX IF NOT EXISTS idx_staff_active ON staff (is_active) WHERE is_active;

DROP TRIGGER IF EXISTS staff_updated_at ON staff;
CREATE TRIGGER staff_updated_at
  BEFORE UPDATE ON staff
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ----------------------------------------------------------------------------
-- AUDIT LOG — who did what.
--
-- Only worth having once more than one person can change an order, which is
-- exactly what this migration enables. "Who marked this delivered?" has to be
-- answerable before it's ever asked.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,

  actor_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  -- Snapshot of who it was, kept alongside the reference: removing a staff
  -- member must not erase the history of what they did.
  actor_email TEXT,

  action    TEXT NOT NULL,   -- 'order.status', 'labels.printed', 'staff.created'
  entity    TEXT NOT NULL,   -- 'order', 'staff'
  entity_id TEXT,            -- order_number, staff id
  meta      JSONB,           -- action-specific detail: {from, to, count}

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- "History for this order" — the query the order detail page runs.
CREATE INDEX IF NOT EXISTS idx_audit_entity
  ON audit_log (entity, entity_id, created_at DESC);

-- "What happened today" — the query a person asks when something looks wrong.
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log (created_at DESC);

-- ----------------------------------------------------------------------------
-- RLS — deny by default.
--
-- Both tables hold things the anon key must never see: staff email addresses,
-- and a log of everything the business does. Enabling RLS with no policies at
-- all means only the service role (which bypasses RLS) can read or write them
-- — which is exactly how the app talks to these tables.
-- ----------------------------------------------------------------------------
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- Seed the owner from the existing ADMIN_EMAIL account, so the first login
-- after this migration still works and is a real staff row rather than the
-- env-variable fallback.
--
-- Permissions are left empty on purpose: the owner role short-circuits every
-- check in lib/permissions.ts, so listing them here would create a second
-- place to keep in sync.
-- ----------------------------------------------------------------------------
INSERT INTO staff (auth_user_id, email, name, role, is_active)
SELECT u.id, u.email, COALESCE(split_part(u.email, '@', 1), 'Owner'), 'owner', TRUE
FROM auth.users u
WHERE u.email IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM staff s WHERE s.auth_user_id = u.id)
  -- Only the very first account. Any other auth user is added deliberately
  -- through the admin screen, not swept in by a migration.
  AND u.created_at = (SELECT MIN(created_at) FROM auth.users);

-- ============================================================================
-- FULL SETUP — run once in Supabase SQL Editor (or via MCP).
-- Idempotent & safe: only ADDs tables/columns; never drops your 4 orders.
-- = migration 0001 + 0002 + course seed.
-- ============================================================================

-- ============================================================================
-- Migration 0001 — Users, Courses (content in DB), and Course Access
-- Run this in Supabase Dashboard → SQL Editor (after supabase/schema.sql).
-- Safe to re-run (idempotent).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Shared updated_at trigger function (also defined in schema.sql; redefined here
-- so this migration is self-contained).
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- USERS — one row per mobile number. No passwords / no auth; identity = phone.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  phone TEXT UNIQUE NOT NULL,
  name TEXT,
  email TEXT,
  city TEXT,
  state TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at DESC);

DROP TRIGGER IF EXISTS users_updated_at ON users;
CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ----------------------------------------------------------------------------
-- ORDERS — link to users (column added if missing).
-- ----------------------------------------------------------------------------
ALTER TABLE orders ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);

-- ----------------------------------------------------------------------------
-- COURSES / MODULES / LESSONS — course material lives in the DB.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS courses (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  subtitle TEXT,
  description TEXT,
  thumbnail TEXT,
  is_locked BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_courses_slug ON courses(slug);

DROP TRIGGER IF EXISTS courses_updated_at ON courses;
CREATE TRIGGER courses_updated_at
  BEFORE UPDATE ON courses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE IF NOT EXISTS modules (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_modules_course_id ON modules(course_id);

CREATE TABLE IF NOT EXISTS lessons (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  module_id UUID NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('video', 'pdf')),
  url TEXT NOT NULL,
  duration TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lessons_module_id ON lessons(module_id);

-- ----------------------------------------------------------------------------
-- COURSE ACCESS — which user can access which course.
-- granted_via: 'purchase' (paid order) or 'admin' (manual approval).
-- status: 'active' or 'revoked'. One row per (user, course).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS course_access (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  granted_via TEXT NOT NULL DEFAULT 'admin' CHECK (granted_via IN ('purchase', 'admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, course_id)
);
CREATE INDEX IF NOT EXISTS idx_course_access_user_id ON course_access(user_id);
CREATE INDEX IF NOT EXISTS idx_course_access_course_id ON course_access(course_id);

DROP TRIGGER IF EXISTS course_access_updated_at ON course_access;
CREATE TRIGGER course_access_updated_at
  BEFORE UPDATE ON course_access
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ----------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- All app access goes through the service role (server-side), which bypasses
-- RLS. We enable RLS and add NO public policies, so the anon/public key cannot
-- read these tables directly. Course content is served only after a server-side
-- access check.
-- ----------------------------------------------------------------------------
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_access ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access" ON users;
CREATE POLICY "Service role full access" ON users FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access" ON courses;
CREATE POLICY "Service role full access" ON courses FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access" ON modules;
CREATE POLICY "Service role full access" ON modules FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access" ON lessons;
CREATE POLICY "Service role full access" ON lessons FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access" ON course_access;
CREATE POLICY "Service role full access" ON course_access FOR ALL TO service_role USING (true) WITH CHECK (true);

-- The orders table previously had a "Public read by order_number" policy that
-- exposed ALL columns to the anon key. Tighten it: order lookups now go through
-- the server (service role). Drop the permissive public read.
DROP POLICY IF EXISTS "Public read by order_number" ON orders;

-- ============================================================================
-- Migration 0002 — Course pricing + Promo codes
-- Run in Supabase Dashboard → SQL Editor (after 0001). Safe to re-run.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ----------------------------------------------------------------------------
-- COURSES — admin-managed pricing (whole rupees). NULL price means "use the
-- env / default fallback". offer_price is optional (the discounted price shown
-- struck-through and actually charged at checkout).
-- ----------------------------------------------------------------------------
ALTER TABLE courses ADD COLUMN IF NOT EXISTS price INTEGER;        -- ₹, nullable
ALTER TABLE courses ADD COLUMN IF NOT EXISTS offer_price INTEGER;  -- ₹, optional

-- ----------------------------------------------------------------------------
-- ORDERS — record the promo applied and the discount given (in paise).
-- ----------------------------------------------------------------------------
ALTER TABLE orders ADD COLUMN IF NOT EXISTS promo_code TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_paise INTEGER NOT NULL DEFAULT 0;

-- ----------------------------------------------------------------------------
-- PROMO CODES — admin-managed discount codes applied at checkout.
--   discount_type: 'percent' (1–100) or 'flat' (₹ off).
--   is_active:     master on/off switch.
--   expires_at:    optional expiry (NULL = never).
--   usage_limit:   optional max redemptions (NULL = unlimited).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS promo_codes (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  discount_type TEXT NOT NULL CHECK (discount_type IN ('percent', 'flat')),
  discount_value INTEGER NOT NULL CHECK (discount_value > 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at TIMESTAMPTZ,
  usage_limit INTEGER,
  used_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_promo_codes_code ON promo_codes(code);

DROP TRIGGER IF EXISTS promo_codes_updated_at ON promo_codes;
CREATE TRIGGER promo_codes_updated_at
  BEFORE UPDATE ON promo_codes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Atomically increment a promo's redemption count, respecting usage_limit.
-- Returns TRUE if the increment happened, FALSE if the code is exhausted.
CREATE OR REPLACE FUNCTION redeem_promo_code(p_code TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  updated INTEGER;
BEGIN
  UPDATE promo_codes
     SET used_count = used_count + 1
   WHERE code = p_code
     AND is_active = TRUE
     AND (expires_at IS NULL OR expires_at > NOW())
     AND (usage_limit IS NULL OR used_count < usage_limit);
  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated > 0;
END;
$$ LANGUAGE plpgsql;

-- RLS: service-role only (same model as the other app tables).
ALTER TABLE promo_codes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access" ON promo_codes;
CREATE POLICY "Service role full access" ON promo_codes FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================================
-- Seed: courses + modules + lessons (generated from lib/courses-data.ts)
-- Idempotent. Re-runnable. Preserves admin-managed thumbnail/price/offer_price
-- (only set on first insert). Replaces a course's modules + lessons each run.
-- ============================================================================

DO $$
DECLARE cid uuid; mid uuid;
BEGIN
  INSERT INTO courses (slug, title, subtitle, description, thumbnail, is_locked, sort_order)
  VALUES ('nlp', 'Neuro Linguistic Programming', 'NLP Mastery Course', 'Master the art of Neuro Linguistic Programming. Learn how to reprogram your mind, break limiting beliefs, and unlock your full potential through proven NLP techniques and practices.', '/images/courses/nlp-cover.jpg', TRUE, 0)
  ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title, subtitle = EXCLUDED.subtitle, description = EXCLUDED.description, sort_order = EXCLUDED.sort_order
  RETURNING id INTO cid;

  DELETE FROM modules WHERE course_id = cid;

  INSERT INTO modules (course_id, title, sort_order) VALUES (cid, 'Getting Started', 0) RETURNING id INTO mid;
  INSERT INTO lessons (module_id, slug, title, type, url, duration, sort_order) VALUES
    (mid, 'why-this-course', 'Why This Course?', 'video', 'https://youtu.be/uPzbJmG_5yo', NULL, 0),
    (mid, 'define-your-goal', 'Define Your Goal', 'pdf', 'https://drive.google.com/file/d/1s-DZ6iCm4NJsQS5oKmlDYxXs3nf7HveD/view?usp=share_link', NULL, 1);

  INSERT INTO modules (course_id, title, sort_order) VALUES (cid, 'Introduction to NLP', 1) RETURNING id INTO mid;
  INSERT INTO lessons (module_id, slug, title, type, url, duration, sort_order) VALUES
    (mid, 'plan-your-day', 'Plan Your Day', 'pdf', 'https://drive.google.com/file/d/15wlybRhwpGBX3L3_xiTKC1rYErM6ckZY/view?usp=share_link', NULL, 0),
    (mid, 'what-is-nlp', 'What is NLP?', 'video', 'https://youtu.be/re9iNAtwGUQ', NULL, 1),
    (mid, 'how-nlp-works', 'How NLP Works?', 'video', 'https://youtu.be/RWkjloNI2tw', NULL, 2),
    (mid, 'principles-of-nlp', 'Principles of NLP', 'video', 'https://youtu.be/tcAopQeYK88', NULL, 3),
    (mid, 'module-1-notes', 'Module 1 Notes', 'pdf', 'https://drive.google.com/file/d/1aExXLEBtD8_1snAu5CnFFRUU4OboB5H7/view?usp=share_link', NULL, 4);

  INSERT INTO modules (course_id, title, sort_order) VALUES (cid, 'NLP Filters', 2) RETURNING id INTO mid;
  INSERT INTO lessons (module_id, slug, title, type, url, duration, sort_order) VALUES
    (mid, 'nlp-filters-1', 'NLP Filters - Part 1', 'video', 'https://youtu.be/vtlESS8v6vw', NULL, 0),
    (mid, 'nlp-filters-2', 'NLP Filters - Part 2', 'video', 'https://youtu.be/s2iHNuW06uI', NULL, 1),
    (mid, 'e-r-outcome', 'E + R = Outcome', 'video', 'https://youtu.be/TtX7xgYdjIM', NULL, 2);

  INSERT INTO modules (course_id, title, sort_order) VALUES (cid, 'Preferred Representational System', 3) RETURNING id INTO mid;
  INSERT INTO lessons (module_id, slug, title, type, url, duration, sort_order) VALUES
    (mid, 'prs-intro', 'Preferred Representational System', 'video', 'https://youtu.be/zC9IHYpk6qBY0AVz', NULL, 0),
    (mid, 'prs-pdf', 'PRS Worksheet', 'pdf', 'https://drive.google.com/file/d/1DRMJp_0biRntu5JOH7WPlraRRR6clKoB/view?usp=share_link', NULL, 1),
    (mid, 'vakog', 'VAKOG', 'video', 'https://youtu.be/5bIQTUsol2c', NULL, 2),
    (mid, 'vakog-pdf', 'VAKOG Worksheet', 'pdf', 'https://drive.google.com/file/d/1iRN7Nlw7OVgZ3kRyvxOf7t9m_rISk9B-/view?usp=share_link', NULL, 3),
    (mid, 'prs-2', 'Preferred Representational System - Part 2', 'video', 'https://youtu.be/iN8ii-5yIew', NULL, 4);

  INSERT INTO modules (course_id, title, sort_order) VALUES (cid, 'Mental Map & Internal Representation', 4) RETURNING id INTO mid;
  INSERT INTO lessons (module_id, slug, title, type, url, duration, sort_order) VALUES
    (mid, 'mental-map', 'Mental Map', 'video', 'https://youtu.be/HbwvhLCFIMQ', NULL, 0),
    (mid, 'map-is-not-the-territory', 'Map is Not the Territory', 'video', 'https://youtu.be/6sjc8J10IpU', NULL, 1),
    (mid, 'internal-representation', 'Internal Representation', 'video', 'https://youtu.be/Z8xfoTDwRB0', NULL, 2);

  INSERT INTO modules (course_id, title, sort_order) VALUES (cid, 'Modalities & Sub-Modalities', 5) RETURNING id INTO mid;
  INSERT INTO lessons (module_id, slug, title, type, url, duration, sort_order) VALUES
    (mid, 'modalities', 'Modalities', 'video', 'https://youtu.be/4doFG-2xNfk', NULL, 0),
    (mid, 'sub-modalities', 'Sub-Modalities', 'video', 'https://youtu.be/xEMX2ALF2zo', NULL, 1),
    (mid, 'sub-modalities-practices', 'Sub-Modalities Practices', 'video', 'https://youtu.be/Z_aoNz4rV0Q', NULL, 2);

  INSERT INTO modules (course_id, title, sort_order) VALUES (cid, 'Conditioning & Anchoring', 6) RETURNING id INTO mid;
  INSERT INTO lessons (module_id, slug, title, type, url, duration, sort_order) VALUES
    (mid, 'conditioning', 'Conditioning', 'video', 'https://youtu.be/yowzODRqe1U', NULL, 0),
    (mid, 'anchoring', 'Anchoring', 'video', 'https://youtu.be/-T1L5tgchw4', NULL, 1),
    (mid, 'eye-accessing-cue', 'Eye Accessing Cue', 'video', 'https://youtu.be/x0rb3BMv40Q', NULL, 2),
    (mid, 'eye-accessing-cue-pdf', 'Eye Accessing Cue Worksheet', 'pdf', 'https://drive.google.com/file/d/1zvRrFVqxRpGo3P0W-e1iK-t2Lsszm8g2/view?usp=share_link', NULL, 3);

  INSERT INTO modules (course_id, title, sort_order) VALUES (cid, 'Outcome', 7) RETURNING id INTO mid;
  INSERT INTO lessons (module_id, slug, title, type, url, duration, sort_order) VALUES
    (mid, 'outcome-1', 'Outcome - Part 1', 'video', 'https://youtu.be/ENdwnkC8mDQ', NULL, 0),
    (mid, 'outcome-pdf-1', 'Outcome Worksheet 1', 'pdf', 'https://drive.google.com/file/d/1E0Gt5EPcsjGux3UCjCEPisiwJySD21iM/view?usp=share_link', NULL, 1),
    (mid, 'outcome-2', 'Outcome - Part 2', 'video', 'https://youtu.be/a-njxEynTqY', NULL, 2),
    (mid, 'outcome-pdf-2', 'Outcome Worksheet 2', 'pdf', 'https://drive.google.com/file/d/1ySZjofvrkiP16Ev8OgsoWU9kREnDoQXo/view?usp=share_link', NULL, 3),
    (mid, 'outcome-pdf-3', 'Outcome Worksheet 3', 'pdf', 'https://drive.google.com/file/d/11iuby_MhUc8s8LEAkQ2KIHDBfX6CSO-M/view?usp=share_link', NULL, 4);

  INSERT INTO modules (course_id, title, sort_order) VALUES (cid, 'Belief System', 8) RETURNING id INTO mid;
  INSERT INTO lessons (module_id, slug, title, type, url, duration, sort_order) VALUES
    (mid, 'self-love-pdf', 'Self Love Worksheet', 'pdf', 'https://drive.google.com/file/d/1reuOHCR4W_mwwr_1mRQ8Hxhmbk2KoyZ5/view?usp=share_link', NULL, 0),
    (mid, 'self-belief', 'Self Belief', 'video', 'https://youtu.be/_mal0_lfoQA', NULL, 1),
    (mid, 'belief-system-pdf', 'Belief System Worksheet', 'pdf', 'https://drive.google.com/file/d/1MQe52uj1K0qWipIKuLl3VHjK-uOSG7ZV/view?usp=share_link', NULL, 2),
    (mid, 'limiting-belief', 'Limiting Belief', 'video', 'https://youtu.be/EAM3v7APQ9I', NULL, 3),
    (mid, 'limiting-belief-pdf', 'Limiting Belief Worksheet', 'pdf', 'https://drive.google.com/file/d/1-KK4Gr9GWzAx9kg75w28o31aOkRixsQH/view?usp=share_link', NULL, 4),
    (mid, 'empowering-belief', 'Empowering Belief', 'video', 'https://youtu.be/mGxMNo69ers', NULL, 5),
    (mid, 'empowering-belief-pdf', 'Empowering Belief Worksheet', 'pdf', 'https://drive.google.com/file/d/1U4hwg9iezsXWanIp3gUfvu08uDZEMnDz/view?usp=share_link', NULL, 6);

  INSERT INTO modules (course_id, title, sort_order) VALUES (cid, 'Reframe', 9) RETURNING id INTO mid;
  INSERT INTO lessons (module_id, slug, title, type, url, duration, sort_order) VALUES
    (mid, 'reframe-1', 'Reframe - Part 1', 'video', 'https://youtu.be/2_30C40oLVY', NULL, 0),
    (mid, 'reframe-2', 'Reframe - Part 2', 'video', 'https://youtu.be/9Ly-rAYw_68', NULL, 1),
    (mid, 'reframe-3', 'Reframe - Part 3', 'video', 'https://youtu.be/gjdlhN74GKs', NULL, 2),
    (mid, 'reframe-pdf', 'Reframe Notes', 'pdf', 'https://docs.google.com/document/d/1-VKG25yd094beRYHPvgbVBcvjKuzD9nS/edit?usp=share_link&ouid=101120288452301067414&rtpof=true&sd=true', NULL, 3),
    (mid, 'reframe-4', 'Reframe - Part 4', 'video', 'https://youtu.be/9O2jdO597OQ', NULL, 4),
    (mid, 'self-talk-pdf', 'Self Talk Worksheet', 'pdf', 'https://drive.google.com/file/d/1H_mNywzNLyfWLglIoAZfPlwvwUvxe7zs/view?usp=share_link', NULL, 5);

  INSERT INTO modules (course_id, title, sort_order) VALUES (cid, 'Programming & Awareness', 10) RETURNING id INTO mid;
  INSERT INTO lessons (module_id, slug, title, type, url, duration, sort_order) VALUES
    (mid, 'programming', 'Programming', 'video', 'https://youtu.be/ZE4oS8nxM_Y', NULL, 0),
    (mid, 'awareness', 'Awareness', 'video', 'https://youtu.be/_ot4AdzKQbY', NULL, 1),
    (mid, 'mindfulness', 'Mindfulness', 'video', 'https://youtu.be/kWiiyMGpjx0', NULL, 2);

  INSERT INTO modules (course_id, title, sort_order) VALUES (cid, 'Purification & Gratitude', 11) RETURNING id INTO mid;
  INSERT INTO lessons (module_id, slug, title, type, url, duration, sort_order) VALUES
    (mid, 'purification', 'Purification', 'video', 'https://youtu.be/xzsd5oLIjW4', NULL, 0),
    (mid, 'forgiveness', 'Forgiveness', 'video', 'https://youtu.be/BGIJeyUVUdg', NULL, 1),
    (mid, 'gratitude', 'Gratitude', 'video', 'https://youtu.be/1X5DUukahd8', NULL, 2),
    (mid, 'attitude-of-gratitude', 'Attitude of Gratitude', 'video', 'https://youtu.be/uRpyXJXmsto', NULL, 3),
    (mid, 'problem-solving-pdf', 'Problem Solving Notes', 'pdf', 'https://docs.google.com/document/d/19V9YZm0BjQyFQ2XyS1h97mIdvthOzidK/edit?usp=share_link&ouid=101120288452301067414&rtpof=true&sd=true', NULL, 4);

  INSERT INTO modules (course_id, title, sort_order) VALUES (cid, 'Installation & Habits', 12) RETURNING id INTO mid;
  INSERT INTO lessons (module_id, slug, title, type, url, duration, sort_order) VALUES
    (mid, 'installation', 'Installation', 'video', 'https://youtu.be/bAt6FsT2QUA', NULL, 0),
    (mid, 'affirmation', 'Affirmation', 'video', 'https://youtu.be/0qiBw45POe4', NULL, 1),
    (mid, 'visualisation', 'Visualisation', 'video', 'https://youtu.be/6pbud-oy5AI', NULL, 2),
    (mid, 'habitualisation', 'Habitualisation', 'video', 'https://youtu.be/NGdg-b4TYx4', NULL, 3),
    (mid, 'habits-pdf', 'Habits Worksheet', 'pdf', 'https://drive.google.com/file/d/14dry4i4pdao0TXngO9fe8xiLMmG-h6It/view?usp=share_link', NULL, 4);

  INSERT INTO modules (course_id, title, sort_order) VALUES (cid, 'Modelling & Learning', 13) RETURNING id INTO mid;
  INSERT INTO lessons (module_id, slug, title, type, url, duration, sort_order) VALUES
    (mid, 'modelling-1', 'Modelling - Part 1', 'video', 'https://youtu.be/CkEnQwM2K2E', NULL, 0),
    (mid, 'modelling-2', 'Modelling - Part 2', 'video', 'https://youtu.be/PoWbjBkzPjA', NULL, 1),
    (mid, 'modelling-pdf', 'Modelling Worksheet', 'pdf', 'https://drive.google.com/file/d/1gLvNcMzhpDxxN_qUHcLpBc2LA4lWnUaZ/view?usp=share_link', NULL, 2),
    (mid, 'learning-steps', 'Learning Steps', 'video', 'https://youtu.be/OZalBWxOHV4', NULL, 3);

END $$;


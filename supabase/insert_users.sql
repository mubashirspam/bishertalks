-- ============================================================================
-- Bulk add users by phone (normalized to bare 10-digit, matching the app).
-- Idempotent: existing phones are skipped.
-- Run in Supabase → SQL Editor.
-- ============================================================================

INSERT INTO users (phone) VALUES
  ('9446607071'),
  ('9544014582'),
  ('9447300188'),
  ('7306395959'),  -- +91 73063 95959
  ('9846413939'),
  ('8086999176'),
  ('9645831715'),  -- +919645831715
  ('7736164054'),
  ('9037702712'),  -- +91 90377 02712
  ('9846696900')
ON CONFLICT (phone) DO NOTHING;

-- ----------------------------------------------------------------------------
-- OPTIONAL: also grant these numbers access to the NLP course (so they can
-- unlock it immediately). Remove the comment markers to run.
-- ----------------------------------------------------------------------------
-- INSERT INTO course_access (user_id, course_id, granted_via, status)
-- SELECT u.id, c.id, 'admin', 'active'
-- FROM users u
-- CROSS JOIN courses c
-- WHERE c.slug = 'nlp'
--   AND u.phone IN (
--     '9446607071','9544014582','9447300188','7306395959','9846413939',
--     '8086999176','9645831715','7736164054','9037702712','9846696900'
--   )
-- ON CONFLICT (user_id, course_id) DO UPDATE SET status = 'active', granted_via = 'admin';

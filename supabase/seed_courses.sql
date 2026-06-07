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


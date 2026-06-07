import { courses } from "../lib/courses-data.ts";
import { writeFileSync } from "node:fs";

const q = (v: string | null | undefined) =>
  v == null ? "NULL" : `'${v.replace(/'/g, "''")}'`;

let sql = `-- ============================================================================
-- Seed: courses + modules + lessons (generated from lib/courses-data.ts)
-- Idempotent. Re-runnable. Preserves admin-managed thumbnail/price/offer_price
-- (only set on first insert). Replaces a course's modules + lessons each run.
-- ============================================================================

`;

courses.forEach((course, ci) => {
  sql += `DO $$\nDECLARE cid uuid; mid uuid;\nBEGIN\n`;
  sql += `  INSERT INTO courses (slug, title, subtitle, description, thumbnail, is_locked, sort_order)\n`;
  sql += `  VALUES (${q(course.slug)}, ${q(course.title)}, ${q(course.subtitle)}, ${q(course.description)}, ${q(course.thumbnail)}, TRUE, ${ci})\n`;
  sql += `  ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title, subtitle = EXCLUDED.subtitle, description = EXCLUDED.description, sort_order = EXCLUDED.sort_order\n`;
  sql += `  RETURNING id INTO cid;\n\n`;
  sql += `  DELETE FROM modules WHERE course_id = cid;\n\n`;

  course.modules.forEach((mod, mi) => {
    sql += `  INSERT INTO modules (course_id, title, sort_order) VALUES (cid, ${q(mod.title)}, ${mi}) RETURNING id INTO mid;\n`;
    if (mod.lessons.length) {
      const values = mod.lessons
        .map(
          (l, li) =>
            `    (mid, ${q(l.slug)}, ${q(l.title)}, ${q(l.type)}, ${q(l.url)}, ${q(l.duration ?? null)}, ${li})`
        )
        .join(",\n");
      sql += `  INSERT INTO lessons (module_id, slug, title, type, url, duration, sort_order) VALUES\n${values};\n`;
    }
    sql += `\n`;
  });

  sql += `END $$;\n\n`;
});

writeFileSync(new URL("../supabase/seed_courses.sql", import.meta.url), sql);
console.log("Wrote supabase/seed_courses.sql");
console.log(
  `Courses: ${courses.length}, modules: ${courses.reduce((a, c) => a + c.modules.length, 0)}, lessons: ${courses.reduce((a, c) => a + c.modules.reduce((b, m) => b + m.lessons.length, 0), 0)}`
);

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { normalizePhone, isValidPhone, getUserByPhone, upsertUserByPhone } from "@/lib/db/users";
import { grantCourseAccess } from "@/lib/db/access";

interface ImportRow {
  name?: string;
  email?: string;
  phone?: string;
}

interface RowResult {
  row: number;
  phone: string;
  name: string;
  status: "created" | "updated" | "skipped";
  reason?: string;
}

// POST { rows: ImportRow[], courseSlug?: string } — bulk-register users from a
// CSV the admin parsed in the browser, optionally granting one course to all.
export async function POST(request: NextRequest) {
  const auth = await requirePermission("users.manage");
  if (!auth.ok) return auth.response;

  const { rows, courseSlug } = (await request.json()) as {
    rows?: ImportRow[];
    courseSlug?: string;
  };

  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "No rows to import." }, { status: 400 });
  }

  // Resolve the course once (if access is being granted).
  let courseId: string | null = null;
  if (courseSlug) {
    const { data: course } = await supabaseAdmin
      .from("courses")
      .select("id")
      .eq("slug", courseSlug)
      .maybeSingle();
    if (!course) {
      return NextResponse.json(
        { error: `Course "${courseSlug}" not found.` },
        { status: 400 }
      );
    }
    courseId = course.id;
  }

  const results: RowResult[] = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let granted = 0;

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const phone = normalizePhone(raw.phone || "");
    const name = (raw.name || "").trim();
    const email = (raw.email || "").trim();

    if (!isValidPhone(phone)) {
      skipped++;
      results.push({
        row: i + 1,
        phone: raw.phone || "",
        name,
        status: "skipped",
        reason: "Invalid phone number",
      });
      continue;
    }

    try {
      const existing = await getUserByPhone(phone);
      const user = await upsertUserByPhone({ phone, name, email });

      if (existing) updated++;
      else created++;

      if (courseId) {
        await grantCourseAccess({
          userId: user.id,
          courseId,
          grantedVia: "admin",
        });
        granted++;
      }

      results.push({
        row: i + 1,
        phone,
        name,
        status: existing ? "updated" : "created",
      });
    } catch (err) {
      console.error(`[/api/admin/users/import] Row ${i + 1} failed:`, err);
      skipped++;
      results.push({
        row: i + 1,
        phone,
        name,
        status: "skipped",
        reason: "Database error",
      });
    }
  }

  return NextResponse.json({
    success: true,
    summary: { total: rows.length, created, updated, skipped, granted },
    results,
  });
}

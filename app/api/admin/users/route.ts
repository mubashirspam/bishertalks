export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { upsertUserByPhone, normalizePhone, isValidPhone } from "@/lib/db/users";
import { grantCourseAccessByPhone } from "@/lib/db/access";
import { BOOK_BONUS_COURSE_SLUG } from "@/lib/types/db";

// POST { phone, name?, email?, grantNlp? } — admin adds a user (and optionally
// grants NLP course access in the same step).
export async function POST(request: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { phone: rawPhone, name, email, grantNlp } = await request.json();
  const phone = normalizePhone(rawPhone || "");

  if (!isValidPhone(phone)) {
    return NextResponse.json(
      { error: "Enter a valid 10-digit mobile number." },
      { status: 400 }
    );
  }

  try {
    const user = await upsertUserByPhone({ phone, name, email });

    if (grantNlp) {
      await grantCourseAccessByPhone({
        phone,
        courseSlug: BOOK_BONUS_COURSE_SLUG,
        grantedVia: "admin",
      });
    }

    return NextResponse.json({ success: true, user });
  } catch (err) {
    console.error("[/api/admin/users] Error:", err);
    return NextResponse.json(
      { error: "Failed to add user." },
      { status: 500 }
    );
  }
}

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { grantCourseAccess, revokeCourseAccess } from "@/lib/db/access";

// POST { userId, courseId, action: 'grant' | 'revoke' } — admin grants or
// revokes a user's access to a course.
export async function POST(request: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { userId, courseId, action } = await request.json();

  if (!userId || !courseId || !["grant", "revoke"].includes(action)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    if (action === "grant") {
      await grantCourseAccess({ userId, courseId, grantedVia: "admin" });
    } else {
      await revokeCourseAccess({ userId, courseId });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[/api/admin/access] Error:", err);
    return NextResponse.json({ error: "Failed to update access." }, { status: 500 });
  }
}

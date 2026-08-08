export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-auth";
import { grantCourseAccess, revokeCourseAccess } from "@/lib/db/access";

// POST { userId, courseId, action: 'grant' | 'revoke' } — admin grants or
// revokes a user's access to a course.
export async function POST(request: NextRequest) {
  const auth = await requirePermission("users.manage");
  if (!auth.ok) return auth.response;

  const { userId, courseId, action } = await request.json();

  if (!userId || !courseId || !["grant", "revoke"].includes(action)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    if (action === "grant") {
      await grantCourseAccess({ userId, courseId, grantedVia: "admin", notify: true });
    } else {
      await revokeCourseAccess({ userId, courseId });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[/api/admin/access] Error:", err);
    return NextResponse.json({ error: "Failed to update access." }, { status: 500 });
  }
}

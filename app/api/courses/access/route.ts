export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { hasCourseAccessByPhone } from "@/lib/db/access";
import { normalizePhone, isValidPhone } from "@/lib/db/users";
import {
  ACCESS_COOKIE,
  ACCESS_COOKIE_MAX_AGE,
  signAccessToken,
} from "@/lib/access-cookie";

// POST { phone, slug } — verify the phone is approved for the course.
// On success, sets a signed httpOnly cookie remembering the number (~30 days).
export async function POST(request: NextRequest) {
  try {
    const { phone: rawPhone, slug } = await request.json();
    const phone = normalizePhone(rawPhone || "");

    if (!isValidPhone(phone)) {
      return NextResponse.json(
        { success: false, error: "Enter a valid 10-digit mobile number." },
        { status: 400 }
      );
    }
    if (!slug) {
      return NextResponse.json(
        { success: false, error: "Missing course." },
        { status: 400 }
      );
    }

    const hasAccess = await hasCourseAccessByPhone(phone, slug);

    if (!hasAccess) {
      return NextResponse.json(
        {
          success: false,
          error:
            "No access found for this number. Purchase the book or ask the admin to approve your number.",
        },
        { status: 403 }
      );
    }

    const res = NextResponse.json({ success: true });
    res.cookies.set(ACCESS_COOKIE, signAccessToken(phone), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: ACCESS_COOKIE_MAX_AGE,
    });
    return res;
  } catch (err) {
    console.error("[/api/courses/access] Error:", err);
    return NextResponse.json(
      { success: false, error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}

// DELETE — clear the remembered number (e.g. "use a different number").
export async function DELETE() {
  const res = NextResponse.json({ success: true });
  res.cookies.set(ACCESS_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}

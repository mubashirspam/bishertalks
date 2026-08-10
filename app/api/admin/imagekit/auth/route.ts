export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-auth";
import { createUploadAuth } from "@/lib/imagekit";

/**
 * Hands the browser a short-lived ImageKit upload signature.
 *
 * The file itself goes straight from the browser to ImageKit and never passes
 * through this app — a phone video would exceed a serverless function's
 * request body limit long before it arrived.
 *
 * Admin-gated: without this check, an open signature endpoint lets anyone on
 * the internet fill the media library at the account owner's expense.
 */
export async function GET() {
  const auth = await requirePermission("landing.manage");
  if (!auth.ok) return auth.response;

  const credentials = createUploadAuth();
  if (!credentials) {
    return NextResponse.json(
      { error: "ImageKit is not configured — set IMAGEKIT_PRIVATE_KEY and NEXT_PUBLIC_IMAGEKIT_PUBLIC_KEY." },
      { status: 503 }
    );
  }

  return NextResponse.json(credentials);
}

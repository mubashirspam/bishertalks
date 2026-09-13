export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-auth";
import { listThread } from "@/lib/crm/messages";
import { toMessageView } from "@/lib/crm/thread-view";

/**
 * One older page of a conversation, for "load older" in the thread view.
 *
 * Split from GET /api/admin/crm/thread/[id] on purpose: that route builds the
 * whole conversation — contact, orders, quick replies, permissions — and
 * re-running all of that on every scroll-up would cost as much as opening the
 * conversation fresh. Scrolling back only ever needs more rows.
 *
 * `before`/`beforeId` together are the (created_at, id) cursor listThread
 * expects — see its comment for why both are required rather than just the
 * timestamp. Either missing means "from the top", which never happens from
 * the client but keeps this route safe to call by hand.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePermission("crm.view");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const sp = request.nextUrl.searchParams;
  const before = sp.get("before");
  const beforeId = sp.get("beforeId");

  const page = await listThread(id, {
    before: before && beforeId ? { createdAt: before, id: beforeId } : undefined,
  });

  return NextResponse.json({
    messages: page.messages.map(toMessageView),
    hasMore: page.hasMore,
    oldest: page.oldest,
  });
}

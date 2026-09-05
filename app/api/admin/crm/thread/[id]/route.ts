export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-auth";
import { can } from "@/lib/permissions";
import { buildThreadView } from "@/lib/crm/thread-view";
import { markRead } from "@/lib/crm/messages";

/**
 * One conversation, as JSON.
 *
 * This is what makes the inbox behave like a messaging app instead of a
 * website. Clicking somebody used to be a navigation to /admin/crm/[id], which
 * re-ran a server page with five awaits in it — so every click, and every sent
 * message, blanked the screen and rebuilt the whole thing including the list
 * you had just clicked in.
 *
 * Fetching the thread on its own leaves the list alone. The page never
 * navigates, so the list keeps its scroll position, its filter and its search,
 * and only the right-hand pane changes.
 *
 * `?read=1` marks the conversation read as it is opened — which is what
 * opening a conversation means. It is a parameter rather than automatic
 * because the poller re-fetches the open thread every few seconds, and a poll
 * is not a person looking.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePermission("crm.view");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const view = await buildThreadView(id);

  if (!view) {
    return NextResponse.json({ error: "No such contact" }, { status: 404 });
  }

  if (request.nextUrl.searchParams.get("read") === "1") {
    await markRead(id);
  }

  return NextResponse.json({
    ...view,
    canReply: can(auth.staff, "crm.reply"),
    canConsent: can(auth.staff, "crm.consent"),
  });
}

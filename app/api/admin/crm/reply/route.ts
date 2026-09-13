export const dynamic = "force-dynamic";

import { NextRequest, NextResponse, after } from "next/server";
import { requirePermission } from "@/lib/admin-auth";
import { getContact } from "@/lib/crm/contacts";
import { queueReply, deliverQueuedReply } from "@/lib/crm/send";
import { markRead } from "@/lib/crm/messages";

/**
 * One hand-typed reply, inside the 24-hour window.
 *
 * The gate checks the window rather than letting Meta answer 131047, so a
 * refusal comes back as "they last wrote more than 24 hours ago — send a
 * template instead" and the screen can offer the template picker rather than
 * showing an error code to somebody who cannot act on it.
 *
 * The actual Graph API call is not awaited here. queueReply runs the gate and
 * writes the row as 'queued' — that's what this response waits on — and
 * `after()` runs the real send once the response has gone out. Meta's round
 * trip (real network latency to another company's API) no longer sits between
 * clicking Send and the box clearing.
 */
export async function POST(request: NextRequest) {
  const auth = await requirePermission("crm.reply");
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({}));
  const contactId = typeof body.contact_id === "string" ? body.contact_id : "";
  const text = typeof body.body === "string" ? body.body.trim() : "";

  if (!contactId) {
    return NextResponse.json({ error: "Missing contact_id" }, { status: 400 });
  }
  if (!text) {
    return NextResponse.json({ error: "Write something first." }, { status: 400 });
  }
  if (text.length > 4000) {
    return NextResponse.json(
      { error: "That's longer than WhatsApp allows in one message." },
      { status: 400 }
    );
  }

  const contact = await getContact(contactId);
  if (!contact) {
    return NextResponse.json({ error: "No such contact" }, { status: 404 });
  }

  const outcome = await queueReply({ contact, body: text, sentBy: auth.staff.id });

  if (!outcome.ok) {
    // 409 for a refusal, not 400: nothing about the request was malformed, the
    // system declined to send it. The screen tells them the two apart.
    if (outcome.refused) {
      return NextResponse.json(
        { error: outcome.reason, refused: true, code: outcome.code },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: outcome.error }, { status: 502 });
  }

  after(() => deliverQueuedReply(outcome.messageId, contact, text));

  // Answering a conversation is the same gesture as reading it.
  await markRead(contactId);

  return NextResponse.json({ ok: true, messageId: outcome.messageId, queued: true });
}

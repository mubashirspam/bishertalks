export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse, after } from "next/server";
import { requirePermission } from "@/lib/admin-auth";
import { getContact } from "@/lib/crm/contacts";
import { queueMediaReply, deliverQueuedMediaReply } from "@/lib/crm/send";
import { markRead } from "@/lib/crm/messages";
import type { OutboundMediaKind } from "@/lib/whatsapp";

/**
 * One hand-attached photo, voice note, video or document, inside the 24-hour
 * window — the media sibling of /api/admin/crm/reply.
 *
 * Same shape as the text route: queueMediaReply runs the gate and writes the
 * row, that's what this response waits on, and `after()` does the slow part
 * — uploading the actual bytes to Meta, then sending — once the response has
 * already gone back to whoever clicked Send.
 *
 * Limits below are Meta's own (Cloud API media send limits), checked here so
 * a file that Meta would refuse anyway doesn't spend an upload round trip
 * first. A hosting platform's own request-body limit is a separate matter
 * this route can't see or enforce — the caller finds out from a failed
 * fetch, not a message from this code.
 */
const MAX_BYTES: Record<OutboundMediaKind, number> = {
  image: 5 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
  video: 16 * 1024 * 1024,
  document: 100 * 1024 * 1024,
};

// Meta's accepted formats for image/audio/video. Documents aren't
// hand-restricted — Meta accepts a wide, changing list and rejects
// unsupported ones itself.
const ALLOWED_MIME: Partial<Record<OutboundMediaKind, string[]>> = {
  image: ["image/jpeg", "image/png", "image/webp"],
  audio: ["audio/aac", "audio/mp4", "audio/mpeg", "audio/amr", "audio/ogg"],
  video: ["video/mp4", "video/3gpp"],
};

function kindFromMime(mime: string): OutboundMediaKind | null {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime) return "document";
  return null;
}

export async function POST(request: NextRequest) {
  const auth = await requirePermission("crm.reply");
  if (!auth.ok) return auth.response;

  const form = await request.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "Malformed upload" }, { status: 400 });
  }

  const contactId = form.get("contact_id");
  const file = form.get("file");
  const captionRaw = form.get("caption");
  const caption = typeof captionRaw === "string" && captionRaw.trim() ? captionRaw.trim() : null;

  if (typeof contactId !== "string" || !contactId) {
    return NextResponse.json({ error: "Missing contact_id" }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file attached" }, { status: 400 });
  }

  const kind = kindFromMime(file.type);
  if (!kind) {
    return NextResponse.json({ error: "Unrecognised file type" }, { status: 400 });
  }
  const allowed = ALLOWED_MIME[kind];
  if (allowed && !allowed.includes(file.type)) {
    return NextResponse.json(
      { error: `WhatsApp can't send a ${kind} in that format (${file.type}).` },
      { status: 400 }
    );
  }
  if (file.size > MAX_BYTES[kind]) {
    return NextResponse.json(
      {
        error: `That ${kind} is too large — WhatsApp's limit is ${Math.round(
          MAX_BYTES[kind] / (1024 * 1024)
        )}MB.`,
      },
      { status: 400 }
    );
  }

  const contact = await getContact(contactId);
  if (!contact) {
    return NextResponse.json({ error: "No such contact" }, { status: 404 });
  }

  const outcome = await queueMediaReply({ contact, kind, caption, sentBy: auth.staff.id });

  if (!outcome.ok) {
    if (outcome.refused) {
      return NextResponse.json(
        { error: outcome.reason, refused: true, code: outcome.code },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: outcome.error }, { status: 502 });
  }

  // Read the bytes now, before the response goes out — after() runs on a
  // closure, not on the still-open request.
  const buffer = Buffer.from(await file.arrayBuffer());

  after(() =>
    deliverQueuedMediaReply(
      outcome.messageId,
      contact,
      { buffer, mimeType: file.type, filename: file.name || kind },
      kind,
      caption
    )
  );

  await markRead(contactId);

  return NextResponse.json({ ok: true, messageId: outcome.messageId, queued: true });
}

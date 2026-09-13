import {
  sendTemplate,
  sendText,
  sendInteractive,
  sendMedia,
  uploadMedia,
  type ReplyButton,
  type OutboundMediaKind,
} from "@/lib/whatsapp";
import { assertSendable, type SendKind, type RefusalCode } from "@/lib/crm/gate";
import { recordOutbound, finalizeOutbound } from "@/lib/crm/messages";
import { noteDeliveryFailure } from "@/lib/crm/consent";
import type { Contact } from "@/lib/crm/contacts";
import type { TemplateCategory } from "@/lib/whatsapp-templates";

/**
 * The only supported way to send a WhatsApp message.
 *
 * Two functions, one contract: check the gate, send, record the result, and
 * never throw. The raw wire calls in lib/whatsapp.ts are reachable from here
 * and from nowhere else — eslint.config.mjs enforces that with
 * `no-restricted-imports`, so a caller that goes around the gate fails the
 * build rather than quietly messaging someone who asked us to stop.
 *
 * Callers get a discriminated result rather than a boolean, because "refused
 * because they opted out" and "failed because Meta was down" need different
 * handling and a boolean loses the difference.
 */

export type SendOutcome =
  | { ok: true; wamid: string | null }
  | { ok: false; refused: true; code: RefusalCode; reason: string }
  | { ok: false; refused: false; error: string; code?: number; retryable: boolean };

export interface TemplateMessage {
  contact: Contact;
  kind: SendKind;
  template: { name: string; category: TemplateCategory; language: string };
  params: string[];
  /** One per URL button carrying a variable, in button order. */
  buttonParams?: string[];
  /** The filled-in text, stored so the thread shows what the customer read. */
  preview?: string;
  sentBy?: string | null;
  campaignId?: string | null;
}

export async function sendTemplateMessage(msg: TemplateMessage): Promise<SendOutcome> {
  const verdict = await assertSendable({
    contact: msg.contact,
    kind: msg.kind,
    template: { name: msg.template.name, category: msg.template.category },
  });

  if (!verdict.allow) {
    // A refusal is an outcome, not an absence. Recording it is what makes
    // "why didn't this customer get the message?" answerable on screen.
    await recordOutbound({
      contactId: msg.contact.id,
      kind: "template",
      body: msg.preview ?? null,
      templateName: msg.template.name,
      status: "failed",
      error: `Refused: ${verdict.reason}`,
      sentBy: msg.sentBy ?? null,
      campaignId: msg.campaignId ?? null,
    });
    return { ok: false, refused: true, code: verdict.code, reason: verdict.reason };
  }

  const result = await sendTemplate({
    to: msg.contact.phone,
    template: msg.template.name,
    language: msg.template.language,
    params: msg.params,
    buttonParams: msg.buttonParams,
  });

  await recordOutbound({
    contactId: msg.contact.id,
    wamid: result.ok ? result.messageId ?? null : null,
    kind: "template",
    body: msg.preview ?? null,
    templateName: msg.template.name,
    status: result.ok ? "sent" : "failed",
    error: result.ok ? null : result.error,
    errorCode: result.ok ? null : result.code ?? null,
    sentBy: msg.sentBy ?? null,
    campaignId: msg.campaignId ?? null,
  });

  if (!result.ok) {
    await noteDeliveryFailure(msg.contact.id, result.code);
    return {
      ok: false,
      refused: false,
      error: result.error ?? "Send failed",
      code: result.code,
      retryable: result.retryable ?? false,
    };
  }

  return { ok: true, wamid: result.messageId ?? null };
}

/**
 * A hand-typed reply, inside the 24-hour window.
 *
 * The gate checks the window itself rather than letting Meta answer 131047,
 * so the person typing gets "they last wrote 26 hours ago — send a template
 * instead" rather than an error code.
 */
export async function sendReply(msg: {
  contact: Contact;
  body: string;
  /**
   * Null for the ADMIN_EMAIL fallback owner, who has no staff row. The
   * message is still attributed — the audit log carries the email — and a
   * cast here would only move the problem to whoever reads the column.
   */
  sentBy: string | null;
}): Promise<SendOutcome> {
  const verdict = await assertSendable({
    contact: msg.contact,
    kind: "reply",
    freeText: true,
  });

  if (!verdict.allow) {
    return { ok: false, refused: true, code: verdict.code, reason: verdict.reason };
  }

  const result = await sendText({ to: msg.contact.phone, body: msg.body });

  await recordOutbound({
    contactId: msg.contact.id,
    wamid: result.ok ? result.messageId ?? null : null,
    kind: "text",
    body: msg.body,
    status: result.ok ? "sent" : "failed",
    error: result.ok ? null : result.error,
    errorCode: result.ok ? null : result.code ?? null,
    sentBy: msg.sentBy,
  });

  if (!result.ok) {
    return {
      ok: false,
      refused: false,
      error: result.error ?? "Send failed",
      code: result.code,
      retryable: result.retryable ?? false,
    };
  }
  return { ok: true, wamid: result.messageId ?? null };
}

export type QueueOutcome =
  | { ok: true; messageId: string }
  | { ok: false; refused: true; code: RefusalCode; reason: string }
  | { ok: false; refused: false; error: string };

/**
 * Queue a hand-typed reply and return immediately.
 *
 * Used only by the interactive reply route — the person sending it is
 * looking at the screen waiting for the box to clear, and the Graph API
 * round trip (the slow part, seconds sometimes) is the one thing here that
 * doesn't need to finish before they get their screen back.
 *
 * Everything that can be decided synchronously still is: the gate runs here,
 * so a refusal (window closed, opted out) is reported before anything is
 * written, exactly as sendReply does it. What's deferred is only the actual
 * send — the row lands as 'queued' immediately, and deliverQueuedReply
 * finishes the job after this returns.
 *
 * Automated sends (sendSessionText below, flows, campaigns) stay on the
 * synchronous sendReply — nothing is watching a screen there, and
 * noteDeliveryFailure needs the real Meta result the moment it happens, not
 * queued for later.
 */
export async function queueReply(msg: {
  contact: Contact;
  body: string;
  sentBy: string | null;
}): Promise<QueueOutcome> {
  const verdict = await assertSendable({
    contact: msg.contact,
    kind: "reply",
    freeText: true,
  });

  if (!verdict.allow) {
    return { ok: false, refused: true, code: verdict.code, reason: verdict.reason };
  }

  const messageId = await recordOutbound({
    contactId: msg.contact.id,
    kind: "text",
    body: msg.body,
    status: "queued",
    sentBy: msg.sentBy,
  });

  if (!messageId) {
    return { ok: false, refused: false, error: "Could not save the message." };
  }
  return { ok: true, messageId };
}

/** Finishes what queueReply started: the real send, then settle the row. */
export async function deliverQueuedReply(
  messageId: string,
  contact: Contact,
  body: string
): Promise<void> {
  const result = await sendText({ to: contact.phone, body });
  await finalizeOutbound(
    messageId,
    contact.id,
    result.ok
      ? { ok: true, wamid: result.messageId ?? null }
      : { ok: false, error: result.error ?? "Send failed", errorCode: result.code ?? null }
  );
}

/**
 * Queue a hand-typed photo, voice note, video or document, and return
 * immediately.
 *
 * The upload-to-Meta step is what this has and queueReply doesn't — real
 * bytes over the network, genuinely slow — so it's deferred to
 * deliverQueuedMediaReply exactly the way queueReply defers the Graph API
 * call. The row lands as 'queued' with no media_id yet (there's nothing to
 * point at until the upload finishes), which is what shows a "(image)"
 * placeholder in the thread until the real picture is in.
 */
export async function queueMediaReply(msg: {
  contact: Contact;
  kind: OutboundMediaKind;
  caption: string | null;
  sentBy: string | null;
}): Promise<QueueOutcome> {
  const verdict = await assertSendable({
    contact: msg.contact,
    kind: "reply",
    freeText: true,
  });

  if (!verdict.allow) {
    return { ok: false, refused: true, code: verdict.code, reason: verdict.reason };
  }

  const messageId = await recordOutbound({
    contactId: msg.contact.id,
    kind: msg.kind,
    body: msg.caption,
    status: "queued",
    sentBy: msg.sentBy,
  });

  if (!messageId) {
    return { ok: false, refused: false, error: "Could not save the message." };
  }
  return { ok: true, messageId };
}

/** Finishes what queueMediaReply started: upload, send, then settle the row. */
export async function deliverQueuedMediaReply(
  messageId: string,
  contact: Contact,
  file: { buffer: Buffer; mimeType: string; filename: string },
  kind: OutboundMediaKind,
  caption: string | null
): Promise<void> {
  const upload = await uploadMedia(file);
  if (!upload.ok || !upload.mediaId) {
    await finalizeOutbound(messageId, contact.id, {
      ok: false,
      error: upload.error ?? "Upload failed",
      errorCode: upload.code ?? null,
    });
    return;
  }

  const result = await sendMedia({
    to: contact.phone,
    kind,
    mediaId: upload.mediaId,
    caption: caption ?? undefined,
    filename: kind === "document" ? file.filename : undefined,
  });

  if (!result.ok) {
    await finalizeOutbound(messageId, contact.id, {
      ok: false,
      error: result.error ?? "Send failed",
      errorCode: result.code ?? null,
    });
    return;
  }

  await finalizeOutbound(messageId, contact.id, {
    ok: true,
    wamid: result.messageId ?? null,
    media: { id: upload.mediaId, mime: file.mimeType, filename: file.filename || null },
  });
}

/**
 * An automated session message, with or without buttons.
 *
 * The flow replies in `lib/crm/flows.ts` go out through here. Same window rule
 * as a hand-typed reply and the same gate — an automated message is not more
 * entitled to reach someone than a person's is, and a customer who says STOP
 * mid-flow stops mid-flow.
 *
 * `sentBy` is null on purpose: nobody typed it. The template name column stays
 * null too, because a session message is not a template — which is what makes
 * these easy to tell apart in the log.
 */
export async function sendSessionButtons(msg: {
  contact: Contact;
  body: string;
  buttons: ReplyButton[];
  /** The flow payload that caused this, for the audit trail. */
  payload?: string | null;
}): Promise<SendOutcome> {
  const verdict = await assertSendable({
    contact: msg.contact,
    kind: "reply",
    freeText: true,
  });

  if (!verdict.allow) {
    await recordOutbound({
      contactId: msg.contact.id,
      kind: "interactive",
      body: msg.body,
      buttonPayload: msg.payload ?? null,
      status: "failed",
      error: `Refused: ${verdict.reason}`,
    });
    return { ok: false, refused: true, code: verdict.code, reason: verdict.reason };
  }

  const result = await sendInteractive({
    to: msg.contact.phone,
    body: msg.body,
    buttons: msg.buttons,
  });

  await recordOutbound({
    contactId: msg.contact.id,
    wamid: result.ok ? result.messageId ?? null : null,
    kind: "interactive",
    body: msg.body,
    // The buttons offered, so a later reply can be read against what was on
    // screen when they tapped it.
    buttonPayload: msg.buttons.map((b) => b.id).join(","),
    status: result.ok ? "sent" : "failed",
    error: result.ok ? null : result.error,
    errorCode: result.ok ? null : result.code ?? null,
  });

  if (!result.ok) {
    await noteDeliveryFailure(msg.contact.id, result.code);
    return {
      ok: false,
      refused: false,
      error: result.error ?? "Send failed",
      code: result.code,
      retryable: result.retryable ?? false,
    };
  }
  return { ok: true, wamid: result.messageId ?? null };
}

/** The same, with no buttons — a plain automated session message. */
export async function sendSessionText(msg: {
  contact: Contact;
  body: string;
}): Promise<SendOutcome> {
  return sendReply({ contact: msg.contact, body: msg.body, sentBy: null });
}

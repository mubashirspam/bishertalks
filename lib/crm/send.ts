import { sendTemplate, sendText } from "@/lib/whatsapp";
import { assertSendable, type SendKind, type RefusalCode } from "@/lib/crm/gate";
import { recordOutbound } from "@/lib/crm/messages";
import { noteDeliveryFailure } from "@/lib/crm/consent";
import type { Contact } from "@/lib/crm/contacts";
import type { TemplateCategory } from "@/lib/whatsapp-templates";

/**
 * The only supported way to send a WhatsApp message.
 *
 * Two functions, one contract: check the gate, send, record the result, and
 * never throw. The raw wire calls in lib/whatsapp.ts are reachable from here
 * and from nowhere else — .eslintrc.json enforces that with
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

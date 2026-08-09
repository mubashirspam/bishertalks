/**
 * Resend, over plain HTTP.
 *
 * No SDK, for the same reason lib/whatsapp.ts talks to Meta with fetch and
 * lib/export.ts writes its own xlsx: this needs one endpoint, and a dependency
 * in the serverless bundle to build one JSON body isn't worth it.
 *
 * Nothing here throws. An email is a courtesy on top of a payment that has
 * already succeeded — a Resend outage, a missing API key or a bounced address
 * must never turn a confirmed order into a failed request.
 */

export interface EmailAttachment {
  filename: string;
  /** Raw bytes; base64-encoded on the way out. */
  content: Buffer;
}

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  /** Plain-text alternative. Spam filters treat HTML-only mail worse. */
  text: string;
  replyTo?: string;
  attachments?: EmailAttachment[];
}

export interface SendEmailResult {
  sent: boolean;
  id?: string;
  error?: string;
}

/**
 * Who the mail comes from.
 *
 * Must be a domain verified in Resend — an unverified sender is rejected, and
 * that is the single most common reason for this silently not working.
 */
function fromAddress(): string {
  return process.env.RESEND_FROM || "Bisher KC <orders@bishertalks.com>";
}

export function emailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

/** Cheap sanity check — not validation, just enough to skip obvious rubbish. */
export function isEmailAddress(value: string | null | undefined): value is string {
  return !!value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    // Local development without a key: log and carry on rather than pretending
    // to have sent something.
    console.warn("[Email] RESEND_API_KEY not set — skipping:", input.subject);
    return { sent: false, error: "not configured" };
  }

  if (!isEmailAddress(input.to)) {
    return { sent: false, error: "invalid recipient" };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress(),
        to: [input.to.trim()],
        subject: input.subject,
        html: input.html,
        text: input.text,
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
        ...(input.attachments?.length
          ? {
              attachments: input.attachments.map((a) => ({
                filename: a.filename,
                content: a.content.toString("base64"),
              })),
            }
          : {}),
      }),
    });

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      // Logged with the message Resend gave us — "domain is not verified" and
      // "invalid api key" are the two that actually happen, and both are
      // unfixable without seeing the text.
      const message = body?.message ?? `HTTP ${response.status}`;
      console.error("[Email] send failed:", input.to, message);
      return { sent: false, error: String(message) };
    }

    console.log("[Email] sent:", body?.id, "→", input.to);
    return { sent: true, id: body?.id };
  } catch (e) {
    console.error("[Email] unexpected error:", e);
    return { sent: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

export const dynamic = "force-dynamic";

import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  markNotificationByMessageId,
  type NotificationStatus,
} from "@/lib/db/notifications";

/**
 * Meta's WhatsApp webhook.
 *
 * Two jobs, one URL, because Meta only lets you configure one:
 *
 *   GET   the subscription handshake, once, when you paste this URL into the
 *         app's WhatsApp configuration.
 *   POST  everything that happens afterwards — delivery receipts for messages
 *         we sent, and anything a customer sends back.
 *
 * This is what the Make callback could never be: Meta reports sent, delivered,
 * read and failed against the message id it gave us at send time, so the
 * notification log stops guessing. A failure arrives with a code — a number
 * that isn't on WhatsApp, a template paused for quality — which is the
 * difference between "the message didn't arrive" and knowing why.
 *
 * Always answers 200, even to a payload it can't use. Meta retries anything
 * else with growing backoff and, after enough failures, disables the
 * subscription — so a malformed event must be logged and acknowledged, never
 * argued with.
 */

/** Meta's status names → ours. Identical today; mapped so they can diverge. */
const STATUS: Record<string, NotificationStatus> = {
  sent: "sent",
  delivered: "delivered",
  read: "read",
  failed: "failed",
};

/**
 * The subscription handshake.
 *
 * Meta calls this once with a token you chose; echo the challenge back as
 * plain text and the subscription goes live. Anything else must be a 403, or
 * the endpoint would confirm a subscription for whoever asked.
 */
export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const expected = process.env.WHATSAPP_VERIFY_TOKEN;

  if (
    expected &&
    p.get("hub.mode") === "subscribe" &&
    p.get("hub.verify_token") === expected
  ) {
    // Plain text, not JSON: Meta compares the body byte for byte.
    return new NextResponse(p.get("hub.challenge") ?? "", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  console.warn("[WhatsApp] webhook verification refused");
  return new NextResponse("Forbidden", { status: 403 });
}

/**
 * Is this really Meta?
 *
 * The payload carries customers' phone numbers and, on inbound messages, what
 * they wrote — so the signature is checked over the raw body, before anything
 * is parsed. Without an app secret configured we cannot verify anyone, and
 * refusing is the only safe answer.
 */
function verified(raw: string, signature: string | null): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret || !signature?.startsWith("sha256=")) return false;

  const expected = `sha256=${crypto
    .createHmac("sha256", secret)
    .update(raw)
    .digest("hex")}`;

  // Length check first: timingSafeEqual throws on a mismatch, and a thrown
  // exception here would be a 500 that Meta retries forever.
  if (signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

interface StatusEntry {
  id?: string;
  status?: string;
  recipient_id?: string;
  errors?: { code?: number; title?: string; message?: string }[];
}

export async function POST(request: NextRequest) {
  // Read the body as text, once: re-reading it as JSON would be a second read
  // of a consumed stream, and the signature is over these exact bytes.
  const raw = await request.text();

  if (!verified(raw, request.headers.get("x-hub-signature-256"))) {
    console.warn("[WhatsApp] webhook signature rejected");
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  let body: {
    entry?: {
      changes?: { value?: { statuses?: StatusEntry[]; messages?: unknown[] } }[];
    }[];
  };

  try {
    body = JSON.parse(raw);
  } catch {
    console.error("[WhatsApp] webhook body was not JSON");
    return NextResponse.json({ ok: true });
  }

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      // Inbound customer replies. Not handled yet — deliberately, rather than
      // by omission: replying opens a 24-hour window in which we could send
      // free-form Malayalam instead of templates, and that is its own piece of
      // work. Acknowledged so Meta stops retrying.
      if (change.value?.messages?.length) {
        console.log(
          `[WhatsApp] ${change.value.messages.length} inbound message(s) — not handled`
        );
      }

      for (const s of change.value?.statuses ?? []) {
        const status = s.status ? STATUS[s.status] : undefined;
        if (!s.id || !status) continue;

        const failure = s.errors?.[0];

        await markNotificationByMessageId(s.id, {
          status,
          ...(status === "failed"
            ? {
                error:
                  [failure?.title, failure?.message]
                    .filter(Boolean)
                    .join(" — ")
                    .slice(0, 1000) || "Delivery failed",
                errorCode: failure?.code ?? null,
              }
            : {}),
        });

        if (status === "failed") {
          console.error(
            "[WhatsApp] delivery failed:",
            s.id,
            failure?.code,
            failure?.title
          );
        }
      }
    }
  }

  return NextResponse.json({ ok: true });
}

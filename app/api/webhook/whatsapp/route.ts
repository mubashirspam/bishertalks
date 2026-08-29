export const dynamic = "force-dynamic";

import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  markNotificationByMessageId,
  type NotificationStatus,
} from "@/lib/db/notifications";
import { upsertContact } from "@/lib/crm/contacts";
import { recordInbound, bumpUnread, applyReceipt } from "@/lib/crm/messages";
import { stopWordIn, setOptOut, noteDeliveryFailure, clearFailureStreak } from "@/lib/crm/consent";
import { lastTemplateSent } from "@/lib/crm/messages";
import { runFlowAction, payloadForTitle } from "@/lib/crm/flows";
import { cancelEvents } from "@/lib/crm/automation";
import { addTag } from "@/lib/crm/tags";

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

interface InboundMessage {
  id?: string;
  from?: string;
  type?: string;
  text?: { body?: string };
  /**
   * A tap on a TEMPLATE's quick-reply button.
   *
   * `payload` is whatever was set at approval time, which for these templates
   * is nothing — Meta does not let a quick-reply button on a template carry an
   * id. So the title is all there is, and placing it needs the template that
   * was sent last. See payloadForTitle().
   */
  button?: { text?: string; payload?: string };
  /** A tap on a button WE sent on an interactive message, which carries our id. */
  interactive?: {
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string };
  };

  /**
   * Media, which never arrives inline.
   *
   * Meta sends an id and a mime type; the bytes are fetched later, by
   * exchanging the id for a short-lived URL that only answers to a request
   * carrying the access token. Every one of these shapes is the same three
   * fields under a different key, which is why they are read by lookup below
   * rather than five near-identical branches.
   *
   * `caption` is on image, video and document only — a voice note has no words
   * by definition.
   */
  image?: MediaPayload;
  audio?: MediaPayload;
  video?: MediaPayload;
  document?: MediaPayload;
  sticker?: MediaPayload;
}

interface MediaPayload {
  id?: string;
  mime_type?: string;
  caption?: string;
  filename?: string;
}

/** Kinds we store verbatim; anything else is recorded as 'other'. */
const MEDIA_KINDS = new Set(["image", "audio", "video", "document", "sticker"]);

/**
 * Read one inbound message.
 *
 * Order matters here more than anywhere else in the file. The stop check runs
 * against the text before the message is stored and before the unread count
 * moves, so that a customer asking us to stop is opted out even if a later
 * step fails. Everything is best-effort after that: a storage failure must not
 * make Meta retry, because a retry could deliver the same message again.
 */
async function handleInbound(
  m: InboundMessage,
  profiles: { wa_id?: string; profile?: { name?: string } }[]
): Promise<void> {
  if (!m.id || !m.from) return;

  // What the customer actually wrote, whichever shape it arrived in. A tapped
  // quick-reply button counts: someone answering "STOP" with a button means it
  // exactly as much as someone typing it.
  const text =
    m.text?.body ??
    m.button?.text ??
    m.interactive?.button_reply?.title ??
    m.interactive?.list_reply?.title ??
    // A caption is what the customer wrote, so it is the message body — and it
    // is checked for stop words like any other text. Somebody replying "stop"
    // under a photo means it.
    m.image?.caption ??
    m.video?.caption ??
    m.document?.caption ??
    null;

  const kind = m.type === "text" ? "text" : MEDIA_KINDS.has(m.type ?? "") ? m.type! : "other";

  // The id is the whole point. Without it the row records that a photo
  // arrived and gives nobody any way to look at it — which is what the thread
  // did until 0054: "(image)", in italics, for a customer's picture of a
  // damaged parcel.
  const media: MediaPayload | undefined = MEDIA_KINDS.has(m.type ?? "")
    ? (m as unknown as Record<string, MediaPayload | undefined>)[m.type!]
    : undefined;

  try {
    const name = profiles.find((c) => c.wa_id === m.from)?.profile?.name ?? null;
    const contact = await upsertContact(m.from, { name });
    if (!contact) {
      console.warn("[WhatsApp] inbound from an unusable number:", m.from);
      return;
    }

    // ── The stop check, first ──
    const stopWord = stopWordIn(text);
    if (stopWord) {
      const set = await setOptOut(
        contact.id,
        `Customer wrote "${stopWord}"`,
        "customer"
      );
      if (set) {
        console.warn("[WhatsApp] opt-out recorded for", contact.phone);
        // Everything queued for them goes. The stop flag would refuse each one
        // at the gate anyway, but a queue full of messages that will never
        // send is a queue nobody can read.
        await cancelEvents(contact.id, { reason: "Customer opted out" });
        await addTag(contact.id, "opted_out");
      }
    }

    // ── What they tapped, if they tapped ──
    //
    // Two shapes, and only one of them carries an id. An interactive reply is
    // a button we sent and gave an id to, so it routes itself. A template's
    // quick reply arrives as a bare title — Meta does not let an approved
    // template button carry a payload — so it is placed against the last
    // template that went to this contact. Three templates have a "Need Help"
    // button; without that lookup all three land in the same place.
    const replyId = m.interactive?.button_reply?.id ?? null;
    const buttonTitle =
      m.button?.text ?? m.interactive?.button_reply?.title ?? null;

    let payload = replyId ?? m.button?.payload ?? null;
    if (!payload && buttonTitle) {
      payload = payloadForTitle(await lastTemplateSent(contact.id), buttonTitle);
    }

    const isNew = await recordInbound({
      contactId: contact.id,
      wamid: m.id,
      kind: buttonTitle ? "button" : kind,
      body: text,
      buttonPayload: payload,
      mediaId: media?.id ?? null,
      mediaMime: media?.mime_type ?? null,
      mediaFilename: media?.filename ?? null,
    });

    // Only on a genuinely new message. A webhook retry must not make one
    // customer message look like two.
    if (isNew) {
      await bumpUnread(contact.id, new Date().toISOString());
    }

    // ── Then route it ──
    //
    // After storing, and only for a message we have not already handled — a
    // redelivered webhook must not re-run a flow, or a customer gets the same
    // reply twice and a second follow-up queued.
    if (!isNew || !payload || stopWord) return;

    // The window is judged from THIS message, not from the row we read a
    // moment ago: on somebody's first ever message that row says they have
    // never written, and the reply to their first tap would be refused as
    // out-of-window.
    const outcome = await runFlowAction(payload, {
      ...contact,
      last_inbound_at: new Date().toISOString(),
    });

    if (!outcome.matched) {
      // A button we do not know. Left in the inbox for a person rather than
      // guessed at — the flows are the only thing that should answer, and a
      // wrong guess is a wrong message.
      console.warn("[WhatsApp] unrouted button:", payload, contact.phone);
      return;
    }

    console.log(
      "[WhatsApp] flow:",
      payload,
      contact.phone,
      outcome.replied ? "replied" : (outcome.note ?? "no reply"),
      outcome.scheduled ? `· queued ${outcome.scheduled}` : ""
    );
  } catch (e) {
    console.error("[WhatsApp] inbound handling failed:", m.id, e);
  }
}

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
      changes?: {
        value?: {
          statuses?: StatusEntry[];
          messages?: InboundMessage[];
          contacts?: { wa_id?: string; profile?: { name?: string } }[];
        };
      }[];
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
      // Inbound customer replies. Each one opens the 24-hour window in which
      // we may answer in free-form Malayalam, so it is stored, counted, and
      // read for a stop request before anything else looks at it.
      for (const m of change.value?.messages ?? []) {
        await handleInbound(m, change.value?.contacts ?? []);
      }

      for (const s of change.value?.statuses ?? []) {
        const status = s.status ? STATUS[s.status] : undefined;
        if (!s.id || !status) continue;

        const failure = s.errors?.[0];

        const errorText =
          [failure?.title, failure?.message].filter(Boolean).join(" — ").slice(0, 1000) ||
          "Delivery failed";

        await markNotificationByMessageId(s.id, {
          status,
          ...(status === "failed"
            ? { error: errorText, errorCode: failure?.code ?? null }
            : {}),
        });

        // The same receipt against the CRM's copy. A message sent from the
        // inbox or a campaign lives in whatsapp_messages, not notification_log,
        // and both need to walk forward.
        const touched = await applyReceipt(
          s.id,
          status,
          status === "failed"
            ? { error: errorText, code: failure?.code ?? null }
            : undefined
        );

        if (touched?.contactId) {
          if (status === "failed") {
            // Enough undeliverable sends in a row and we stop by ourselves —
            // Meta never tells you a customer blocked you, and continuing to
            // push at a number that keeps refusing is how one block becomes a
            // quality rating.
            const stopped = await noteDeliveryFailure(touched.contactId, failure?.code);
            if (stopped) {
              console.warn(
                "[WhatsApp] contact auto-opted-out after repeated failures:",
                touched.contactId
              );
            }
          } else if (status === "delivered" || status === "read") {
            await clearFailureStreak(touched.contactId);
          }
        }

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

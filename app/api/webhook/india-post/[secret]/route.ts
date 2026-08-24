export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { applyCarrierScan } from "@/lib/db/courier-scan";
import {
  statusFromEvent,
  describeEvent,
  eventTimestamp,
  type IndiaPostEvent,
} from "@/lib/india-post/status";

/**
 * India Post's event push.
 *
 * Configured in the Customer Selfservice Portal under API Subscription →
 * Event Configuration, which takes two URLs — one for booking events and one
 * for everything else. Both point here; the payload says which it is, and
 * splitting the handling would mean two copies of the same twenty lines.
 *
 * **The secret is in the path, not a header.** Their form offers nowhere to
 * put one: there is no signature, no shared key, no header field — only a URL
 * box and a Test button. So the URL itself is the credential, and a path
 * segment is the one place a secret survives everything in between (query
 * strings get logged, stripped and rewritten by proxies far more often than
 * paths do).
 *
 * That makes the URL as sensitive as a password. It moves orders to delivered
 * and settles referral commissions. Long, random, and rotated if it ever
 * appears in a screenshot.
 *
 * Always answers 200 once authenticated, even for a parcel we have never heard
 * of. A non-2xx makes them retry the same event indefinitely, and "no such
 * article" is not a problem retrying will fix.
 */

/** Constant-time, so the endpoint cannot be probed a character at a time. */
function authorised(secret: string): boolean {
  const expected = process.env.INDIA_POST_WEBHOOK_SECRET;

  // No secret configured means nobody is authorised. Failing closed matters
  // more here than almost anywhere: this endpoint moves orders to delivered.
  if (!expected) {
    console.error("[India Post] webhook called but INDIA_POST_WEBHOOK_SECRET is unset");
    return false;
  }

  const a = Buffer.from(secret ?? "");
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Their push payload, as documented. Every field optional — see below. */
interface PushBody {
  article_number?: string;
  article_type?: string;
  event_code?: string;
  event_description?: string;
  event_date?: string;
  event_time?: string;
  event_office_name?: string;
  non_delivery_reason?: string;
  reference?: string;
  booking_ref_id?: number | string;
  bulk_customer_id?: number | string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ secret: string }> }
) {
  const { secret } = await params;

  if (!authorised(secret)) {
    console.warn("[India Post] webhook rejected — bad or missing secret");
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const raw = await request.text();
  let body: PushBody | PushBody[] = {};
  try {
    body = raw ? (JSON.parse(raw) as PushBody | PushBody[]) : {};
  } catch {
    // The portal's Test button, and anything else that pings the URL to see
    // whether it answers. A 200 is the correct reply: the endpoint is up, which
    // is the only question being asked.
    console.log("[India Post] webhook ping — body was not JSON");
    return NextResponse.json({ ok: true, ignored: "not json" });
  }

  // They document a single object; a batch is cheap to accept and impossible
  // to handle later if it arrives and we assumed otherwise.
  const events = Array.isArray(body) ? body : [body];

  let applied = 0;
  const unknown: string[] = [];

  for (const push of events) {
    const article = (push.article_number ?? "").trim().toUpperCase();

    // A ping, or a shape we do not recognise. Legitimate caller either way —
    // do not make them retry it.
    if (!article || !push.event_code) continue;

    const event: IndiaPostEvent = {
      eventCode: push.event_code,
      eventDescription: push.event_description ?? "",
      at: eventTimestamp(push.event_date ?? "", push.event_time ?? ""),
      office: push.event_office_name ?? null,
      nonDeliveryReason: push.non_delivery_reason ?? null,
    };

    const outcome = await applyCarrierScan(
      {
        description: describeEvent(event),
        at: event.at,
        next: statusFromEvent(event),
      },
      // The article number is the parcel's tracking number on our side, stored
      // when the booking was accepted. `reference` is our own bulk_reference
      // and is offered as a fallback for a parcel whose booking response we
      // failed to save.
      { waybill: article, reference: (push.reference ?? "").trim() || null }
    );

    if (outcome) applied++;
    else unknown.push(article);
  }

  if (unknown.length) {
    console.warn("[India Post] events for articles we do not have:", unknown.join(", "));
  }

  return NextResponse.json({ ok: true, received: events.length, applied });
}

/**
 * Their Test button, and any health check they run.
 *
 * A GET that answers 200 lets the portal confirm the URL is reachable before
 * it will let the configuration be saved. It does nothing else, and it still
 * requires the secret — an endpoint that confirms its own existence to anyone
 * who guesses the path is an endpoint being enumerated.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ secret: string }> }
) {
  const { secret } = await params;
  if (!authorised(secret)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, endpoint: "india-post events" });
}

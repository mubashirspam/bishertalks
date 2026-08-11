export const dynamic = "force-dynamic";

import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { markNotificationResult } from "@/lib/db/notifications";

/**
 * Delivery result, reported back by the Make scenario.
 *
 * Both the success path and the error handler call this, which is what turns
 * the notification log from "we handed it to Make" into "the customer got it".
 * Without it every row stays 'queued' forever.
 *
 * Deliberately never returns 4xx for a payload problem: Make treats an error
 * response as a failed module and puts the whole run into the retry queue,
 * which would replay the WhatsApp send too. A bad callback is logged and
 * acknowledged.
 */
function authorized(request: NextRequest): boolean {
  const expected = process.env.MAKE_WEBHOOK_SECRET || "";
  const got = request.headers.get("x-bisher-secret") || "";
  if (!expected || got.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const eventId = typeof body?.event_id === "string" ? body.event_id : "";
  const status = body?.status === "failed" ? "failed" : "sent";

  if (!eventId) {
    console.error("[Notify] callback with no event_id:", JSON.stringify(body).slice(0, 300));
    return NextResponse.json({ ok: true, ignored: true });
  }

  await markNotificationResult(eventId, {
    status,
    provider: typeof body?.provider === "string" ? body.provider : null,
    providerMessageId:
      typeof body?.provider_message_id === "string" ? body.provider_message_id : null,
    error: typeof body?.error === "string" ? body.error.slice(0, 1000) : null,
  });

  return NextResponse.json({ ok: true });
}

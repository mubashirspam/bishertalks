export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { applyScan } from "@/lib/db/courier-scan";
import type { DelhiveryScan } from "@/lib/delhivery/status";

/**
 * Delhivery's status push.
 *
 * They POST a scan whenever a parcel moves. Setting it up is opt-in at their
 * end — they need this URL, some test waybills and a sample request, and it
 * takes about a week — so `/api/cron/courier-poll` does the same job until it
 * is live, and stays as the backstop afterwards.
 *
 * Authentication is the uncomfortable part: **Delhivery does not sign their
 * payloads**. There is no HMAC to verify like the WhatsApp and Razorpay hooks
 * have. All we can do is hand them a secret to send back in a header, so that
 * is what this checks — and it means the secret is the only thing between this
 * endpoint and anyone who guesses the URL. Treat it accordingly: long, random,
 * and rotated if it ever leaks.
 *
 * Always answers 200 once authenticated, even for a parcel we cannot find.
 * A non-2xx makes them retry the same scan indefinitely, and "we have never
 * heard of this waybill" is not a problem retrying will fix.
 */

/** Constant-time, so the endpoint can't be probed a character at a time. */
function authorised(request: NextRequest): boolean {
  const expected = process.env.DELHIVERY_WEBHOOK_SECRET;

  // No secret configured means nobody is authorised. Failing closed matters
  // more here than elsewhere: this endpoint moves orders to delivered.
  if (!expected) {
    console.error("[Delhivery] webhook called but DELHIVERY_WEBHOOK_SECRET is unset");
    return false;
  }

  const sent =
    request.headers.get("x-delhivery-token") ??
    request.headers.get("authorization")?.replace(/^Token\s+/i, "") ??
    "";

  const a = Buffer.from(sent);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

interface PushBody {
  Shipment?: {
    AWB?: string;
    ReferenceNo?: string;
    Status?: {
      Status?: string;
      StatusType?: string;
      StatusDateTime?: string;
      StatusLocation?: string;
      Instructions?: string;
    };
  };
}

export async function POST(request: NextRequest) {
  if (!authorised(request)) {
    console.warn("[Delhivery] webhook rejected — bad or missing token");
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as PushBody;
  const shipment = body.Shipment;

  if (!shipment?.AWB && !shipment?.ReferenceNo) {
    // Nothing to act on, but it was a legitimate caller — don't make them retry.
    return NextResponse.json({ ok: true, ignored: "no shipment identity" });
  }

  const status = shipment.Status ?? {};
  const scan: DelhiveryScan = {
    status: status.Status ?? "",
    statusType: status.StatusType ?? "",
    statusDateTime: status.StatusDateTime ?? null,
    location: status.StatusLocation ?? null,
    instructions: status.Instructions ?? null,
  };

  try {
    const outcome = await applyScan(scan, {
      waybill: shipment.AWB ?? null,
      reference: shipment.ReferenceNo ?? null,
    });

    return NextResponse.json({
      ok: true,
      order: outcome?.order_number ?? null,
      moved_to: outcome?.moved_to ?? null,
    });
  } catch (e) {
    // Our failure, not theirs — a 500 here is honest and asks them to resend.
    console.error("[Delhivery] scan failed:", e);
    return NextResponse.json({ error: "Could not record that scan" }, { status: 500 });
  }
}

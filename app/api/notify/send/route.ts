export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { sendOrderNotification, type OrderEvent } from "@/lib/notify";

const INTERNAL_SECRET =
  process.env.INTERNAL_API_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY!;

const EVENTS: OrderEvent[] = [
  "payment_received",
  "confirmed",
  "shipped",
  "delivered",
  "course_access",
];

/**
 * Internal hook for sending an order's customer notification.
 *
 * The payload building lives in `lib/notify.ts`; this is the entry point for
 * callers that can only reach it over HTTP, and for the admin's manual
 * "re-send this message" action. Server-side code should call
 * `sendOrderNotification` directly instead.
 *
 * `resend: true` bypasses the duplicate guard — that is what makes it a
 * re-send rather than a no-op.
 */
export async function POST(request: NextRequest) {
  const secret = request.headers.get("x-internal-secret");
  if (secret !== INTERNAL_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { order_number, event_type, resend } = await request.json();

  if (!order_number || !event_type) {
    return NextResponse.json(
      { error: "Missing order_number or event_type" },
      { status: 400 }
    );
  }

  if (!EVENTS.includes(event_type)) {
    return NextResponse.json(
      { error: `Unknown event_type: ${event_type}` },
      { status: 400 }
    );
  }

  const result = await sendOrderNotification(order_number, event_type, {
    resend: resend === true,
  });

  return result.ok
    ? NextResponse.json({ success: true, duplicate: result.duplicate ?? false })
    : NextResponse.json({ error: result.error }, { status: result.status });
}

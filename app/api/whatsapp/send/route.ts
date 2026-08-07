export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { sendOrderNotification, type OrderEvent } from "@/lib/notify";

const INTERNAL_SECRET =
  process.env.INTERNAL_API_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Internal hook for sending an order's WhatsApp message.
 *
 * The message building itself lives in `lib/notify.ts`; this is the entry
 * point for callers that can only reach it over HTTP (the Razorpay webhook,
 * the checkout callbacks). Server-side code should call
 * `sendOrderNotification` directly instead.
 */
export async function POST(request: NextRequest) {
  const secret = request.headers.get("x-internal-secret");
  if (secret !== INTERNAL_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { order_number, event_type } = await request.json();

  if (!order_number || !event_type) {
    return NextResponse.json(
      { error: "Missing order_number or event_type" },
      { status: 400 }
    );
  }

  const result = await sendOrderNotification(order_number, event_type as OrderEvent);

  return result.ok
    ? NextResponse.json({ success: true })
    : NextResponse.json({ error: result.error }, { status: result.status });
}

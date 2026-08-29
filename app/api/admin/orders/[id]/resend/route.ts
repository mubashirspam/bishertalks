export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-auth";
import { sendOrderNotification } from "@/lib/notify";
import { isOrderEvent, isHeld, WIRE_EVENT, type OrderEvent } from "@/lib/notify-events";
import { TEMPLATES } from "@/lib/whatsapp-templates";
import { audit } from "@/lib/audit";

/**
 * Send an order's notification again, from the admin.
 *
 * The button this answers exists because of a specific afternoon: an expired
 * access token failed every message for a day, the log said so on each order,
 * and there was no way to act on it short of changing a status back and forth
 * to re-trigger the send.
 *
 * It re-sends the EVENT, not the message. Whatever template that event maps to
 * today is what goes out — so a confirmation failed against `order_confirmed`
 * in August re-sends as `neuro_order_receipt`, with the Track Order and Need
 * Help buttons, because that is what `TEMPLATES.confirmed` is now. Storing the
 * old template name and replaying that would resend a wording we have moved
 * off, which is the opposite of what a retry is for.
 *
 * Refuses to re-send anything that already reached the customer. A retry is
 * for a message that failed; on one that landed it is just a second copy.
 */

/** Statuses worth retrying. Anything else already reached them, or is in flight. */
const RETRYABLE = new Set(["failed", "skipped", "queued"]);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Sending a customer a message is an edit to what they have been told, and
  // `orders.edit` is the permission that already covers changing that.
  const auth = await requirePermission("orders.edit");
  if (!auth.ok) return auth.response;

  const { id: orderNumber } = await params;
  const body = await request.json().catch(() => ({}));
  const event = String(body.event ?? "");
  const status = String(body.status ?? "");

  if (!isOrderEvent(event)) {
    return NextResponse.json({ error: `Unknown event: ${event}` }, { status: 400 });
  }

  if (status && !RETRYABLE.has(status)) {
    return NextResponse.json(
      {
        error:
          "That message reached the customer. Re-sending would give them a " +
          "second copy.",
      },
      { status: 400 }
    );
  }

  // Held events are withheld by decision, not by accident — course_access has
  // no approved template and five refused submissions behind it. Saying so
  // beats a retry that silently records "skipped" and looks like it worked.
  if (isHeld(event as OrderEvent)) {
    return NextResponse.json(
      {
        error:
          `${WIRE_EVENT[event as OrderEvent]} is held: there is no approved ` +
          `template for it, so nothing would be sent.`,
      },
      { status: 400 }
    );
  }

  const result = await sendOrderNotification(orderNumber, event as OrderEvent, {
    // The whole point. Without this the idempotency key from the failed
    // attempt suppresses the retry and the button does nothing.
    resend: true,
  });

  await audit({
    actor: auth.staff,
    action: "order.notification_resent",
    entity: "order",
    entityId: orderNumber,
    meta: {
      event,
      template: TEMPLATES[event as OrderEvent]?.name ?? null,
      ok: result.ok,
      error: result.ok ? null : result.error,
    },
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error ?? "Could not send it" },
      { status: result.status && result.status >= 400 ? result.status : 502 }
    );
  }

  return NextResponse.json({
    ok: true,
    template: TEMPLATES[event as OrderEvent]?.name ?? null,
    duplicate: result.duplicate ?? false,
  });
}

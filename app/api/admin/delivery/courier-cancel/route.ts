export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCourier } from "@/lib/db/couriers";
import { canSendAutomatically } from "@/lib/couriers";
import { delhiveryReadiness } from "@/lib/delhivery/config";
import { cancelWaybill } from "@/lib/delhivery/cancel";
import { audit } from "@/lib/audit";

/**
 * Cancel a parcel with the courier.
 *
 * The real undo for a send. Clearing our own columns would only make the two
 * systems disagree while a van still came for the parcel, so this calls them
 * first and follows their answer — if Delhivery says no, nothing changes here.
 *
 * Their constraint: cancellation is accepted only while the package is
 * Manifested, In Transit, Pending, Open or Scheduled. Past that, the parcel is
 * on its way and the honest answer is that it cannot be recalled.
 */
export async function POST(request: NextRequest) {
  const auth = await requirePermission("delivery.assign");
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({}));
  const orderNumber = typeof body.order_number === "string" ? body.order_number : "";

  if (!orderNumber) {
    return NextResponse.json({ error: "Which order?" }, { status: 400 });
  }

  const { data: order } = await supabaseAdmin
    .from("orders")
    .select("order_number,tracking_number,courier_id,courier_sent_at")
    .eq("order_number", orderNumber)
    .maybeSingle();

  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  const parcel = order as {
    tracking_number: string | null;
    courier_id: string | null;
    courier_sent_at: string | null;
  };

  if (!parcel.courier_sent_at || !parcel.tracking_number) {
    return NextResponse.json(
      { error: "This parcel was never sent to a courier, so there is nothing to cancel." },
      { status: 400 }
    );
  }

  const courier = parcel.courier_id ? await getCourier(parcel.courier_id) : null;
  if (!courier || !canSendAutomatically(courier)) {
    return NextResponse.json(
      {
        error:
          "This parcel wasn't sent through an integration, so cancel it with the courier directly.",
      },
      { status: 400 }
    );
  }

  const { ready, settings } = delhiveryReadiness(courier.config);
  if (!ready || !settings) {
    return NextResponse.json({ error: "Delhivery is not set up." }, { status: 400 });
  }

  let result;
  try {
    result = await cancelWaybill(parcel.tracking_number, settings);
  } catch (e) {
    console.error("[Courier] cancel failed:", orderNumber, e);
    return NextResponse.json(
      { error: "Could not reach Delhivery. The parcel is unchanged." },
      { status: 502 }
    );
  }

  if (!result.ok) {
    // Their refusal, verbatim — usually "package is out for delivery" or
    // similar, which tells the admin what to do next better than we could.
    return NextResponse.json({ error: result.message }, { status: 400 });
  }

  // Cancelled with them, so this parcel is sendable again — to this courier or
  // another. The waybill stays on the row: it is what the parcel went out
  // under, and it is how the RTO scans that follow will be matched back.
  await supabaseAdmin
    .from("orders")
    .update({
      courier_sent_at: null,
      courier_send_error: null,
      courier_entered_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("order_number", orderNumber);

  await audit({
    actor: auth.staff,
    action: "order.courier_cancelled",
    entity: "order",
    entityId: orderNumber,
    meta: { courier: courier.slug, waybill: parcel.tracking_number },
  });

  return NextResponse.json({ ok: true, message: result.message });
}

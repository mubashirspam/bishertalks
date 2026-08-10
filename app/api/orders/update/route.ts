export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/admin-auth";
import { setDeliveryStatus, notifyStatusChange } from "@/lib/db/delivery";
import type { OrderStatus } from "@/lib/types/order";
import { audit } from "@/lib/audit";

/**
 * Update a single order from the admin detail page.
 *
 * Shipment fields are written first, then the status goes through the same
 * path as a bulk change — so milestone timestamps and customer notifications
 * behave identically whether one order was updated or fifty, and the "shipped"
 * message always quotes the courier and tracking number just saved.
 */
export async function PATCH(request: NextRequest) {
  const auth = await requirePermission("orders.edit");
  if (!auth.ok) return auth.response;

  const {
    order_number,
    status,
    tracking_number,
    courier_name,
    expected_delivery,
    notes,
    // Manual address entry — the recovery path when a paid order has no
    // address and the customer reads it out over a call instead of filling
    // the form themselves.
    buyer_name,
    address_line1,
    address_line2,
    city,
    district,
    state,
    pincode,
  } = await request.json();

  if (!order_number) {
    return NextResponse.json(
      { error: "order_number is required" },
      { status: 400 }
    );
  }

  const updates: Record<string, unknown> = {};
  if (tracking_number !== undefined) updates.tracking_number = tracking_number;
  if (courier_name !== undefined) updates.courier_name = courier_name;
  if (expected_delivery !== undefined)
    updates.expected_delivery = expected_delivery || null;
  if (notes !== undefined) updates.notes = notes;

  const addressFields = {
    buyer_name, address_line1, address_line2, city, district, state, pincode,
  } as const;
  let addressEdited = false;
  for (const [col, val] of Object.entries(addressFields)) {
    if (val !== undefined) {
      updates[col] = val || null;
      addressEdited = true;
    }
  }

  if (Object.keys(updates).length) {
    const { error } = await supabaseAdmin
      .from("orders")
      .update(updates)
      .eq("order_number", order_number);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  if (addressEdited) {
    await audit({
      actor: auth.staff,
      action: "order.address",
      entity: "order",
      entityId: order_number,
      meta: { city, pincode },
    });
  }

  if (status) {
    try {
      const updated = await setDeliveryStatus([order_number], status as OrderStatus);
      await audit({
        actor: auth.staff,
        action: "order.status",
        entity: "order",
        entityId: order_number,
        meta: { status, ...(courier_name ? { courier: courier_name } : {}) },
      });
      await notifyStatusChange(updated, status as OrderStatus);
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Status update failed" },
        { status: 500 }
      );
    }
  }

  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("*")
    .eq("order_number", order_number)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

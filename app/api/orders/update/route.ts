export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/admin-auth";
import { setDeliveryStatus, notifyStatusChange } from "@/lib/db/delivery";
import { normalizePhone, isValidPhone, upsertUserByPhone } from "@/lib/db/users";
import { grantCourseAccess } from "@/lib/db/access";
import { BOOK_BONUS_COURSE_SLUG } from "@/lib/types/db";
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
    // A wrong number typed at checkout — the buyer can't sign in to the
    // course and WhatsApp updates go to a stranger.
    buyer_phone,
  } = await request.json();

  if (!order_number) {
    return NextResponse.json(
      { error: "order_number is required" },
      { status: 400 }
    );
  }

  // A phone change is more than a field edit: the number is the buyer's
  // course sign-in and the address every WhatsApp update goes to. So the
  // user link and the course access move with it, or the correction would
  // fix the label and leave the login broken.
  if (buyer_phone !== undefined) {
    const phone = normalizePhone(String(buyer_phone));
    if (!isValidPhone(phone)) {
      return NextResponse.json({ error: "Invalid phone number" }, { status: 400 });
    }

    const { data: order } = await supabaseAdmin
      .from("orders")
      .select("id, user_id, buyer_phone, buyer_name, buyer_email, city, state, payment_status")
      .eq("order_number", order_number)
      .single();

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    if (order.buyer_phone !== phone) {
      try {
        // The user first — if the upsert fails, nothing has moved yet.
        const user = await upsertUserByPhone({
          phone,
          name: order.buyer_name,
          email: order.buyer_email,
          city: order.city,
          state: order.state,
        });

        await supabaseAdmin
          .from("orders")
          .update({ buyer_phone: phone, user_id: user.id })
          .eq("order_number", order_number);

        if (order.payment_status === "paid") {
          const { data: course } = await supabaseAdmin
            .from("courses")
            .select("id")
            .eq("slug", BOOK_BONUS_COURSE_SLUG)
            .maybeSingle();

          if (course) {
            // Access granted through this order to the wrong number is a
            // course a stranger keeps — revoke it, then grant the buyer.
            // No notification: the buyer didn't ask for a message, they
            // asked for their parcel.
            await supabaseAdmin
              .from("course_access")
              .update({ status: "revoked" })
              .eq("order_id", order.id)
              .neq("user_id", user.id);
            await grantCourseAccess({
              userId: user.id,
              courseId: course.id,
              grantedVia: "purchase",
              orderId: order.id,
              orderNumber: order_number,
              notify: false,
            });
          }
        }
      } catch (e) {
        return NextResponse.json(
          { error: e instanceof Error ? e.message : "Phone update failed" },
          { status: 500 }
        );
      }

      await audit({
        actor: auth.staff,
        action: "order.phone",
        entity: "order",
        entityId: order_number,
        // Masked — the history panel doesn't need a second copy of anyone's
        // full number; the order itself has the current one.
        meta: { to: `${phone.slice(0, 2)}******${phone.slice(-2)}` },
      });
    }
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

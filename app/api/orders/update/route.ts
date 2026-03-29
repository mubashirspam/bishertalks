import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || user.email !== process.env.ADMIN_EMAIL) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const {
    order_number,
    status,
    tracking_number,
    courier_name,
    expected_delivery,
    notes,
  } = await request.json();

  if (!order_number || !status) {
    return NextResponse.json(
      { error: "order_number and status are required" },
      { status: 400 }
    );
  }

  const updates: Record<string, unknown> = { status };
  if (tracking_number !== undefined) updates.tracking_number = tracking_number;
  if (courier_name !== undefined) updates.courier_name = courier_name;
  if (expected_delivery !== undefined)
    updates.expected_delivery = expected_delivery || null;
  if (notes !== undefined) updates.notes = notes;

  const { data, error } = await supabaseAdmin
    .from("orders")
    .update(updates)
    .eq("order_number", order_number)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Trigger WhatsApp for shipped / delivered
  if (status === "shipped" || status === "delivered") {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    fetch(`${appUrl}/api/whatsapp/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": process.env.INTERNAL_API_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY!,
      },
      body: JSON.stringify({ order_number, event_type: status }),
    }).catch(console.error);
  }

  return NextResponse.json(data);
}

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { buildInvoice, type InvoiceOrder } from "@/lib/invoice";

/**
 * Downloadable bill (PDF) for one paid order, generated when the admin clicks
 * "Generate bill" on the order page — for the customer who asks for one.
 *
 * Deliberately a pure read: the PDF is handed straight to the admin's browser
 * as a download. Nothing is emailed, sent on WhatsApp, or written to the
 * audit trail — a bill can be regenerated any number of times, so each
 * download is not an event worth recording.
 *
 * `orders.view`, not `orders.edit`: generating the bill changes nothing, and
 * it exposes only what the detail page already shows to the same viewer.
 */
export async function POST(request: NextRequest) {
  const auth = await requirePermission("orders.view");
  if (!auth.ok) return auth.response;

  const { order_number } = await request.json().catch(() => ({}));
  if (!order_number) {
    return NextResponse.json({ error: "Missing order_number" }, { status: 400 });
  }

  const { data: order, error } = await supabaseAdmin
    .from("orders")
    .select(
      `order_number, buyer_name, buyer_phone, buyer_email,
       address_line1, address_line2, city, district, state, pincode,
       amount_paise, quantity, discount_paise, promo_code,
       razorpay_payment_id, payment_status,
       created_at, invoice_email_sent_at, address_submitted_at`
    )
    .eq("order_number", String(order_number))
    .maybeSingle();

  if (error || !order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // A bill says money was received; on an unpaid order it would be a lie.
  if (order.payment_status !== "paid") {
    return NextResponse.json(
      { error: "Not paid yet — there is nothing to bill." },
      { status: 400 }
    );
  }

  const pdf = buildInvoice(order as unknown as InvoiceOrder);

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="bill-${order.order_number}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}

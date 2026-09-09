export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/admin-auth";
import { audit } from "@/lib/audit";
import { isManualPaymentMethod } from "@/lib/db/sales-channel";
import { cleanName, isUsableName, NAME_MIN } from "@/lib/clean-name";
import { notifyAfterResponse } from "@/lib/notify";
import { listActiveCouriers } from "@/lib/db/couriers";
import { isDeliveryPriority } from "@/lib/delivery-priority";
import { isDeliveryMode } from "@/lib/delivery-mode";
import { addressType } from "@/lib/address";
import { allocateBarcodes } from "@/lib/db/postal-barcodes";

/**
 * Enter a book that was sold directly.
 *
 * The customer scanned a QR code, paid by UPI, and sent their address over
 * WhatsApp. There is no checkout session, no Razorpay order and no payment
 * webhook — so this route is the only thing standing between that conversation
 * and a parcel the delivery screens can actually work with.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 *
 * It does not touch Razorpay, and it never writes `razorpay_order_id` or
 * `razorpay_payment_id`. Those columns mean "this is what Razorpay told us",
 * and a hand-typed value in them would make the settlement reconciliation
 * unfalsifiable — which is the whole thing migration 0061 exists to protect.
 *
 * It does not mint a referral commission. A referral is paid on money that
 * arrived through the checkout that recorded the referrer; there is no such
 * checkout here, and a commission approved against a payment nobody can look
 * up is a payout with no evidence behind it.
 *
 * WHAT IT DOES DO
 *
 * Writes an order in `confirmed` status with `sales_channel = 'manual'`, which
 * is exactly the shape the delivery pipeline already understands. From that
 * moment it routes, labels, hands over and tracks like any other parcel, and
 * every revenue, book and stock figure ignores it.
 *
 * `payment_status` is `paid` unless `delivery_mode` is `cod` — cash collected
 * by the courier at the door rather than money already in hand (0067). A COD
 * sale is just as real and just as ready to ship; it simply hasn't been paid
 * for yet, which is why it gets no `manual_payment_method` and no automated
 * "payment received" WhatsApp below. See lib/delivery-mode.ts and
 * collectCodPayment() in lib/db/delivery.ts, which is what actually marks one
 * paid, at the moment the courier hands it over.
 *
 * A prepaid direct sale is messaged exactly as an online buyer is — the same
 * `confirmed` notification the paid transition fires, and every delivery
 * update after it. They bought a book and are waiting for it; how the rupees
 * travelled is this shop's bookkeeping problem, not theirs.
 */

/** Ten digits, the way every other phone in this system is stored. */
function normalisePhone(raw: string): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  const ten = digits.length > 10 ? digits.slice(-10) : digits;
  return /^[6-9]\d{9}$/.test(ten) ? ten : null;
}

/** `ORD-` plus six characters, matching lib's own order numbers. */
function generateOrderNumber(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < 6; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `ORD-${out}`;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export async function POST(request: NextRequest) {
  const auth = await requirePermission("orders.create");
  if (!auth.ok) return auth.response;
  const staff = auth.staff;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send JSON" }, { status: 400 });
  }

  // Same cleaning the checkout applies (lib/clean-name.ts): emoji stripped
  // and spacing normalised silently, because a label with 😊 on it is an
  // .xlsx India Post refuses for the whole batch, not just this parcel.
  const buyerName = cleanName(body.buyer_name);
  const phone = normalisePhone(str(body.buyer_phone));
  const houseName = str(body.house_name);
  const doorNo = str(body.door_no);
  const addrType = addressType(body.address_type);
  const addressLine1 = str(body.address_line1);
  const city = str(body.city);
  const state = str(body.state);
  const pincode = str(body.pincode).replace(/\D/g, "");
  const quantity = Math.max(1, Math.floor(Number(body.quantity) || 1));
  const amountRupees = Number(body.amount_rupees);

  // 'normal' unless somebody says otherwise. An unrecognised value is refused
  // rather than quietly filed as normal, same reasoning as delivery_priority
  // below — a silent downgrade would tell the person at the counter their COD
  // sale was accepted as already paid.
  const deliveryModeInput = str(body.delivery_mode) || "normal";
  if (!isDeliveryMode(deliveryModeInput)) {
    return NextResponse.json({ error: "Unknown delivery mode." }, { status: 400 });
  }
  const isCod = deliveryModeInput === "cod";

  // Nothing has been paid on a COD sale, so there is no "how they paid" to
  // ask for — that question is answered later, when the courier collects it.
  const method = str(body.manual_payment_method) || (isCod ? "" : "upi");

  // Everything the delivery pipeline needs, refused up front rather than at the
  // courier. A parcel that cannot be addressed is not a parcel.
  const problems: string[] = [];
  if (!isUsableName(buyerName)) {
    problems.push(`The buyer's name (at least ${NAME_MIN} letters)`);
  }
  if (!phone) problems.push("A valid 10-digit Indian mobile number");
  // Required here as at the checkout: this is the field added to stop parcels
  // coming back, and a form that lets it be skipped collects nothing.
  if (!houseName) problems.push("The house or building name");
  if (!addressLine1) problems.push("The area, street or locality");
  if (!city) problems.push("The city");
  if (!state) problems.push("The state");
  if (!/^\d{6}$/.test(pincode)) problems.push("A six-digit pincode");
  if (!Number.isFinite(amountRupees) || amountRupees < 0) {
    problems.push(isCod ? "The amount due, in rupees" : "The amount paid, in rupees");
  }
  if (!isCod && !isManualPaymentMethod(method)) problems.push("How they paid");

  if (problems.length) {
    return NextResponse.json(
      { error: `Still needed: ${problems.join(", ")}` },
      { status: 400 }
    );
  }

  // ── Which service is carrying it ──────────────────────────────────────
  //
  // Optional: whoever is entering the sale usually knows, and when they do not
  // the parcel lands in the delivery queue as New and gets routed there, which
  // is what happened to every direct sale before this field existed.
  //
  // Checked against the live courier list rather than a list of names in this
  // file. The id comes off a form, `courier_id` is a foreign key, and a stale
  // hard-coded slug is how a picker starts offering a partner the shop stopped
  // using last year. Inactive couriers are refused for the same reason the
  // routing screen does not offer them.
  const courierId = str(body.courier_id);
  let routedCourier: Awaited<ReturnType<typeof listActiveCouriers>>[number] | null = null;
  if (courierId) {
    const active = await listActiveCouriers();
    routedCourier = active.find((c) => c.id === courierId) ?? null;
    if (!routedCourier) {
      return NextResponse.json(
        { error: "That delivery service is not one we are using." },
        { status: 400 }
      );
    }
  }

  // 'normal' unless somebody says otherwise. An unrecognised value is refused
  // rather than quietly filed as normal: the column has a CHECK constraint
  // behind it (0063), and a silent downgrade would tell the person at the
  // counter their rush order was accepted as one.
  const priority = str(body.delivery_priority) || "normal";
  if (!isDeliveryPriority(priority)) {
    return NextResponse.json({ error: "Unknown priority." }, { status: 400 });
  }

  const now = new Date().toISOString();

  // Rupees in, paise stored — every money column in this database is paise, and
  // a form that took paise would be a data-entry mistake waiting to happen.
  const amountPaise = Math.round(amountRupees * 100);

  const row = {
    buyer_name: buyerName,
    buyer_phone: phone,
    buyer_email: str(body.buyer_email) || null,
    house_name: houseName,
    door_no: doorNo || null,
    address_type: addrType,
    address_line1: addressLine1,
    address_line2: str(body.address_line2) || null,
    city,
    district: str(body.district) || null,
    state,
    pincode,
    quantity,
    amount_paise: amountPaise,

    // Paid immediately unless this is COD — then the money is not in hand yet
    // and stays 'pending' until collectCodPayment() flips it, at the moment
    // the courier hands the parcel over (see lib/db/delivery.ts). Confirmed
    // either way, because both are a real parcel waiting to be routed — a COD
    // sale is a confirmed commitment, not a maybe.
    payment_status: isCod ? "pending" : "paid",
    status: "confirmed",
    delivery_mode: deliveryModeInput,

    // Routed at the counter by the person who already knows the answer, so it
    // reaches the delivery queue as "Routed — with a courier" rather than as
    // one more parcel somebody has to decide about. `courier_assigned_at` is
    // stamped with it (0057) — the two are one fact, and a courier with no
    // date on it is a row the queue cannot age.
    courier_id: courierId || null,
    courier_assigned_at: courierId ? now : null,
    delivery_priority: priority,

    sales_channel: "manual",
    // Null on COD: nothing has been paid, so there is no method or reference
    // to record yet. Both get written for real once collectCodPayment() runs.
    manual_payment_method: isCod ? null : method,
    manual_payment_ref: isCod ? null : str(body.manual_payment_ref) || null,
    manual_entered_by: staff.id,
    manual_entered_at: now,

    // Attribution is a separate fact from the channel, and this one is honest:
    // nobody can say which post sent them, so it is recorded as unknown rather
    // than guessed. `source` is deliberately NOT set to "manual" — see 0061.
    source: str(body.source) || "direct",

    // `paid_at` only. `ordered_at` is the column every revenue and delivery
    // screen sorts and filters by, and it is GENERATED ALWAYS AS
    // (COALESCE(paid_at, created_at)) — see migration 0043 — so writing it is
    // not merely redundant, Postgres refuses the whole INSERT:
    //
    //   cannot insert a non-DEFAULT value into column "ordered_at"
    //
    // Which is why no direct sale had ever saved. Setting `paid_at` gives
    // `ordered_at` the same value the line below was trying to force, because
    // for a prepaid direct sale the money landed the moment it was entered.
    //
    // Left null on COD — nothing has landed yet, so `ordered_at` falls back
    // to `created_at` instead, which is honest: this order's date is the day
    // it was confirmed, not a payment date that hasn't happened.
    paid_at: isCod ? null : now,
    address_submitted_at: now,
    checkout_type: "standard",
    is_signed: body.is_signed === true,
    notes: str(body.notes) || null,
    created_at: now,
    updated_at: now,
  };

  // Retry on the astronomically unlikely order-number collision rather than
  // handing the operator a 500 they can do nothing about.
  let inserted: { order_number: string } | null = null;
  let lastError = "";

  for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
    const orderNumber = generateOrderNumber();
    const { data, error } = await supabaseAdmin
      .from("orders")
      .insert({ order_number: orderNumber, ...row })
      .select("order_number")
      .maybeSingle();

    if (data) {
      inserted = data as { order_number: string };
      break;
    }
    lastError = error?.message ?? "";
    // 23505 is a unique violation — a clashed order number, worth another go.
    // Anything else is a real problem and retrying it just wastes time.
    if (error && error.code !== "23505") break;
  }

  if (!inserted) {
    console.error("[ManualOrder] insert failed:", lastError);
    return NextResponse.json(
      { error: `Could not save the order: ${lastError || "unknown error"}` },
      { status: 500 }
    );
  }

  // India Post, routed at the counter: give it an article number on the spot,
  // the same moment the routing screen does it (see /api/admin/delivery/courier).
  // Never fails the sale — a parcel routed with the allotment empty is still a
  // parcel, and the portal's Allot button picks it up once a range is loaded.
  if (routedCourier?.config?.tracking === "india-post") {
    try {
      await allocateBarcodes(routedCourier.id, [inserted.order_number]);
    } catch (e) {
      console.warn("[ManualOrder] article number not allotted:", e);
    }
  }

  await audit({
    actor: staff,
    action: "order.manual_created",
    entity: "order",
    entityId: inserted.order_number,
    meta: {
      amount_paise: amountPaise,
      quantity,
      delivery_mode: deliveryModeInput,
      payment_method: isCod ? null : method,
      payment_ref: isCod ? null : str(body.manual_payment_ref) || null,
      // Both, because both are decisions somebody made at the counter rather
      // than facts about the sale — and "who marked this urgent?" is exactly
      // the question the history strip exists to answer.
      courier_id: courierId || null,
      delivery_priority: priority,
    },
  });

  // The same notification an online order gets when its payment lands —
  // skipped on COD, because that template says an amount was paid, and on a
  // COD sale nothing has been. There is no automated equivalent yet; staff
  // send the cod_pending message from lib/wa-message.ts by hand until there
  // is one. Fired after the response so a slow WhatsApp call cannot make
  // saving the order look like it failed — and never awaited, because a
  // message that does not send is not a reason to lose a parcel that does
  // exist.
  if (!isCod) {
    notifyAfterResponse(inserted.order_number, "confirmed");
  }

  return NextResponse.json({ order_number: inserted.order_number });
}

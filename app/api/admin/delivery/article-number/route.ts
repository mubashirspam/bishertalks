export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-auth";
import { portalScope, mayHandle } from "@/lib/delivery/scope";
import { courierOf } from "@/lib/db/delivery-portal";
import { setManualArticleNumber } from "@/lib/db/postal-barcodes";
import { listCouriers } from "@/lib/db/couriers";
import { auditMany } from "@/lib/audit";

/**
 * Type in an article number that did not come from our allotment.
 *
 * The counterpart to /api/admin/delivery/allot-articles, and the case that one
 * cannot serve: the stock ran out, or the parcel was booked at the window and
 * the counter issued its own number. Either way the parcel has a real article
 * number written on a receipt and nothing in our system knows it, so the label
 * prints a blank barcode.
 *
 * Its own route rather than a field on /api/admin/delivery/portal, which is
 * where a tracking number goes, because the two are not the same thing. A
 * tracking number is free text we show the customer; this is a key India Post
 * sorts and delivers against, it is what the label's barcode becomes, and it
 * has a check digit that must be right. Refusing a bad one with a reason
 * belongs next to the rule, not inside a route that takes anything.
 *
 * The write and every refusal live in `setManualArticleNumber` — this route is
 * the permission, the scope and the audit trail around it.
 */
export async function POST(request: NextRequest) {
  const auth = await requirePermission("delivery.portal");
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({}));
  const orderNumber = typeof body.order_number === "string" ? body.order_number : "";
  const articleNumber =
    typeof body.article_number === "string" ? body.article_number : "";

  if (!orderNumber) {
    return NextResponse.json({ error: "Missing order_number" }, { status: 400 });
  }

  // Same guard as every other portal write: the order number came from a
  // browser and proves nothing about whose parcel it is.
  const scope = portalScope(auth.staff);
  let parcelCourier: string | null | undefined;
  try {
    parcelCourier = await courierOf(orderNumber);
  } catch {
    return NextResponse.json({ error: "Could not read that parcel." }, { status: 500 });
  }

  if (parcelCourier === undefined) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (!scope.seesEveryone && !mayHandle(scope, parcelCourier)) {
    console.warn(`[Article] ${auth.staff.email} touched out-of-scope ${orderNumber}`);
    return NextResponse.json(
      { error: "That parcel isn't with your delivery partner." },
      { status: 403 }
    );
  }

  // An article number on a parcel that is not going by post is meaningless at
  // best: it would become the label's barcode and send whoever scanned it
  // looking for the parcel in a system that has never held it.
  const couriers = await listCouriers();
  const isPostal =
    !!parcelCourier &&
    couriers.find((c) => c.id === parcelCourier)?.config?.tracking === "india-post";

  if (!isPostal) {
    return NextResponse.json(
      {
        error:
          "That parcel isn't routed to India Post. Article numbers only belong " +
          "to postal parcels.",
      },
      { status: 400 }
    );
  }

  const result = await setManualArticleNumber(orderNumber, articleNumber);

  if (!result.ok) {
    // 409 rather than 400 for a refusal: nothing about the request was
    // malformed, the rule declined it, and the screen shows the reason.
    return NextResponse.json({ error: result.error }, { status: 409 });
  }

  // `source: manual` is the whole point of the row. Six weeks later, "where
  // did this number come from" has two possible answers and only one of them
  // is in the allotment ledger.
  await auditMany(auth.staff, "order.article_number", "order", [orderNumber], {
    article_number: result.barcode,
    source: "manual",
    via: "portal",
  });

  return NextResponse.json({ ok: true, article_number: result.barcode });
}

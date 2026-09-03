export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-auth";
import { portalScope } from "@/lib/delivery/scope";
import { fetchAddressesForSheet } from "@/lib/db/delivery-portal";
import {
  buildLabelSheet,
  labelBarcodeValue,
  postalLabelBarcode,
  postalLabelCaption,
  senderForCourier,
} from "@/lib/shipping-label";
import { listCouriers } from "@/lib/db/couriers";
import { COURIER_SHEET_MAX } from "@/lib/courier-sheet";
import { istToday } from "@/lib/format-date";

/**
 * The ticked parcels as 4x6 thermal labels, one to a page.
 *
 * The portal's third paper option, beside the A4 address sheet and the Excel
 * workbook. The sheet is ten addresses on office paper to be cut up; this is
 * what a label printer is loaded with, and it is what a parcel actually needs:
 * the address at a size readable across a counter, and a barcode the booking
 * counter can scan.
 *
 * ── Why this exists next to /api/admin/delivery/labels ────────────────────
 *
 * That route builds the same PDF from the same builder, and answers to
 * `delivery.print`. This one answers to `delivery.portal`, and the difference
 * is not bureaucratic: a courier partner's login holds the portal without the
 * master queue, so every parcel a partner can see on screen was one they could
 * not print a label for. They were printing the A4 sheet and cutting it up,
 * which is the problem the 4x6 builder was written to remove.
 *
 * Scoped like the address sheet rather than trusting the ids: a partner prints
 * their own courier's parcels whatever order numbers the browser sends.
 *
 * ── What it deliberately does not do ──────────────────────────────────────
 *
 * `/api/admin/delivery/labels` stamps `label_downloaded_at` and writes an
 * audit row, because on the master queue a printed sheet is how a batch
 * becomes someone's job. Nothing here writes: the portal's own rule is that
 * printing is printing (see PortalAddressPdf), reprinting is normal rather
 * than an error, and a parcel's packing state is the agent's tick — not a
 * side effect of a PDF being downloaded.
 */
export async function POST(request: NextRequest) {
  // Every customer's name, mobile and home address, in one file — but the same
  // rows already on the caller's screen, so it answers to the portal's
  // permission rather than the shop-wide export.
  const auth = await requirePermission("delivery.portal");
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({}));

  const orderNumbers: string[] = Array.isArray(body.order_numbers)
    ? [
        ...new Set<string>(
          body.order_numbers.filter((n: unknown): n is string => typeof n === "string")
        ),
      ]
    : [];

  if (!orderNumbers.length) {
    return NextResponse.json({ error: "Nothing selected" }, { status: 400 });
  }
  if (orderNumbers.length > COURIER_SHEET_MAX) {
    return NextResponse.json(
      { error: `One batch takes ${COURIER_SHEET_MAX} parcels at most.` },
      { status: 400 }
    );
  }

  const scope = portalScope(auth.staff);
  const courierId = scope.seesEveryone ? null : scope.courierId;

  if (!scope.seesEveryone && !courierId) {
    return NextResponse.json(
      { error: "Your login isn't linked to a delivery partner yet." },
      { status: 403 }
    );
  }

  let rows;
  try {
    rows = await fetchAddressesForSheet(orderNumbers, courierId, COURIER_SHEET_MAX);
  } catch {
    return NextResponse.json({ error: "Could not load those addresses" }, { status: 500 });
  }

  if (!rows.length) {
    return NextResponse.json(
      { error: "None of those parcels have an address to print." },
      { status: 400 }
    );
  }

  const byId = new Map((await listCouriers()).map((c) => [c.id, c.config]));
  const configOf = (o: { courier_id: string | null }) =>
    o.courier_id ? byId.get(o.courier_id) ?? null : null;

  // The barcode rule is the courier's, not the label's. An India Post parcel
  // carries their article number or no barcode at all — our order number is
  // not a key in their system, and one printed there would scan cleanly at the
  // booking counter and resolve to nothing.
  const barcodeFor = (o: (typeof rows)[number]) =>
    configOf(o)?.tracking === "india-post" ? postalLabelBarcode(o) : labelBarcodeValue(o);

  // A label is stuck to one parcel, so the return address on it is that
  // parcel's courier's — resolved per parcel, the same rule the A4 sheet
  // follows. A Speed Post parcel comes back to the branch it was booked at and
  // a Mubashir Logistic one comes back to Wayanad, and one return address
  // across both sends a failed parcel to a building that never had it.
  //
  // Order is left exactly as `fetchAddressesForSheet` returned it — oldest
  // first — so the stack coming off the printer matches the screen. Grouping
  // by courier would reorder a mixed batch for no gain now that the sender is
  // per parcel.
  // The strip over the barcode carries the contract this parcel is posted
  // under, and only a postal parcel gets one — a Delhivery label saying
  // "INDIA POST PARCEL CONTRACTUAL" would be a lie at whichever counter read it.
  const captionFor = (o: (typeof rows)[number]) =>
    configOf(o)?.tracking === "india-post" ? postalLabelCaption(configOf(o)) : "";

  const pdf = buildLabelSheet(rows, {
    sender: (o) => senderForCourier(configOf(o)),
    barcodeFor,
    captionFor,
    // Labels only. The packing slip is bench paperwork — sign the copy, wrap
    // it, write the card — and this screen belongs to whoever is moving
    // parcels that are already packed. It was putting extra pages in the
    // middle of a stack of stickers, and putting a customer's private gift
    // message through a courier partner's printer. The master queue's own
    // label route still prints them, which is where packing is printed from.
    packingSlips: false,
  });

  // How many labels carry no barcode at all, so the button can say so. A
  // postal parcel with no article number yet prints a blank strip — legible,
  // postable by hand, and not scannable — and the agent needs to know that
  // before the stack is on the counter rather than at it.
  const unbarcoded = rows.filter((o) => !barcodeFor(o).trim()).length;

  // One label, one page — no packing slips here, so the two counts agree.
  const pages = rows.length;

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="labels-${istToday()}-${rows.length}.pdf"`,
      "Cache-Control": "no-store",
      "X-Label-Count": String(rows.length),
      "X-Page-Count": String(pages),
      "X-Missing-Barcode": String(unbarcoded),
    },
  });
}

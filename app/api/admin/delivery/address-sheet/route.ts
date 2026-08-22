export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-auth";
import { portalScope } from "@/lib/delivery/scope";
import { fetchAddressesForSheet } from "@/lib/db/delivery-portal";
import { buildAddressSheet, ADDRESSES_PER_PAGE } from "@/lib/address-sheet";
import { listCouriers } from "@/lib/db/couriers";
import { senderForCourier } from "@/lib/shipping-label";
import { COURIER_SHEET_MAX } from "@/lib/courier-sheet";
import { istToday } from "@/lib/format-date";

/**
 * The ticked parcels as a printable A4 sheet, ten addresses to a page.
 *
 * The paper half of the Excel download. Same rows, same scope, same
 * permission — and one deliberate difference: **this route writes nothing.**
 *
 * No `markCourierEntered`, no audit entry, no status change. Downloading the
 * Excel confirms a batch because that file IS the addresses going into the
 * courier's system; a sheet of paper is a thing somebody carries to a shelf.
 * Making it confirm parcels too would mean a partner who printed a page twice
 * had to have them reopened, and the second print is the normal case — the
 * first one went in the van.
 *
 * Separate from /api/admin/delivery/labels, which answers to `delivery.print`
 * and produces six cut-out parcel labels. A courier partner holds
 * `delivery.portal` and not `delivery.print`, and wants the list rather than
 * the labels.
 */
export async function POST(request: NextRequest) {
  // Every customer's name, mobile and home address, in one file — but the same
  // rows the caller already has on screen, so it answers to the permission the
  // portal does rather than the shop-wide export.
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
      { error: `One sheet takes ${COURIER_SHEET_MAX} parcels at most.` },
      { status: 400 }
    );
  }

  // A partner prints their own courier's parcels whatever order numbers they
  // send. The ids came from a browser; the scope is what decides.
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

  // The return address, per parcel rather than per sheet. Each courier has its
  // own — a failed KKR parcel comes back to KKR's counter, a Speed Post one to
  // the branch it was booked at — and an owner printing across couriers gets a
  // page carrying several. A parcel routed to nobody falls back to the
  // environment default, which is also what an unconfigured partner gets.
  const byId = new Map((await listCouriers()).map((c) => [c.id, c.config]));
  const pdf = buildAddressSheet(rows, (o) =>
    senderForCourier(o.courier_id ? byId.get(o.courier_id) : null)
  );
  const pages = Math.ceil(rows.length / ADDRESSES_PER_PAGE);

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="addresses-${istToday()}.pdf"`,
      // Read by the button, so it can say what came out without parsing a PDF.
      "X-Addresses": String(rows.length),
      "X-Pages": String(pages),
      // Names, mobiles and home addresses. Never cached, anywhere.
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
    },
  });
}

export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-auth";
import { can } from "@/lib/permissions";
import { fetchPickedForCourierSheet, takenReferences } from "@/lib/db/delivery-portal";
import { markCourierEntered } from "@/lib/db/delivery";
import {
  buildCourierSheet,
  referenceCandidates,
  COURIER_SHEET_HEADERS,
  COURIER_SHEET_MAX,
} from "@/lib/courier-sheet";
import { toXLSX } from "@/lib/export";
import { istToday } from "@/lib/format-date";
import { auditMany } from "@/lib/audit";

/**
 * The parcels an agent ticked, as the courier's bulk-upload sheet.
 *
 * This replaces the portal's copy-one-address-at-a-time loop for the couriers
 * that accept a file: the agent picks a batch, uploads this to the courier,
 * and gets that many waybills back in one go.
 *
 * Only new parcels can be on it — paid, assigned, still at Confirmed, and not
 * yet entered with the courier — whatever the browser sends, so a stale page
 * cannot put the same parcel on two sheets. COURIER_SHEET_MAX at most, which
 * is what the grid lets anyone tick and what this confirms in one statement.
 *
 * Downloading IS entering the addresses with the courier, so the batch is
 * confirmed as part of this request, in one statement. That happens *before*
 * the file goes out, deliberately: the sheet and the database have to agree on
 * which reference number each parcel went out under, and a file handed over
 * against a failed write is a file whose references nothing has reserved. If
 * the confirm fails the agent gets an error and no file, which costs them a
 * retry — the same request run again produces the identical sheet.
 */
export async function POST(request: NextRequest) {
  // Every customer's name, mobile and home address, in one file — but the same
  // rows the agent already has on screen, so it answers to the same permission
  // the portal does rather than the shop-wide export.
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

  // An agent gets their own parcels whatever they send; only someone who runs
  // the whole queue is allowed to sheet up somebody else's.
  const agentId = can(auth.staff, "delivery.view") ? null : auth.staff.id;

  let parcels;
  try {
    parcels = await fetchPickedForCourierSheet(orderNumbers, agentId, COURIER_SHEET_MAX);
  } catch {
    return NextResponse.json({ error: "Could not load parcels" }, { status: 500 });
  }

  if (!parcels.length) {
    return NextResponse.json(
      {
        error:
          "None of those parcels can go on a sheet — they may already be with " +
          "the courier. Refresh and try again.",
      },
      { status: 400 }
    );
  }

  // Ask the database which of this batch's possible reference numbers are
  // already in use, then let the builder pick around them. Two customers
  // sharing the last five digits of their mobile is the whole reason for this
  // step: the courier rejects the entire file for one repeated reference.
  let taken: string[];
  try {
    taken = await takenReferences(parcels.flatMap(referenceCandidates));
  } catch {
    return NextResponse.json({ error: "Could not check reference numbers" }, { status: 500 });
  }

  const { rows, references } = buildCourierSheet(parcels, taken);
  const onSheet = parcels.map((p) => p.order_number);

  let confirmed: string[];
  try {
    confirmed = await markCourierEntered(onSheet, references);
  } catch {
    return NextResponse.json(
      { error: "Could not confirm these parcels — nothing was downloaded. Try again." },
      { status: 500 }
    );
  }

  await auditMany(auth.staff, "order.courier_entered", "order", confirmed, {
    entered: true,
    via: "courier-sheet",
  });

  // "Format data" is the sheet name on the courier's own template; their
  // importer has been fed exactly this workbook shape before.
  const file = toXLSX([...COURIER_SHEET_HEADERS], rows, "Format data");
  const filename = `courier-${istToday()}-${rows.length}.xlsx`;

  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      "X-Parcel-Count": String(rows.length),
      // Which of the ticked rows actually made it onto the sheet, so the grid
      // can tick exactly those Confirmed without waiting for a reload — and
      // say so when it is fewer than the agent picked.
      "X-Confirmed": onSheet.join(","),
    },
  });
}

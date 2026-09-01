export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-auth";
import { portalScope } from "@/lib/delivery/scope";
import {
  fetchPickedForCourierSheet,
  fetchPickedForPostalSheet,
  routedCouriersFor,
  takenReferences,
} from "@/lib/db/delivery-portal";
import { listCouriers } from "@/lib/db/couriers";
import { referenceCode } from "@/lib/couriers";
import { markCourierEntered } from "@/lib/db/delivery";
import {
  buildCourierSheet,
  assignReferences,
  referenceCandidates,
  COURIER_SHEET_HEADERS,
  COURIER_SHEET_MAX,
} from "@/lib/courier-sheet";
import {
  buildPostalWorkbook,
  articleProblems,
  senderProblems,
  type PostalParcel,
} from "@/lib/india-post/bulk-sheet";
import { allocateBarcodes, barcodeStock } from "@/lib/db/postal-barcodes";
import { toXLSX, toXLSXWorkbook } from "@/lib/export";
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

  // A partner gets their own courier's parcels whatever order numbers they
  // send; only someone who runs the whole queue may sheet up anybody's.
  //
  // Scoped on the courier since 0047. This used to pass the staff id and match
  // on `assigned_agent_id`, which meant a partner asking for the 314 parcels
  // routed straight to their courier — and shown to them on the same screen —
  // got "none of those parcels can go on a sheet" every time.
  const scope = portalScope(auth.staff);
  const courierId = scope.seesEveryone ? null : scope.courierId;

  // A partner login with no courier linked is scoped to nothing, and nothing is
  // what it gets. Answered here rather than by an empty query so the message
  // says what is actually wrong.
  if (!scope.seesEveryone && !courierId) {
    return NextResponse.json(
      { error: "Your login isn't linked to a delivery partner yet." },
      { status: 403 }
    );
  }

  // A reference is coded for the partner carrying the parcel, and an owner can
  // tick parcels routed to two of them, so the code is resolved per row rather
  // than once for the file.
  const couriers = await listCouriers();
  const codeFor = (p: { courier_id?: string | null }) =>
    referenceCode(couriers.find((c) => c.id === p.courier_id));

  // ── Which kind of file, decided before the parcels are read ──────────────
  //
  // India Post takes a different workbook AND a different answer to "which
  // parcels may go on one" — see fetchPickedForPostalSheet for why the two
  // gates cannot be the same test. So the routing is resolved first, off a
  // two-column lookup, and the right fetch is used rather than the wrong one
  // being run and then filtered.
  let routedTo: Set<string>;
  try {
    routedTo = await routedCouriersFor(orderNumbers);
  } catch {
    return NextResponse.json({ error: "Could not load parcels" }, { status: 500 });
  }

  const postalCourier = couriers.find(
    (c) => routedTo.has(c.id) && c.config?.tracking === "india-post"
  );

  let parcels;
  try {
    parcels = postalCourier
      ? await fetchPickedForPostalSheet(orderNumbers, COURIER_SHEET_MAX, courierId)
      : await fetchPickedForCourierSheet(orderNumbers, null, COURIER_SHEET_MAX, courierId);
  } catch {
    return NextResponse.json({ error: "Could not load parcels" }, { status: 500 });
  }

  if (!parcels.length) {
    return NextResponse.json(
      {
        error: postalCourier
          ? "None of those parcels can go on a booking file — they may already " +
            "have an article number. Refresh and try again."
          : "None of those parcels can go on a sheet — they may already be with " +
            "the courier. Refresh and try again.",
      },
      { status: 400 }
    );
  }

  const courierIds = [...new Set(parcels.map((p) => p.courier_id ?? ""))];

  if (postalCourier) {
    // Delhivery's sheet can carry two partners' parcels because the reference
    // is coded per row. This one cannot: a bulk booking file is uploaded
    // against one contractual account, and the article numbers on it come out
    // of that account's own allotment.
    if (courierIds.length > 1) {
      return NextResponse.json(
        {
          error:
            "An India Post file takes one partner's parcels at a time. " +
            "Filter to Speed Post and download again.",
        },
        { status: 400 }
      );
    }

    // ── The whole file's problems, which no subset of it can escape ────────
    //
    // A missing sender mobile is wrong on every row at once. Refused outright,
    // because there is no batch that would work and the fix is one setting.
    const senderIssues = senderProblems();
    if (senderIssues.length) {
      return NextResponse.json(
        {
          error:
            "India Post would refuse any file until this is set: " +
            `${senderIssues.join(", ")}.`,
        },
        { status: 400 }
      );
    }

    // ── One parcel's problems, which only that parcel need pay for ─────────
    //
    // Checked here rather than left to their uploader: India Post rejects the
    // whole file over one bad row, naming a column and a row number, by which
    // point every parcel in the batch has been packed.
    //
    // A bad row used to refuse the download outright. That made one unfixable
    // address — a landmark that genuinely will not fit in fifty characters —
    // hold up the other thirty-nine parcels, and the agent's only way out was
    // to untick it by hand after reading the message. So the batch is split
    // instead: the sound parcels go on the file and are confirmed, and the bad
    // ones are left exactly as they were.
    //
    // Left as they were is the important half. They keep their place in the
    // queue, unconfirmed and not entered with the courier, so they come back
    // on the next download once the address is fixed. Nothing about them is
    // written, and — because numbers are claimed further down for the parcels
    // actually going on the file — no article number is spent on them.
    //
    // "no article number" is not a reason to skip: numbers are allotted below,
    // after this, and every parcel here is expected to be without one.
    const problemFor = new Map<string, string[]>();
    for (const p of parcels) {
      const problems = articleProblems(p as PostalParcel).filter(
        (x) => x !== "no article number"
      );
      if (problems.length) problemFor.set(p.order_number, problems);
    }

    const skipped = parcels.filter((p) => problemFor.has(p.order_number));
    parcels = parcels.filter((p) => !problemFor.has(p.order_number));

    // Every one of them. There is no file to download, so this is the one case
    // that still answers with the problems rather than a spreadsheet.
    if (!parcels.length) {
      const shown = skipped
        .slice(0, 5)
        .map((b) => `${b.order_number} (${problemFor.get(b.order_number)!.join(", ")})`)
        .join("; ");
      return NextResponse.json(
        {
          error:
            `India Post would refuse every parcel on this file: ${shown}` +
            (skipped.length > 5 ? ` — and ${skipped.length - 5} more.` : ".") +
            " Fix the addresses and download again.",
        },
        { status: 400 }
      );
    }

    // ── Enough numbers for the WHOLE batch, checked before any are spent ──
    //
    // A number leaves the stock the moment it is claimed and never goes back.
    // Allocating first and refusing afterwards would therefore strand parcels:
    // the ones that got a number would hold it, having never been on a file,
    // and the shortfall would have eaten the allotment for nothing.
    //
    // So the count is checked first. It is advisory — two downloads at once
    // could still race past it — but it turns the ordinary case, ticking more
    // parcels than there are numbers, into a message that costs nothing.
    const needing = parcels.filter((p) => !p.postal_barcode).length;

    if (needing) {
      const stock = await barcodeStock(postalCourier.id);
      if (stock.unused < needing) {
        return NextResponse.json(
          {
            error:
              `${needing} of these parcels need an article number and only ` +
              `${stock.unused} ${stock.unused === 1 ? "is" : "are"} left. ` +
              `Nothing was spent — tick ${stock.unused} or fewer, or load the ` +
              "next range India Post allotted under Couriers → Speed Post.",
          },
          { status: 400 }
        );
      }
    }

    // Article numbers come out of a finite allotment and are never returned to
    // it, so they are claimed only once the batch is known to be sound — and
    // after this point a retry is free, because a parcel that already holds a
    // number keeps it.
    let allocated;
    try {
      allocated = await allocateBarcodes(postalCourier.id, parcels.map((p) => p.order_number));
    } catch {
      return NextResponse.json(
        { error: "Could not allot article numbers — nothing was downloaded." },
        { status: 500 }
      );
    }

    if (allocated.shortfall > 0) {
      return NextResponse.json(
        {
          error:
            `${allocated.shortfall} of these parcels have no article number left. ` +
            "Load the next range India Post allotted, under Couriers → Speed Post.",
        },
        { status: 400 }
      );
    }

    const barcodes = new Map(allocated.allocated.map((a) => [a.orderNumber, a.barcode]));

    // Belt as well as braces, and not the same check as the shortfall above.
    // A number can be claimed, then lost between claiming and attaching —
    // another request reached the same parcel first, and ours was marked spent
    // rather than reused. That path leaves the count satisfied and this parcel
    // without a number, and a blank BARCODE NO is the one thing their uploader
    // would take silently: the article would be booked under nothing.
    //
    // Retrying costs no numbers. The parcel that won the race is holding one,
    // and allocateBarcodes hands back what an order already has.
    const missing = parcels.filter((p) => !barcodes.get(p.order_number));
    if (missing.length) {
      return NextResponse.json(
        {
          error:
            `${missing.length} parcel${missing.length === 1 ? "" : "s"} did not get an ` +
            "article number — another download may have been running. Try again.",
        },
        { status: 409 }
      );
    }

    let taken: string[];
    try {
      taken = await takenReferences(
        parcels.flatMap((p) => referenceCandidates(p, codeFor(p)))
      );
    } catch {
      return NextResponse.json({ error: "Could not check reference numbers" }, { status: 500 });
    }

    const references = assignReferences(parcels, taken, codeFor);
    const refFor = new Map(parcels.map((p, i) => [p.order_number, references[i]]));
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
      via: "india-post-sheet",
    });

    const sheets = buildPostalWorkbook(
      parcels.map((p) => ({ ...p, postal_barcode: barcodes.get(p.order_number) ?? "" })),
      refFor
    );
    const file = toXLSXWorkbook(sheets);
    const filename = `india-post-${istToday()}-${parcels.length}.xlsx`;

    return new NextResponse(new Uint8Array(file), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
        "X-Parcel-Count": String(parcels.length),
        "X-Confirmed": onSheet.join(","),
        // Left off the file and left alone. URI-encoded because the reasons
        // carry quotes and em dashes, and a header is ASCII.
        "X-Skipped": skipped.map((p) => p.order_number).join(","),
        "X-Skipped-Why": encodeURIComponent(
          JSON.stringify(
            skipped.slice(0, 5).map((p) => ({
              order: p.order_number,
              problems: problemFor.get(p.order_number) ?? [],
            }))
          )
        ),
      },
    });
  }

  // Ask the database which of this batch's reference numbers are already in
  // use, then let the builder pick around them. Almost always none of them
  // now — a reference is the courier's code plus the order number, and one
  // order has one number — but the courier rejects the entire file over a
  // single repeat, so it is still worth the one query.
  let taken: string[];
  try {
    taken = await takenReferences(
      parcels.flatMap((p) => referenceCandidates(p, codeFor(p)))
    );
  } catch {
    return NextResponse.json({ error: "Could not check reference numbers" }, { status: 500 });
  }

  const { rows, references } = buildCourierSheet(parcels, taken, codeFor);
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

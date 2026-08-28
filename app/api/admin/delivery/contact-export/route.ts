export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-auth";
import { portalScope } from "@/lib/delivery/scope";
import {
  fetchPortalContacts,
  portalTracking,
  portalPacking,
} from "@/lib/db/delivery-portal";
import { fetchStatusContacts, NO_COURIER } from "@/lib/db/courier-status";
import { isHandoverState } from "@/lib/delivery/handover";
import {
  CONTACT_HEADERS,
  contactSheetRow,
  contactFileName,
  type ContactRow,
} from "@/lib/delivery/contacts";
import { toXLSX } from "@/lib/export";
import { istToday } from "@/lib/format-date";

/**
 * A filtered list of parcels, as a spreadsheet. Name, mobile, reference,
 * order number, pincode — and nothing else.
 *
 * Read-only in the strongest sense: it ticks nothing, reserves no reference
 * and hands no parcel to anybody. That is what separates it from
 * /api/admin/delivery/courier-sheet, whose download IS the act of entering a
 * batch with the courier and can therefore only ever be pressed once per
 * parcel. This one can be pressed on any filter, as often as anyone likes, and
 * the file is the same every time.
 *
 * Two callers, two modes, because they ask different questions of different
 * scopes:
 *
 *   portal      whatever the delivery portal is currently filtered to. Answers
 *               to `delivery.portal` and is scoped to the partner's own
 *               courier, exactly as the screen it is downloaded from is.
 *   breakdown   one cell of the dashboard's courier x status table: every paid
 *               order with that courier and that status, cancelled and
 *               unrouted included. That is a wider scope than the portal can
 *               see, so it answers to `orders.export`.
 *
 * A GET rather than a POST, and that is deliberate: the browser hands it the
 * page's own query string, so what is exported cannot drift from what is on
 * screen — there is no second copy of the filter logic to keep in step.
 */

/** A full read, not a page. Well above the whole table; a runaway guard only. */
const MAX_ROWS = 20_000;

export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams;
  const mode = params.get("mode") === "breakdown" ? "breakdown" : "portal";

  // The wider scope needs the permission whose whole description is this file:
  // "Download customer data as CSV/Excel". The portal's own export stays on
  // `delivery.portal` — the same rows the agent already has on screen, which
  // is the reasoning the courier sheet settled on.
  const auth = await requirePermission(mode === "breakdown" ? "orders.export" : "delivery.portal");
  if (!auth.ok) return auth.response;

  let rows: ContactRow[];
  let truncated: boolean;
  let nameParts: (string | null)[];

  try {
    if (mode === "breakdown") {
      const courier = params.get("courier");
      const status = params.get("status");
      ({ rows, truncated } = await fetchStatusContacts(courier || null, status || null));
      nameParts = [
        courier === NO_COURIER ? "unrouted" : courier ? "courier" : null,
        status,
      ];
    } else {
      // The courier off the wire is a request, not a fact. A partner login is
      // pinned to its own courier and cannot widen that by editing the URL —
      // the same rule the portal page itself applies, and the reason this is
      // resolved here rather than trusted from the query string.
      const scope = portalScope(auth.staff);
      if (!scope.seesEveryone && !scope.courierId) {
        return NextResponse.json(
          { error: "Your login isn't linked to a delivery partner yet." },
          { status: 403 }
        );
      }

      const courierId = scope.seesEveryone ? params.get("courier") || null : scope.courierId;
      const status = params.get("status") || undefined;
      const handover = params.get("handover");

      ({ rows, truncated } = await fetchPortalContacts(
        params.get("date") || undefined,
        status,
        // An agent filter is a filter, never a scope — see the portal page.
        scope.seesEveryone ? params.get("agent") || null : null,
        courierId,
        portalTracking(params.get("tracking") ?? undefined),
        isHandoverState(handover) ? handover : null,
        portalPacking(params.get("packing") ?? undefined)
      ));
      nameParts = [status ?? null, params.get("date")];
    }
  } catch (e) {
    console.error("[Export] contact export failed:", e);
    return NextResponse.json({ error: "Could not build the file" }, { status: 500 });
  }

  if (!rows.length) {
    // A 400 rather than an empty workbook. A spreadsheet with a header row and
    // nothing under it looks like a bug in the export; being told the filter
    // matched nothing is the same fact, said usefully.
    return NextResponse.json(
      { error: "Nothing matches those filters — nothing to download." },
      { status: 400 }
    );
  }

  // `truncated` means the pager gave up rather than reaching the end, so the
  // file would be silently short. Refusing beats handing someone a partial
  // customer list they have no way of knowing is partial.
  if (truncated || rows.length > MAX_ROWS) {
    return NextResponse.json(
      {
        error:
          "That's too many parcels to put in one file — narrow the filter " +
          "(a courier, a status or a day) and download it in parts.",
      },
      { status: 400 }
    );
  }

  const file = toXLSX([...CONTACT_HEADERS], rows.map(contactSheetRow), "Parcels");

  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${contactFileName(nameParts, istToday())}"`,
      "Cache-Control": "no-store",
      "X-Parcel-Count": String(rows.length),
    },
  });
}

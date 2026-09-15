export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-auth";
import { can } from "@/lib/permissions";
import { parseReportFilters } from "@/lib/report-filters";
import { fetchReportRows } from "@/lib/db/parcel-report";
import { getStaffById } from "@/lib/db/staff";
import { assignCalls } from "@/lib/db/calls";
import { CALL_ASSIGN_MAX } from "@/lib/calls";

/**
 * Put the reports screen's current filter on somebody's calling list.
 *
 * Takes the page's own query string, like the Excel download beside it, and
 * reads the parcels through the same `report_scope` — so the list assigned is
 * exactly the list on screen, not a second implementation of the filters.
 */
export async function POST(request: NextRequest) {
  const auth = await requirePermission("calls.manage");
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({}));
  const staffId = typeof body.staff_id === "string" ? body.staff_id.trim() : "";
  const label =
    typeof body.label === "string" && body.label.trim() ? body.label.trim().slice(0, 120) : null;

  if (!staffId) {
    return NextResponse.json({ error: "Pick who should make the calls." }, { status: 400 });
  }

  const assignee = await getStaffById(staffId);
  if (!assignee || !assignee.is_active) {
    return NextResponse.json({ error: "Pick an active staff member." }, { status: 400 });
  }
  if (!can(assignee, "calls.view") && !can(assignee, "calls.manage")) {
    return NextResponse.json(
      {
        error: `${assignee.name} doesn't have customer care access — tick "Work your own calling list" for them on the Staff screen first.`,
      },
      { status: 400 }
    );
  }

  const filters = parseReportFilters(
    new URLSearchParams(typeof body.query === "string" ? body.query : "")
  );
  const { rows } = await fetchReportRows(filters);

  if (!rows.length) {
    return NextResponse.json({ error: "No parcels match these filters." }, { status: 400 });
  }
  if (rows.length > CALL_ASSIGN_MAX) {
    return NextResponse.json(
      {
        error: `${rows.length.toLocaleString("en-IN")} parcels match — narrow the filters to ${CALL_ASSIGN_MAX.toLocaleString("en-IN")} or fewer.`,
      },
      { status: 400 }
    );
  }

  const result = await assignCalls(
    rows.map((r) => r.order_number),
    { id: assignee.id, email: assignee.email },
    auth.staff,
    { reassign: body.reassign === true, label }
  );

  if (result.error) {
    return NextResponse.json(
      { error: "Could not assign the calls — has migration 0083 been run?", ...result },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, assignee: assignee.name, ...result });
}

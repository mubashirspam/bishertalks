export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-auth";
import { portalScope } from "@/lib/delivery/scope";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { listCouriers } from "@/lib/db/couriers";
import { allocateBarcodes, barcodeStock } from "@/lib/db/postal-barcodes";
import { COURIER_SHEET_MAX } from "@/lib/courier-sheet";
import { auditMany } from "@/lib/audit";

/**
 * Give the ticked parcels an India Post article number.
 *
 * Routing a parcel to Speed Post allots one automatically (see
 * /api/admin/delivery/courier), so in the ordinary course of things nobody
 * needs this. It exists for the parcels that ordinary course missed:
 *
 *   * everything routed to Speed Post before article numbers existed at all,
 *   * anything routed while the stock was empty, which is every parcel until
 *     the first allotment was loaded,
 *   * a batch where the allotment ran out halfway.
 *
 * All three are the same situation from the agent's side — a parcel with a
 * courier and no number — and all three are fixed by ticking the rows and
 * pressing one button.
 *
 * ── Why this is its own route and writes nothing else ─────────────────────
 *
 * It does not confirm, ship, print or send. It hands out numbers, which is
 * deliberately the smallest possible act: a number is a consumable and it is
 * never returned to stock, so the thing that spends one should do that and
 * nothing else, and should be something a person chose to press.
 *
 * Re-running is free. `allocateBarcodes` gives back the number a parcel
 * already holds rather than spending a second, so a double click, a retry
 * after a timeout, or a batch that overlaps one already done all cost nothing.
 */
export async function POST(request: NextRequest) {
  const auth = await requirePermission("delivery.portal");
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({}));

  const orderNumbers: string[] = Array.isArray(body.order_numbers)
    ? [
        ...new Set<string>(
          body.order_numbers.filter((n: unknown): n is string => typeof n === "string")
        ),
      ].slice(0, COURIER_SHEET_MAX)
    : [];

  if (!orderNumbers.length) {
    return NextResponse.json({ error: "Nothing selected" }, { status: 400 });
  }

  // The scope is the guard, exactly as on the sheet routes: the order numbers
  // came from a browser and prove nothing about whose parcels they are.
  const scope = portalScope(auth.staff);
  const scopedCourier = scope.seesEveryone ? null : scope.courierId;

  if (!scope.seesEveryone && !scopedCourier) {
    return NextResponse.json(
      { error: "Your login isn't linked to a delivery partner yet." },
      { status: 403 }
    );
  }

  // Which of the ticked parcels are actually India Post's, and which already
  // hold a number. Read here rather than trusted from the browser — a parcel
  // routed to Delhivery must never take a postal article number, because that
  // number would then be spent on a parcel the post office will never see.
  let query = supabaseAdmin
    .from("orders")
    .select("order_number,courier_id,postal_barcode")
    .in("order_number", orderNumbers)
    .eq("payment_status", "paid")
    .not("courier_id", "is", null);

  if (scopedCourier) query = query.eq("courier_id", scopedCourier);

  const { data, error } = await query;

  if (error) {
    console.error("[Articles] could not read the batch:", error.message);
    return NextResponse.json({ error: "Could not load those parcels" }, { status: 500 });
  }

  const rows = (data ?? []) as {
    order_number: string;
    courier_id: string;
    postal_barcode: string | null;
  }[];

  const couriers = await listCouriers();
  const postalIds = new Set(
    couriers.filter((c) => c.config?.tracking === "india-post").map((c) => c.id)
  );

  const postal = rows.filter((r) => postalIds.has(r.courier_id));

  if (!postal.length) {
    return NextResponse.json(
      {
        error:
          "None of those parcels are routed to India Post. Article numbers " +
          "only belong to Speed Post parcels.",
      },
      { status: 400 }
    );
  }

  const already = postal.filter((r) => r.postal_barcode).length;
  const needing = postal.filter((r) => !r.postal_barcode);

  if (!needing.length) {
    return NextResponse.json({
      allotted: 0,
      already,
      message: `All ${already} already have an article number.`,
    });
  }

  // One courier at a time: the allotment belongs to a contractual account, and
  // claiming across two accounts in one pass would take numbers from whichever
  // happened to be read first.
  const byCourier = new Map<string, string[]>();
  for (const r of needing) {
    byCourier.set(r.courier_id, [...(byCourier.get(r.courier_id) ?? []), r.order_number]);
  }

  let allotted = 0;
  let shortfall = 0;

  for (const [courierId, numbers] of byCourier) {
    // Checked before anything is spent, for the same reason the workbook
    // download checks it: a number claimed for a parcel in a batch that then
    // half-fails is a number gone for nothing.
    const stock = await barcodeStock(courierId);
    if (stock.unused < numbers.length) {
      // Still allots what there is — unlike the workbook, which needs the
      // whole batch to produce one valid file. Here each parcel stands alone,
      // and forty numbered parcels are better than none.
      shortfall += numbers.length - stock.unused;
    }

    try {
      const result = await allocateBarcodes(courierId, numbers);
      allotted += result.allocated.filter((a) => !!a.barcode).length;
    } catch (e) {
      console.error("[Articles] allotment failed:", e);
      return NextResponse.json(
        {
          error:
            "Could not allot the numbers. Some may have been given out — " +
            "refresh and check before trying again.",
        },
        { status: 500 }
      );
    }
  }

  // Only the ones that actually took a new number, so the trail says what was
  // spent rather than what was ticked.
  const numbered = needing.map((r) => r.order_number);
  await auditMany(auth.staff, "order.article_allotted", "order", numbered, {
    allotted,
    shortfall,
  });

  const parts: string[] = [];
  if (allotted) parts.push(`${allotted} parcel${allotted === 1 ? "" : "s"} given an article number`);
  if (already) parts.push(`${already} already had one`);
  if (shortfall) {
    parts.push(
      `${shortfall} could not be — the allotment is empty. Load the next range ` +
        "under Couriers → Speed Post."
    );
  }

  return NextResponse.json({
    allotted,
    already,
    shortfall,
    message: parts.join(" · ") || "Nothing to do.",
  });
}

export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { parsePostalExport, type PostalRow } from "@/lib/delivery/postal-delivery-import";
import { setDeliveryStatusAt, recordScans, notifyStatusChange } from "@/lib/db/delivery";
import { canMoveTo } from "@/lib/delhivery/status";
import { revalidateDelivery } from "@/lib/db/cache-tags";
import { auditMany } from "@/lib/audit";
import type { OrderStatus } from "@/lib/types/order";

/**
 * India Post's tracking report, reconciled against our parcels.
 *
 * Speed Post is a `manual` courier and their API has never been reachable, so
 * once a parcel is posted over the counter this system never hears about it
 * again. Every one of those parcels sits at "Handed over" forever unless a
 * person ticks it off, which for two thousand parcels does not happen — so the
 * queue fills with work that is already done and the reports screen counts it
 * all as late.
 *
 * Their portal exports the scans as a spreadsheet. This reads it and brings
 * every matching parcel up to date: the status where their event proves the
 * parcel has moved past where we had it, and the scan line on every parcel it
 * recognises whether or not the status changed.
 *
 * ── Most of the value is in the scan line, not the status ──
 *
 * In a full report, most parcels are somewhere in the middle of the journey.
 * Their status here may already be right, but their row says nothing about
 * where the parcel actually is. "Item Dispatched — Kozhikode RMS" on the row is
 * a parcel somebody can stop worrying about; a blank scan column is one they
 * ring the post office about. So every matched parcel gets its latest scan
 * recorded, and the status moves only where it has genuinely fallen behind.
 *
 * ── Two passes, always ──
 *
 * `preview` reads the file and says exactly what it would do, changing nothing.
 * `apply` does it. Same rule as the KKR exception import, and here it matters
 * more: this file can move a thousand orders to delivered in one click, and
 * delivered approves referral commissions.
 *
 * ── Notifications are OFF unless asked for ──
 *
 * Marking a parcel delivered normally messages the customer on WhatsApp. For a
 * backfill that is wrong twice over: the deliveries happened days ago so the
 * message is stale, and a thousand of them at once is the kind of send that
 * costs a business number its rating — which is why `crm.campaign` exists as
 * its own permission. So the default is silence, and telling customers is a
 * deliberate tick with the count shown next to it.
 */

/** Their full report is ~2,000 parcels. Room to spare, and it bounds the work. */
const MAX_PARCELS = 20_000;

/** Uploads are read into memory. A file this size is already implausible. */
const MAX_BYTES = 12 * 1024 * 1024;

/**
 * Keys per lookup query.
 *
 * PostgREST takes these as a URL parameter, and two thousand thirteen-character
 * article numbers is a query string no proxy will accept. Chunked rather than
 * sent as one `in.(...)`, which is also what keeps each response under the
 * 1,000-row cap.
 */
const LOOKUP_CHUNK = 250;

/** Parcels per write. Each is one statement; this only bounds the array size. */
const WRITE_CHUNK = 500;

/** Enough of an order to decide, and to show back to whoever uploaded. */
const COLUMNS =
  "order_number,buyer_name,pincode,status,delivered_at,returned_at," +
  "postal_barcode,tracking_number,courier_reference,courier_id";

interface OrderRow {
  order_number: string;
  buyer_name: string | null;
  pincode: string | null;
  status: string;
  delivered_at: string | null;
  returned_at: string | null;
  postal_barcode: string | null;
  tracking_number: string | null;
  courier_reference: string | null;
  courier_id: string | null;
}

/** One line of the plan, as the screen shows it. */
interface PlanRow {
  order_number: string;
  buyer_name: string | null;
  article: string | null;
  /** Which column matched, so a surprising match can be understood. */
  matched_on: "article" | "waybill" | "reference";
  scan: string;
  at: string | null;
  from_status: string;
  /** Where it moves to, or null when only the scan line is being recorded. */
  to_status: OrderStatus | null;
  /** True when this parcel's article number is being filled in for the first time. */
  fills_tracking: boolean;
}

/** A row that will not be applied, and the reason in plain words. */
interface HeldRow {
  key: string;
  why: string;
}

export async function POST(request: NextRequest) {
  // Not delivery.assign, which the exception import uses. This endpoint can
  // mark parcels delivered and returned, which settles referral money and is
  // the exact capability `delivery.complete` was split out to guard (see
  // lib/permissions.ts).
  const auth = await requirePermission("delivery.complete");
  if (!auth.ok) return auth.response;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Could not read the upload." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file was attached." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB — 12 MB at a time.` },
      { status: 400 }
    );
  }

  const apply = form.get("apply") === "true";
  const notify = form.get("notify") === "true";

  const parsed = parsePostalExport(Buffer.from(await file.arrayBuffer()), file.name);
  if (parsed.error) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  if (!parsed.rows.length) {
    return NextResponse.json({ error: "There are no parcels in that file." }, { status: 400 });
  }
  if (parsed.rows.length > MAX_PARCELS) {
    return NextResponse.json(
      { error: `That file covers ${parsed.rows.length} parcels — ${MAX_PARCELS} at a time.` },
      { status: 400 }
    );
  }

  // ── Find the parcels ──────────────────────────────────────────────────────
  //
  // Three keys, because a Speed Post parcel can be identified three ways and
  // which one works depends on how it was booked. Portal bookings carry our
  // reference; counter bookings carry only the article number, and that number
  // is either one we minted from our own allotment (postal_barcode) or one the
  // counter allotted and somebody typed back in (tracking_number).
  const articles = [...new Set(parsed.rows.map((r) => r.article).filter(Boolean))] as string[];
  const references = [...new Set(parsed.rows.map((r) => r.reference).filter(Boolean))] as string[];

  let found: OrderRow[];
  try {
    found = [
      ...(await lookup("postal_barcode", articles)),
      ...(await lookup("tracking_number", articles)),
      ...(await lookup("courier_reference", references)),
    ];
  } catch (e) {
    console.error("[Postal import] lookup failed:", e);
    return NextResponse.json({ error: "Could not read the orders." }, { status: 500 });
  }

  // One order can arrive from more than one of the three lookups.
  const orders = new Map(found.map((o) => [o.order_number, o]));

  const byBarcode = new Map<string, OrderRow>();
  const byWaybill = new Map<string, OrderRow>();
  const byReference = new Map<string, OrderRow>();
  for (const o of orders.values()) {
    if (o.postal_barcode) byBarcode.set(o.postal_barcode.toUpperCase(), o);
    if (o.tracking_number) byWaybill.set(o.tracking_number.toUpperCase(), o);
    if (o.courier_reference) byReference.set(o.courier_reference.toUpperCase(), o);
  }

  // ── Decide, parcel by parcel ──────────────────────────────────────────────
  const plan: PlanRow[] = [];
  const held: HeldRow[] = [];
  const unmatched: HeldRow[] = [];
  let unchanged = 0;

  /** Guards against one order being written twice from a file naming it twice. */
  const claimed = new Set<string>();

  for (const row of parsed.rows) {
    const hit = match(row, byBarcode, byWaybill, byReference);
    const key = row.article ?? row.reference ?? "(blank row)";

    if (!hit) {
      unmatched.push({
        key,
        why: "no parcel here carries that article number or reference",
      });
      continue;
    }

    const { order, matched_on } = hit;

    if (claimed.has(order.order_number)) {
      held.push({ key, why: `${order.order_number} appears more than once in this file` });
      continue;
    }

    // ── The safety check that earns its keep ────────────────────────────────
    //
    // If the pincode India Post delivered to is not the pincode on the order,
    // the match is probably wrong — an article number reused across allotments,
    // or a reference typed twice. Marking the WRONG order delivered messages
    // the wrong customer, approves a referral commission that was not earned,
    // and hides a parcel that genuinely never arrived. So a mismatch is held
    // back and shown rather than applied, and whoever uploaded decides.
    if (row.pincode && order.pincode && row.pincode !== order.pincode.replace(/\D/g, "")) {
      held.push({
        key,
        why:
          `matches ${order.order_number}, but India Post's destination is ` +
          `${row.pincode} and that order's address is ${order.pincode} — check it by hand`,
      });
      continue;
    }

    // A cancelled parcel that India Post is still moving is a contradiction
    // somebody has to look at, not something to resolve silently in either
    // direction.
    if (order.status === "cancelled") {
      held.push({
        key,
        why: `${order.order_number} is cancelled here, but the post office has it — check it by hand`,
      });
      continue;
    }

    // Forward only. `canMoveTo` is the same guard the courier webhook uses, so
    // a report covering a fortnight cannot un-deliver a parcel that has since
    // arrived, and an event proving less than we already know does nothing.
    const to =
      row.floor && canMoveTo(order.status, row.floor) ? row.floor : null;

    // A parcel we booked through their portal was matched by our own reference
    // and has never had India Post's article number stored — so the customer's
    // tracking page has nothing to look up. Their own file is where it comes
    // from. Never overwritten: a number already there is one somebody is
    // tracking against.
    const fills_tracking = !!row.article && !order.tracking_number;

    claimed.add(order.order_number);

    // Every matched parcel is planned, even one whose status does not move —
    // the scan line is most of the value of this import. Counted separately so
    // the screen can say "1,100 parcels, 340 of which move".
    if (!to) unchanged++;

    plan.push({
      order_number: order.order_number,
      buyer_name: order.buyer_name,
      article: row.article,
      matched_on,
      scan: row.scan,
      at: row.at,
      from_status: order.status,
      to_status: to,
      fills_tracking,
    });
  }

  const moving = plan.filter((p) => p.to_status !== null);

  /** How many parcels move to each status, for the screen and the summary. */
  const moves: Record<string, number> = {};
  for (const p of moving) moves[p.to_status as string] = (moves[p.to_status as string] ?? 0) + 1;

  const summary = {
    fileRows: parsed.total,
    parcels: parsed.rows.length,
    superseded: parsed.superseded,
    kinds: parsed.kinds,
    matched: plan.length,
    willMove: moving.length,
    unchanged,
    moves,
    willFillTracking: plan.filter((p) => p.fills_tracking).length,
    unmatched: unmatched.length,
    held: held.length,
    columns: parsed.matched,
  };

  if (!apply) {
    return NextResponse.json({
      preview: true,
      ...summary,
      // Capped: the point of a preview is to be read, and two thousand rows in
      // a panel is not read. The parcels that MOVE come first, because those
      // are the ones worth checking before pressing the button.
      plan: [...moving, ...plan.filter((p) => p.to_status === null)].slice(0, 100),
      unmatchedRows: unmatched.slice(0, 100),
      heldRows: held.slice(0, 100),
    });
  }

  // ── Apply ─────────────────────────────────────────────────────────────────
  //
  // Scans first, statuses second, and that order matters. A status change can
  // fail on one group and leave the rest untouched; the scan line is the part
  // that is safe to have written either way, and having it written early means
  // a run that dies halfway still leaves every parcel it read more informative
  // than it found them.
  let scanned = 0;
  try {
    for (let i = 0; i < plan.length; i += WRITE_CHUNK) {
      scanned += (
        await recordScans(
          plan.slice(i, i + WRITE_CHUNK).map((p) => ({
            orderNumber: p.order_number,
            scan: p.scan,
            at: p.at,
            // Only where there is not one already — see `fills_tracking`.
            tracking: p.fills_tracking ? p.article : null,
          }))
        )
      ).length;
    }
  } catch (e) {
    console.error("[Postal import] scan write failed:", e);
    return NextResponse.json(
      { error: "Could not record the scans. Nothing else was changed." },
      { status: 500 }
    );
  }

  // Statuses through `setDeliveryStatusAt`, so a parcel marked delivered here
  // settles its referral commission exactly as a tick in the portal does. A
  // spreadsheet is not a reason to bypass the rules — only a reason to record
  // the courier's date rather than ours.
  const done: Record<string, number> = {};
  let notified = 0;

  for (const status of ["shipped", "out_for_delivery", "delivered", "returned"] as OrderStatus[]) {
    const entries = moving
      .filter((p) => p.to_status === status)
      .map((p) => ({ orderNumber: p.order_number, at: p.at }));

    if (!entries.length) continue;

    try {
      for (let i = 0; i < entries.length; i += WRITE_CHUNK) {
        const changed = await setDeliveryStatusAt(entries.slice(i, i + WRITE_CHUNK), status);
        done[status] = (done[status] ?? 0) + changed.length;

        // Only ever on an explicit request. See the note at the top of this
        // file. `notifyStatusChange` itself ignores everything but shipped and
        // delivered, so a return never messages anyone regardless.
        if (notify && changed.length) {
          notified += await notifyStatusChange(changed, status);
        }
      }
    } catch (e) {
      console.error(`[Postal import] ${status} failed:`, e);
      return NextResponse.json(
        {
          error:
            `Scans were recorded, and parcels were moved up to "${status}" before ` +
            "this failed. Run the preview again to see what is left.",
        },
        { status: 500 }
      );
    }
  }

  await auditMany(
    auth.staff,
    "order.postal_reconciled",
    "order",
    plan.map((p) => p.order_number),
    {
      via: "india-post-tracking-export",
      file: file.name,
      scans: scanned,
      moved: done,
      notified,
      unmatched: unmatched.length,
      held: held.length,
    }
  );

  // The queue's cached badge counts parcels that may just have left it.
  revalidateDelivery();

  return NextResponse.json({
    ok: true,
    ...summary,
    scanned,
    moved: done,
    notified,
    unmatchedRows: unmatched.slice(0, 100),
    heldRows: held.slice(0, 100),
  });
}

/**
 * Which order this scan is about, and how we knew.
 *
 * Order of preference is order of confidence. The article number is India
 * Post's own identity for the physical parcel and cannot be anything else; our
 * reference is a label we minted, which a re-route can move. `postal_barcode`
 * comes before `tracking_number` because the first is a number we allotted and
 * printed, and the second is one somebody typed in.
 */
function match(
  row: PostalRow,
  byBarcode: Map<string, OrderRow>,
  byWaybill: Map<string, OrderRow>,
  byReference: Map<string, OrderRow>
): { order: OrderRow; matched_on: PlanRow["matched_on"] } | null {
  if (row.article) {
    const barcode = byBarcode.get(row.article);
    if (barcode) return { order: barcode, matched_on: "article" };

    const waybill = byWaybill.get(row.article);
    if (waybill) return { order: waybill, matched_on: "waybill" };
  }

  if (row.reference) {
    const reference = byReference.get(row.reference);
    if (reference) return { order: reference, matched_on: "reference" };
  }

  return null;
}

/** One column, many values, in chunks small enough for a URL. */
async function lookup(column: string, values: string[]): Promise<OrderRow[]> {
  const out: OrderRow[] = [];

  for (let i = 0; i < values.length; i += LOOKUP_CHUNK) {
    const chunk = values.slice(i, i + LOOKUP_CHUNK);

    const { data, error } = await supabaseAdmin
      .from("orders")
      .select(COLUMNS)
      .in(column, chunk)
      // A parcel is a paid order. An unpaid row sharing an article number is
      // not something this import should be able to mark delivered.
      .eq("payment_status", "paid");

    if (error) throw new Error(`${column}: ${error.message}`);
    out.push(...((data ?? []) as unknown as OrderRow[]));
  }

  return out;
}

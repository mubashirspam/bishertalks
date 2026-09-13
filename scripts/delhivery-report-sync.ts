/**
 * Reconcile order status from a full Delhivery tracking report CSV.
 *
 *   node --env-file=.env.local --experimental-strip-types \
 *     --import ./scripts/alias-loader.mjs \
 *     scripts/delhivery-report-sync.ts <path-to-csv> [--write]
 *
 * WHY THIS EXISTS. delhivery-rto-backfill.ts only reconciles completed RTOs.
 * This is the general case: read every row of a Delhivery tracking export
 * and bring any order that isn't there yet up to what the report says,
 * skipping exactly one thing on purpose — an order already `delivered` in
 * our system is never touched, whatever the CSV says about it, because a
 * hand-ticked or already-settled delivery is not this script's to revisit.
 * (That's a deliberate override of statusFromScan()/canMoveTo()'s normal
 * "a delivered parcel can still come back as an RTO" allowance — this run
 * treats `delivered` as final, full stop.)
 *
 * Dry by default. `--write` is the flag that touches the database.
 *
 * Goes through the same statusFromScan() / canMoveTo() / setDeliveryStatus()
 * pipeline a live courier webhook uses (lib/db/courier-scan.ts), so a status
 * derived from this report cannot drift from what a real-time scan would
 * have done: same forward-only guard, same referral commission settlement,
 * same customer WhatsApp for shipped/delivered.
 */
import { readFileSync } from "fs";
import {
  statusFromScan,
  canMoveTo,
  describeScan,
  type DelhiveryScan,
} from "@/lib/delhivery/status";
import { setDeliveryStatus, notifyStatusChange } from "@/lib/db/delivery";
import { recordScan } from "@/lib/db/courier-send";
import { setReturnReason } from "@/lib/db/delivery-portal";
import { auditMany } from "@/lib/audit";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { OrderStatus } from "@/lib/types/order";

const RED = "\x1b[31m", GREEN = "\x1b[32m", YELLOW = "\x1b[33m",
      DIM = "\x1b[2m", BOLD = "\x1b[1m", OFF = "\x1b[0m";

const WRITE = process.argv.includes("--write");
const csvPath = process.argv[2];

if (!csvPath || csvPath.startsWith("--")) {
  console.error(`${RED}Usage: delhivery-report-sync.ts <path-to-csv> [--write]${OFF}`);
  process.exit(1);
}

interface Row {
  order_number: string;
  status: string;
  buyer_name?: string | null;
  tracking_number?: string | null;
}

/**
 * Delhivery's downloadable CSV report spells `Status Type` out in prose —
 * "RTO Intransit", "Returned" — where their live tracking API's own field for
 * the identical shipment is a short code: "RT". Verified against the API
 * directly (a mid-RTO waybill straight from this same batch came back with
 * `StatusType: "RT"`, not "RTO Intransit").
 *
 * statusFromScan() is written against the API's codes, correctly, and stays
 * that way — this only translates the CSV export's wording into a code it
 * already understands. Missing this made every mid-transit RTO row in a
 * report read as an ordinary forward "in transit" scan instead of "on its
 * way back" — harmless where canMoveTo's backward-move guard happened to
 * block the result, silent everywhere it didn't.
 */
function normaliseStatusType(raw: string): string {
  return /rto|return/i.test(raw) ? "RT" : raw;
}

async function main() {
  console.log(`${BOLD}Delhivery report sync${OFF} ${WRITE ? `${RED}(WRITE MODE)` : `${DIM}(dry run — pass --write to save)`}${OFF}\n`);

  const text = readFileSync(csvPath, "utf-8");
  const lines = text.split("\n").filter(Boolean);
  const headers = lines[0].split(",").map((h) => h.trim());
  const rows = lines.slice(1).map((line) => {
    const cells = line.split(",");
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => (obj[h] = (cells[i] ?? "").trim()));
    return obj;
  });

  console.log(`${rows.length} rows in the file.\n`);

  const orderNumbers = rows.map((r) => r["Order #"]).filter(Boolean);
  const waybills = rows.map((r) => r["Waybill"]).filter(Boolean);

  const [byOrderNumber, byReference, byWaybill] = await Promise.all([
    supabaseAdmin.from("orders").select("order_number,status,buyer_name,tracking_number").in("order_number", orderNumbers),
    supabaseAdmin.from("orders").select("order_number,status,buyer_name,tracking_number,courier_reference").in("courier_reference", orderNumbers),
    supabaseAdmin.from("orders").select("order_number,status,buyer_name,tracking_number").in("tracking_number", waybills),
  ]);

  const byOrderNo = new Map<string, Row>((byOrderNumber.data ?? []).map((o) => [o.order_number, o]));
  const byRef = new Map<string, Row>(
    (byReference.data ?? []).map((o: any) => [o.courier_reference as string, o])
  );
  const byTrack = new Map<string, Row>(
    (byWaybill.data ?? []).map((o: any) => [o.tracking_number as string, o])
  );

  const notFound: string[] = [];
  const skippedDelivered: string[] = [];
  const skippedReshipped: string[] = [];
  const skippedOther: { order_number: string; reason: string }[] = [];
  const noChange: string[] = [];
  const toUpdate: { order_number: string; buyer_name: string | null; from: string; to: OrderStatus; scan: DelhiveryScan; description: string }[] = [];
  // Every matched, non-stale row gets its scan text recorded regardless of
  // whether the status itself moves — same as the live webhook path
  // (applyCarrierScan calls recordScan unconditionally, before it even asks
  // what the scan implies). Without this, a mid-RTO scan that correctly
  // implies "leave the status alone" also left courier_last_scan blank,
  // which is the exact complaint this run exists to fix: an order sitting at
  // Shipped with no visible sign anything had gone wrong.
  const toRecord: { order_number: string; description: string }[] = [];

  for (const row of rows) {
    const key = row["Order #"];
    const waybill = row["Waybill"];
    const match = byOrderNo.get(key) ?? byRef.get(key) ?? byTrack.get(waybill);

    if (!match) {
      notFound.push(`${key} (${waybill})`);
      continue;
    }

    // The order has moved on from the shipment this row describes — reshipped
    // under a new waybill (postal or otherwise) since this report was pulled.
    // This row is history about an attempt that is no longer the current one,
    // and applying it would drag a since-reshipped order back to `returned`
    // on stale data. Matched by tracking number only when the order actually
    // has one on file; an order still waiting to be entered with the courier
    // has none yet and this check does not apply to it.
    if (match.tracking_number && match.tracking_number !== waybill) {
      skippedReshipped.push(
        `${match.order_number}  ${DIM}${match.buyer_name ?? ""} — csv waybill ${waybill}, now tracking ${match.tracking_number}${OFF}`
      );
      continue;
    }

    const scan: DelhiveryScan = {
      status: row["Current Status"] ?? "",
      statusType: normaliseStatusType(row["Status Type"] ?? ""),
      statusDateTime: null,
      location: row["Scan location"] || null,
      instructions: row["Remarks"] || null,
    };
    const description = describeScan(scan);

    // Explicit override, per instruction: an order already delivered in our
    // system is never touched by this run, whatever the report says about
    // it (including a later RTO) — that call is a human's, not this script's.
    if (match.status === "delivered") {
      skippedDelivered.push(`${match.order_number}  ${DIM}${match.buyer_name ?? ""} — csv: ${row["Current Status"]}/${row["Status Type"]}${OFF}`);
      continue;
    }

    toRecord.push({ order_number: match.order_number, description });

    const implied = statusFromScan(scan);
    if (!implied) {
      noChange.push(`${match.order_number}  ${DIM}${match.buyer_name ?? ""} — csv: ${row["Current Status"]}/${row["Status Type"]} (no status implied)${OFF}`);
      continue;
    }

    if (implied === match.status) {
      noChange.push(`${match.order_number}  ${DIM}${match.buyer_name ?? ""} — already ${implied}${OFF}`);
      continue;
    }

    if (!canMoveTo(match.status, implied)) {
      skippedOther.push({
        order_number: match.order_number,
        reason: `${match.status} -> ${implied} not allowed (backwards or terminal)`,
      });
      continue;
    }

    toUpdate.push({
      order_number: match.order_number,
      buyer_name: match.buyer_name ?? null,
      from: match.status,
      to: implied,
      scan,
      description,
    });
  }

  if (notFound.length) {
    console.log(`${RED}Not found in our system (${notFound.length}):${OFF}`);
    for (const n of notFound) console.log(`  ${n}`);
    console.log();
  }

  if (skippedDelivered.length) {
    console.log(`${DIM}Already delivered — left untouched (${skippedDelivered.length}):${OFF}`);
    for (const s of skippedDelivered) console.log(`  ${s}`);
    console.log();
  }

  if (skippedReshipped.length) {
    console.log(`${DIM}Reshipped since this report — left untouched (${skippedReshipped.length}):${OFF}`);
    for (const s of skippedReshipped) console.log(`  ${s}`);
    console.log();
  }

  if (skippedOther.length) {
    console.log(`${YELLOW}Skipped (${skippedOther.length}):${OFF}`);
    for (const s of skippedOther) console.log(`  ${s.order_number}  ${YELLOW}${s.reason}${OFF}`);
    console.log();
  }

  if (noChange.length) {
    console.log(`${DIM}No change needed (${noChange.length}):${OFF}`);
    for (const n of noChange) console.log(`  ${n}`);
    console.log();
  }

  console.log(`${GREEN}To update (${toUpdate.length}):${OFF}`);
  for (const u of toUpdate) {
    console.log(`  ${u.order_number}  ${DIM}${u.buyer_name ?? ""}${OFF}  ${u.from} -> ${BOLD}${u.to}${OFF}  ${DIM}(${u.description})${OFF}`);
  }
  console.log();

  console.log(
    `${DIM}Scan text to record regardless of status (${toRecord.length}) — this is what makes the courier's ` +
      `own wording ("RTO Intransit", "Consignee Unavailable", …) visible on the queue and the portal even ` +
      `when the order's status doesn't move.${OFF}`
  );
  console.log();

  if (!toUpdate.length && !toRecord.length) {
    console.log(`${DIM}Nothing to do.${OFF}`);
    return;
  }

  if (!WRITE) {
    console.log(
      `${DIM}Dry run — nothing written. Re-run with --write to apply ${toUpdate.length} status update(s) ` +
        `and record ${toRecord.length} scan(s).${OFF}`
    );
    return;
  }

  // Record the scan text against every matched, non-stale order first, same
  // as a live webhook does — before, and regardless of, whether it also
  // changes status.
  await Promise.all(toRecord.map((r) => recordScan(r.order_number, r.description, null)));

  if (!toUpdate.length) {
    console.log(`${DIM}No status changes to make.${OFF}`);
    return;
  }

  const byTarget = new Map<OrderStatus, typeof toUpdate>();
  for (const u of toUpdate) {
    if (!byTarget.has(u.to)) byTarget.set(u.to, []);
    byTarget.get(u.to)!.push(u);
  }

  for (const [status, entries] of byTarget) {
    const orderNos = entries.map((e) => e.order_number);
    const updated = await setDeliveryStatus(orderNos, status);
    console.log(`${GREEN}${updated.length} order(s) moved to ${status}.${OFF}`);

    // Why, for a return — same as a live scan (lib/db/courier-scan.ts):
    // onlyIfUnset so an order returned once before keeps that original
    // reason rather than this second RTO quietly overwriting it.
    if (status === "returned") {
      await Promise.all(
        entries.map((e) =>
          setReturnReason(e.order_number, e.description, { onlyIfUnset: true }).catch((err) =>
            console.warn(`${YELLOW}[Sync] return reason not saved for ${e.order_number}:${OFF}`, err)
          )
        )
      );
    }

    await auditMany(null, "order.status", "order", updated, {
      status,
      via: "delhivery-report-sync",
    });

    const notified = await notifyStatusChange(updated, status);
    if (notified) console.log(`${GREEN}${notified} customer(s) notified on WhatsApp for ${status}.${OFF}`);

    const missed = orderNos.filter((n) => !updated.includes(n));
    if (missed.length) {
      console.log(`${RED}Did not update (check by hand): ${missed.join(", ")}${OFF}`);
    }
  }
}

main().catch((e) => {
  console.error(`${RED}Failed:${OFF}`, e);
  process.exit(1);
});

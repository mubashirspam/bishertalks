/**
 * Reconcile RTO-delivered parcels from a Delhivery tracking report CSV.
 *
 *   node --env-file=.env.local --experimental-strip-types \
 *     --import ./scripts/alias-loader.mjs \
 *     scripts/delhivery-rto-backfill.ts <path-to-csv> [--write]
 *
 * WHY THIS EXISTS. statusFromScan() (lib/delhivery/status.ts) only recognised
 * an RTO as complete when the scan's own status TEXT said "delivered" — but
 * Delhivery's real feed never says that. The status word for a completed
 * return is just "RTO"; "Delivered" lives in the separate StatusType field.
 * Every RTO parcel was syncing its scan text (courier_last_scan correctly
 * says "RTO — <location>") without ever actually moving to `returned`,
 * because the one condition that would trigger it never matched. That bug is
 * fixed in lib/delhivery/status.ts; this script is the one-time catch-up for
 * everything it missed while it was broken.
 *
 * Dry by default. `--write` is the flag that touches the database.
 *
 * Only rows the CSV itself calls complete — Current Status "RTO" and Status
 * Type "Delivered" — are touched. Everything still in the return journey
 * (In Transit/Returned, Pending/Returned) is left alone, same as the fixed
 * statusFromScan() would leave it: still out there, not back yet.
 *
 * Goes through setDeliveryStatusAt() — the same function a bulk courier
 * import uses — so the referral commission voids exactly as it would from a
 * live scan, and `returned_at` is stamped from the CSV's own Date column
 * rather than the moment this script happened to run.
 */
import { readFileSync } from "fs";
import { setDeliveryStatusAt, notifyStatusChange } from "@/lib/db/delivery";
import { auditMany } from "@/lib/audit";
import { supabaseAdmin } from "@/lib/supabase/admin";

const RED = "\x1b[31m", GREEN = "\x1b[32m", YELLOW = "\x1b[33m",
      DIM = "\x1b[2m", BOLD = "\x1b[1m", OFF = "\x1b[0m";

const WRITE = process.argv.includes("--write");
const csvPath = process.argv[2];

if (!csvPath || csvPath.startsWith("--")) {
  console.error(`${RED}Usage: delhivery-rto-backfill.ts <path-to-csv> [--write]${OFF}`);
  process.exit(1);
}

/** "28-08-2026 22:18" (DD-MM-YYYY HH:MM, their own report's format) -> ISO. */
function parseReportDate(s: string): string | null {
  const m = s.trim().match(/^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, dd, mm, yyyy, hh, min] = m;
  // IST, same as the rest of this admin reads Delhivery's timestamps.
  return new Date(`${yyyy}-${mm}-${dd}T${hh}:${min}:00+05:30`).toISOString();
}

async function main() {
  console.log(`${BOLD}Delhivery RTO backfill${OFF} ${WRITE ? `${RED}(WRITE MODE)` : `${DIM}(dry run — pass --write to save)`}${OFF}\n`);

  const text = readFileSync(csvPath, "utf-8");
  const lines = text.split("\n").filter(Boolean);
  const headers = lines[0].split(",").map((h) => h.trim());
  const rows = lines.slice(1).map((line) => {
    const cells = line.split(",");
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => (obj[h] = (cells[i] ?? "").trim()));
    return obj;
  });

  const rtoRows = rows.filter(
    (r) => r["Current Status"] === "RTO" && r["Status Type"] === "Delivered"
  );
  console.log(`${rows.length} rows in the file, ${rtoRows.length} are completed RTOs.\n`);

  const orderNumbers = rtoRows.map((r) => r["Order #"]);
  const waybills = rtoRows.map((r) => r["Waybill"]);

  const [byOrderNumber, byReference, byWaybill] = await Promise.all([
    supabaseAdmin.from("orders").select("order_number,status").in("order_number", orderNumbers),
    supabaseAdmin.from("orders").select("order_number,status").in("courier_reference", orderNumbers),
    supabaseAdmin.from("orders").select("order_number,status").in("tracking_number", waybills),
  ]);

  const found = new Map<string, { order_number: string; status: string }>();
  for (const o of byOrderNumber.data ?? []) found.set(o.order_number, o);
  // A courier_reference lookup needs its own key — re-select to know which
  // key each row actually matched under, since courier_reference isn't in
  // the object above. Simplest: look each row up individually below instead.

  const entries: { orderNumber: string; at: string | null }[] = [];
  const skipped: string[] = [];
  const notFound: string[] = [];

  for (const row of rtoRows) {
    const key = row["Order #"];
    let match = found.get(key);
    if (!match) {
      const { data } = await supabaseAdmin
        .from("orders")
        .select("order_number,status")
        .or(`courier_reference.eq.${key},tracking_number.eq.${row["Waybill"]}`)
        .maybeSingle();
      match = data ?? undefined;
    }

    if (!match) {
      notFound.push(key);
      continue;
    }
    if (match.status === "returned") {
      skipped.push(`${match.order_number} (already returned)`);
      continue;
    }
    if (match.status === "delivered" || match.status === "cancelled") {
      // Genuinely unexpected — an RTO on a parcel already delivered or
      // cancelled is a conflict worth a human's eyes, not a silent skip.
      skipped.push(`${match.order_number} (currently ${match.status} — needs a look, not auto-changed)`);
      continue;
    }
    entries.push({ orderNumber: match.order_number, at: parseReportDate(row["Date"]) });
  }

  if (notFound.length) {
    console.log(`${RED}Not found in our system (${notFound.length}):${OFF}`);
    for (const n of notFound) console.log(`  ${n}`);
    console.log();
  }
  if (skipped.length) {
    console.log(`${YELLOW}Skipped (${skipped.length}):${OFF}`);
    for (const s of skipped) console.log(`  ${s}`);
    console.log();
  }

  console.log(`${GREEN}To mark returned (${entries.length}):${OFF}`);
  for (const e of entries) console.log(`  ${e.orderNumber}  ${DIM}${e.at ?? "no date"}${OFF}`);
  console.log();

  if (!entries.length) {
    console.log(`${DIM}Nothing to do.${OFF}`);
    return;
  }

  if (!WRITE) {
    console.log(`${DIM}Dry run — nothing written. Re-run with --write to mark these ${entries.length} returned.${OFF}`);
    return;
  }

  const updated = await setDeliveryStatusAt(entries, "returned");
  console.log(`${GREEN}${updated.length} order(s) marked returned.${OFF}`);

  await auditMany(null, "order.status", "order", updated, {
    status: "returned",
    via: "delhivery-csv-backfill",
  });

  // No-ops for "returned" (NOTIFY_STATUSES doesn't include it) — called
  // anyway so this matches exactly what a live scan does, in case that ever
  // changes.
  await notifyStatusChange(updated, "returned");

  const missed = entries.map((e) => e.orderNumber).filter((n) => !updated.includes(n));
  if (missed.length) {
    console.log(`${RED}Did not update (check by hand): ${missed.join(", ")}${OFF}`);
  }
}

main().catch((e) => {
  console.error(`${RED}Failed:${OFF}`, e);
  process.exit(1);
});

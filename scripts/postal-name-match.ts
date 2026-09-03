/**
 * Find the parcels India Post has that this system cannot name.
 *
 *   node --env-file=.env.local --experimental-strip-types \
 *     --import ./scripts/alias-loader.mjs \
 *     scripts/postal-name-match.ts "<booking export.xlsx>" [--out report.xlsx]
 *
 * WHY THIS EXISTS. A parcel booked over the counter carries the post office's
 * own docket ("1103/1") instead of our reference, and the article number it was
 * given was never recorded here. The tracking import reports every one of those
 * as "matches no parcel here", and they sit at Handed over forever.
 *
 * Their BOOKING export is the way back in: it carries the receiver's name and
 * the destination pincode for every article. This matches those against our
 * orders and writes a spreadsheet saying what it would attach to what.
 *
 * READ ONLY BY DEFAULT. It writes one .xlsx to disk and nothing to the
 * database. The report is for a person to approve, and `--write` is the flag
 * that acts on it.
 *
 * `--write` stores the article number against the matched orders and does
 * NOTHING else — no status is changed, no customer is messaged, no referral is
 * settled. That restraint is deliberate: once the number is stored, the normal
 * tracking upload on /admin/couriers recognises these parcels and carries them
 * through every existing guard, which is a far better path than a one-off
 * script deciding what "delivered" means.
 *
 * Only the clean `matched` rows are written. Ambiguous ones, pincode
 * disagreements and the unpaid matches are reported and left alone, whatever
 * the flag says.
 *
 * The matching rules, and the reason a name alone is never enough, are in
 * lib/delivery/postal-name-match.ts.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { auditMany } from "@/lib/audit";
import { readXLSX, readCSV } from "@/lib/xlsx-read";
import { fetchAllRows } from "@/lib/db/paginate";
import { toXLSXWorkbook } from "@/lib/export";
import { formatIST } from "@/lib/format-date";
import {
  matchBookings,
  normalisePin,
  TIER_LABELS,
  type BookingRow,
  type CandidateOrder,
  type MatchResult,
  type Verdict,
} from "@/lib/delivery/postal-name-match";

// ── Reading their booking export ─────────────────────────────────────────────

const ALIASES: Record<string, string[]> = {
  article: ["article number", "article no", "articleno", "article", "barcode"],
  receiver: ["receiver name", "receivername", "addressee", "consignee", "to name"],
  address: ["receiver address", "receiveraddress", "address", "consignee address"],
  pincode: ["destination pin", "destination pincode", "pincode", "pin", "delivery pin"],
  booked: ["booking date time", "booking date", "bookingdatetime", "booked on"],
  reference: ["customer bulk reference", "bulk reference", "reference", "ref"],
  event: ["event description", "event", "status", "current status"],
};

const norm = (s: string) =>
  s.toLowerCase().replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").trim();

function readBookings(path: string): { rows: BookingRow[]; skipped: number } {
  const buf = readFileSync(path);
  const sheets = /\.(csv|txt)$/i.test(path)
    ? [readCSV(buf.toString("utf8"))]
    : readXLSX(buf).map((s) => s.rows);

  const grid = sheets.find((s) => s.some((r) => r.some((c) => c && c.trim())));
  if (!grid) throw new Error("That workbook has nothing in it.");

  const start = grid.findIndex((r) => r.some((c) => c && c.trim()));
  const headings = grid[start].map((h) => (h ?? "").trim());

  const at: Record<string, number> = {};
  const used = new Set<number>();
  for (const [key, names] of Object.entries(ALIASES)) {
    const i = headings.findIndex((h, j) => !used.has(j) && h && names.includes(norm(h)));
    if (i >= 0) {
      at[key] = i;
      used.add(i);
    }
  }

  if (at.article === undefined || at.receiver === undefined) {
    throw new Error(
      "That file needs an article-number column and a receiver-name column. " +
        `Found: ${headings.filter(Boolean).join(", ")}`
    );
  }

  const cell = (r: string[], key: string) =>
    at[key] === undefined ? "" : (r[at[key]] ?? "").trim();

  const rows: BookingRow[] = [];
  let skipped = 0;

  for (const r of grid.slice(start + 1)) {
    const article = cell(r, "article").toUpperCase().replace(/\s+/g, "");
    const receiverName = cell(r, "receiver");

    // A row with no article number names no parcel, and one with no receiver
    // cannot be matched by the only means this script has.
    if (!/^[A-Z]{2}\d{9}[A-Z]{2}$/.test(article) || !receiverName) {
      if (r.some((c) => c && c.trim())) skipped++;
      continue;
    }

    rows.push({
      article,
      receiverName,
      receiverAddress: cell(r, "address") || null,
      pincode: normalisePin(cell(r, "pincode")),
      bookedAt: cell(r, "booked") || null,
      reference: cell(r, "reference") || null,
      event: cell(r, "event") || null,
    });
  }

  return { rows, skipped };
}

// ── Our side ─────────────────────────────────────────────────────────────────

const COLUMNS =
  "order_number,buyer_name,buyer_phone,pincode,city,status,payment_status,ordered_at," +
  // courier_id decides whether the number may also be written as a waybill —
  // see applyMatches. Forgetting it here once made every parcel look like it
  // was on a non-postal courier, and 460 waybills were silently not written.
  "courier_id,postal_barcode,tracking_number,courier_reference";

/**
 * Every parcel that could be one of these.
 *
 * Addressed, and NOT restricted to paid — which is a deliberate departure from
 * every other screen here, where a parcel is by definition a paid order.
 *
 * India Post is holding a physical book. A booking whose order reads `failed`
 * or `pending` is not a bad match to be filtered away; it is a real parcel
 * posted against an order this system believes was never paid for, and that is
 * one of the most useful things this whole exercise can surface. Restricting
 * the query to paid orders would report those as "no order carries that name",
 * which is both wrong and the opposite of informative. They come back under
 * their own verdict instead.
 *
 * Deliberately NOT narrowed to the Speed Post courier either: a parcel posted
 * at the counter is exactly the kind that was never routed here properly, so
 * filtering on the courier would exclude the rows this script exists to find.
 *
 * Cancelled orders are excluded — a cancelled parcel that India Post is
 * carrying is a contradiction, and attaching an article number to it would
 * bury the contradiction rather than surface it.
 */
async function loadOrders(): Promise<CandidateOrder[]> {
  const { rows, truncated } = await fetchAllRows<CandidateOrder>(
    (from, to) =>
      supabaseAdmin
        .from("orders")
        .select(COLUMNS)
        .not("address_line1", "is", null)
        .neq("status", "cancelled")
        .order("ordered_at", { ascending: true })
        .range(from, to) as never,
    { label: "postal name match" }
  );

  if (truncated) {
    console.warn("! the order read was truncated — the report is partial");
  }
  return rows;
}

// ── The report ───────────────────────────────────────────────────────────────

const VERDICT_WORD: Record<Verdict, string> = {
  already_linked: "Already linked",
  matched: "MATCH — approve",
  matched_unpaid: "MATCH, but the order reads unpaid",
  ambiguous: "Ambiguous — pick by hand",
  pincode_mismatch: "Name only — pincode disagrees",
  no_match: "Not found",
};

const HEADERS = [
  "Verdict",
  "Confidence",
  "Article number",
  "Their receiver name",
  "Our buyer name",
  "Order number",
  "Their pincode",
  "Our pincode",
  "Our city",
  "Order status",
  "Payment",
  "Ordered on (IST)",
  "Booked on",
  "Their reference",
  "Latest event",
  "Their address",
  "Phone",
  "Note",
];

function reportRow(r: MatchResult): unknown[] {
  const o = r.order ?? r.others[0] ?? null;
  return [
    VERDICT_WORD[r.verdict],
    r.tier ? TIER_LABELS[r.tier] : "",
    r.booking.article,
    r.booking.receiverName,
    r.order?.buyer_name ?? (r.others.length ? r.others.map((x) => x.buyer_name).join(" | ") : ""),
    r.order?.order_number ?? (r.others.length ? r.others.map((x) => x.order_number).join(" | ") : ""),
    r.booking.pincode ? `'${r.booking.pincode}` : "",
    o?.pincode ? `'${o.pincode}` : "",
    r.order?.city ?? "",
    r.order?.status ?? "",
    r.order?.payment_status ?? "",
    r.order?.ordered_at ? formatIST(r.order.ordered_at) : "",
    r.booking.bookedAt ?? "",
    r.booking.reference ?? "",
    r.booking.event ?? "",
    r.booking.receiverAddress ?? "",
    r.order?.buyer_phone ? `'${r.order.buyer_phone}` : "",
    r.note,
  ];
}

/**
 * Store the article number against each matched order.
 *
 * TWO COLUMNS, and which ones depends on the courier — see migration 0049,
 * which is emphatic about the difference.
 *
 *   postal_barcode   the article number as a fact about the parcel. Always
 *                    written.
 *   tracking_number  the number as a live waybill. `portal_orders` reads a
 *                    non-empty tracking_number as proof the parcel is with a
 *                    courier, and the tracking poller feeds it to that
 *                    courier's API.
 *
 * The second is written only where the order's courier actually tracks through
 * India Post. Four of these parcels are routed here to KKR Delhivery while
 * having plainly been posted at a post office — a real routing error in our
 * data. Putting a CL…IN number in their tracking_number would hand a postal
 * article to Delhivery's tracking API every time the poller runs. They get the
 * barcode, which is true, and are reported so somebody can re-route them.
 *
 * NOT written to the `postal_barcodes` ledger. That table records numbers
 * minted from OUR allotment ranges and its `range_id` is NOT NULL — these
 * numbers were allotted by the post office at the counter and belong to no
 * range we hold. A fabricated range to make the insert work would corrupt the
 * one table that answers "how many numbers do we have left".
 *
 * Every write is conditional on the barcode still being empty, so running this
 * twice changes nothing the second time and cannot overwrite a number somebody
 * is already tracking against.
 */
async function applyMatches(
  results: MatchResult[],
  postalCourierIds: Set<string>
): Promise<{ written: string[]; barcodeOnly: string[]; skipped: string[] }> {
  const matched = results.filter((r) => r.verdict === "matched" && r.order);

  // ── The repair pass ───────────────────────────────────────────────────────
  //
  // A parcel whose article number we already hold, on a postal courier, with
  // no waybill — and whose article number is in the booking file in front of
  // us, which is India Post confirming they accepted it.
  //
  // That last clause is the whole safety of this. `postal_barcode` alone does
  // NOT mean a parcel was posted: a number is minted from our own allotment at
  // routing time, and between then and the counter it looks up to nothing.
  // Migration 0049 is explicit that the number is copied into `tracking_number`
  // only when India Post accepts the booking, precisely so a row does not read
  // "with courier" on the strength of a number we invented. Appearing in their
  // booking export IS that acceptance, which is why this pass is driven by the
  // file and not by a query for barcode-without-waybill.
  //
  // It exists because a run can leave this half done — the first run of this
  // script did, having failed to read `courier_id` and so believing no parcel
  // was on a postal courier. Making the repair part of the normal pass means
  // running the script again finishes the job rather than reporting nothing
  // to do.
  const needsWaybill = results.filter(
    (r) =>
      r.verdict === "already_linked" &&
      r.order &&
      !r.order.tracking_number &&
      r.order.postal_barcode?.toUpperCase() === r.booking.article &&
      r.order.courier_id &&
      postalCourierIds.has(r.order.courier_id)
  );

  if (needsWaybill.length) {
    console.log(
      `  ${needsWaybill.length} already carry the article number but no waybill — filling those in too`
    );
  }
  matched.push(...needsWaybill);

  const written: string[] = [];
  const barcodeOnly: string[] = [];
  const skipped: string[] = [];

  // Modest concurrency. Each write is conditional on that one row, so they are
  // independent; a hundred at a time would just be rude to the connection pool.
  const BATCH = 20;

  for (let i = 0; i < matched.length; i += BATCH) {
    await Promise.all(
      matched.slice(i, i + BATCH).map(async (r) => {
        const order = r.order!;
        const isPostal = !!order.courier_id && postalCourierIds.has(order.courier_id);

        const patch: Record<string, unknown> = {
          postal_barcode: r.booking.article,
          updated_at: new Date().toISOString(),
        };
        // Only where the courier actually tracks through India Post, and only
        // where there is not a waybill already — one already there belongs to
        // whatever is being tracked against it.
        if (isPostal && !order.tracking_number) {
          patch.tracking_number = r.booking.article;
        }

        const { data, error } = await supabaseAdmin
          .from("orders")
          .update(patch)
          .eq("order_number", order.order_number)
          // Idempotent, and re-runnable to FINISH a partial run: the row must
          // either have no article number yet, or already have this exact one.
          // A row carrying a different number is somebody else's parcel and is
          // never overwritten.
          .or(`postal_barcode.is.null,postal_barcode.eq.${r.booking.article}`)
          .select("order_number");

        if (error) {
          console.error(`  ! ${order.order_number}: ${error.message}`);
          skipped.push(order.order_number);
          return;
        }
        if (!data?.length) {
          // Something else filled it in between the read and the write.
          skipped.push(order.order_number);
          return;
        }

        written.push(order.order_number);
        if (!isPostal) barcodeOnly.push(order.order_number);
      })
    );
    process.stdout.write(`\r  written ${written.length}/${matched.length}…`);
  }
  process.stdout.write("\n");

  if (written.length) {
    await auditMany(null, "order.postal_barcode_matched", "order", written, {
      via: "scripts/postal-name-match.ts",
      matched_on: "receiver name + destination pincode",
    });
  }

  return { written, barcodeOnly, skipped };
}

/** Courier ids whose parcels are tracked through India Post. */
async function postalCouriers(): Promise<Set<string>> {
  const { data } = await supabaseAdmin.from("couriers").select("id,config");
  return new Set(
    ((data ?? []) as { id: string; config: { tracking?: string } | null }[])
      .filter((c) => c.config?.tracking === "india-post")
      .map((c) => c.id)
  );
}

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  const write = args.includes("--write");
  const outFlag = args.indexOf("--out");
  const out =
    outFlag >= 0 && args[outFlag + 1]
      ? args[outFlag + 1]
      : "postal-name-match-report.xlsx";

  if (!file) {
    console.error("Usage: postal-name-match.ts <booking export.xlsx> [--out report.xlsx]");
    process.exit(1);
  }

  console.log(`Reading ${file}`);
  const { rows: bookings, skipped } = readBookings(file);
  console.log(`  ${bookings.length} articles with a receiver name` + (skipped ? `, ${skipped} rows skipped` : ""));

  console.log("Reading our parcels…");
  const orders = await loadOrders();
  console.log(`  ${orders.length} addressed orders (paid and not)`);

  const results = matchBookings(bookings, orders);

  const counts: Record<string, number> = {};
  for (const r of results) counts[r.verdict] = (counts[r.verdict] ?? 0) + 1;

  const tierCounts: Record<string, number> = {};
  for (const r of results) {
    if ((r.verdict === "matched" || r.verdict === "matched_unpaid") && r.tier) {
      tierCounts[r.tier] = (tierCounts[r.tier] ?? 0) + 1;
    }
  }

  console.log("\n─────────────────────────────────────────────");
  for (const v of [
    "already_linked", "matched", "matched_unpaid", "ambiguous",
    "pincode_mismatch", "no_match",
  ] as Verdict[]) {
    console.log(`  ${VERDICT_WORD[v].padEnd(32)} ${counts[v] ?? 0}`);
  }
  if (Object.keys(tierCounts).length) {
    console.log("\n  of the matches:");
    for (const [tier, n] of Object.entries(tierCounts)) {
      console.log(`    ${TIER_LABELS[tier as never].padEnd(50)} ${n}`);
    }
  }
  console.log("─────────────────────────────────────────────\n");

  // One tab per verdict, so approving is reading one sheet rather than
  // filtering someone else's. The matches come first because that is the tab
  // the decision is actually made on.
  const order: Verdict[] = [
    "matched", "matched_unpaid", "ambiguous", "pincode_mismatch",
    "no_match", "already_linked",
  ];

  const sheets = order.map((v) => ({
    name: {
      matched: "Matches to approve",
      matched_unpaid: "Matched but unpaid",
      ambiguous: "Ambiguous",
      pincode_mismatch: "Pincode disagrees",
      no_match: "Not found",
      already_linked: "Already linked",
    }[v],
    headers: HEADERS,
    rows: results.filter((r) => r.verdict === v).map(reportRow),
  }));

  sheets.unshift({
    name: "Summary",
    headers: ["", ""],
    rows: [
      ["Report built", formatIST(new Date().toISOString())],
      ["Booking file", file],
      ["Articles read", bookings.length],
      ["Our parcels considered", orders.length],
      ["", ""],
      ["READ THIS FIRST", ""],
      ["", "Nothing has been changed. This is a proposal."],
      ["", "Every match required the name AND the destination pincode to agree."],
      ["", "A name that matched with a different pincode is NOT a match and is on its own tab."],
      ["", "\"Matched but unpaid\" means a book was posted against an order whose payment never landed here."],
      ["", ""],
      ...order.map((v) => [VERDICT_WORD[v], counts[v] ?? 0]),
      ["", ""],
      ["OF THE MATCHES", ""],
      ...Object.entries(tierCounts).map(([t, n]) => [TIER_LABELS[t as never], n]),
    ] as unknown[][],
  });

  writeFileSync(out, toXLSXWorkbook(sheets));
  console.log(`Report written to ${out}`);

  if (!write) {
    console.log(
      `\nNothing was changed. Re-run with --write to store the article number ` +
        `on the ${counts.matched ?? 0} matched orders.`
    );
    return;
  }

  console.log(`\nWriting the article number to ${counts.matched ?? 0} matched orders…`);
  const { written, barcodeOnly, skipped: notWritten } = await applyMatches(
    results,
    await postalCouriers()
  );

  console.log(`\n  ${written.length} orders now carry their article number`);
  if (barcodeOnly.length) {
    console.log(
      `\n  ! ${barcodeOnly.length} of them are routed to a courier that does NOT ` +
        `track through India Post, so they got the article number but no waybill:`
    );
    for (const n of barcodeOnly) console.log(`      ${n}`);
    console.log("    Re-route these to India Post — Speed Post on /admin/delivery.");
  }
  if (notWritten.length) {
    console.log(`\n  ${notWritten.length} were skipped (already had a number, or the write failed)`);
  }
  console.log(
    "\nNext: upload their tracking report on /admin/couriers. These parcels " +
      "will now be recognised and their status brought up to date."
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

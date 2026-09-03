import { readXLSX, readCSV } from "@/lib/xlsx-read";
import {
  eventKind,
  describeEvent,
  type EventKind,
  type IndiaPostEvent,
} from "@/lib/india-post/status";
import type { OrderStatus } from "@/lib/types/order";

/**
 * Reading India Post's tracking report.
 *
 * Their portal exports the scan events for the contract as a spreadsheet. That
 * file is the answer to a question nothing else here can answer: Speed Post is
 * a `manual` courier and their API has never been reachable, so once a parcel
 * is posted over the counter this system never hears about it again. Every one
 * of those parcels sits at "Handed over" until a person ticks it off, which for
 * two thousand parcels does not happen — so the queue fills with work that is
 * already done and the reports screen counts it all as late.
 *
 * Two shapes of export, and this reads both. One is filtered to deliveries and
 * has a single event per article; the other is the whole picture — booked,
 * inducted, bagged, dispatched, received, held, out for delivery, delivered,
 * returned. The second is the useful one, because most parcels on any given day
 * are somewhere in the middle of that list and every one of them is a parcel
 * somebody would otherwise be chasing.
 *
 * Nothing here writes. It produces a plan; the route decides what to do with
 * it, and the screen shows the plan before anything is applied.
 *
 * ── What this deliberately does not do: invent a second vocabulary ──
 *
 * What each event MEANS is decided by `lib/india-post/status.ts`, which already
 * holds it for the webhook and the tracking poller. This module reads the
 * spreadsheet and hands each row's wording to `eventKind`; it does not pattern
 * match on "delivered" itself. Two copies of India Post's vocabulary is the one
 * thing certain to drift, and the half that drifts is always the one nobody is
 * watching.
 *
 * ── The three things it gets right that a naive reader would not ──
 *
 * 1. THE SAME EVENT CODE MEANS TWO OPPOSITE THINGS. Code 1 is both "Item
 *    Delivered(Addressee)" — it reached the customer — and "Item
 *    Delivered(Sender)" — it came back to us. Only the wording separates them,
 *    and `eventKind` is where that is handled.
 *
 * 2. "Item Redirected" IS NOT A RETURN. It is going to a different address and
 *    is still in transit. A regex looking for "redirect" alongside "return"
 *    reads it as a parcel coming back, which would move a live parcel to
 *    Returned and void the referral commission on it.
 *
 * 3. THE DATE IS THEIRS, NOT NOW. A week of events lands in one file, and their
 *    timestamps carry no zone but are IST. See migration 0059.
 */

/** What each field can be called. India Post's headings are not a contract. */
const COLUMN_ALIASES: Record<string, string[]> = {
  article: [
    "article number", "article no", "articleno", "article",
    "barcode", "consignment", "consignment no", "awb", "tracking",
    "tracking number", "article id",
  ],
  reference: [
    "customer bulk reference", "bulk reference", "customer reference",
    "reference", "reference no", "ref", "ref no",
  ],
  eventCode: ["event code", "eventcode", "status code"],
  eventDescription: [
    "event description", "eventdescription", "event", "status",
    "event desc", "current status", "delivery status",
  ],
  eventDate: [
    "event date time", "event date", "eventdatetime", "event time",
    "delivery date", "delivered on", "status date",
  ],
  eventOffice: ["event office name", "event office", "office", "office name"],
  reason: [
    "non delivery reason description", "non delivery reason",
    "reason", "remarks", "non delivery",
  ],
  destinationPin: [
    "destination pin", "destination pincode", "delivery pin", "pincode",
    "pin", "destination pin code",
  ],
};

/** Lower-case, with punctuation flattened to single spaces. */
const normalise = (s: string) =>
  s.toLowerCase().replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").trim();

export interface PostalRow {
  /** India Post's article number — our first and best key. */
  article: string | null;
  /** Our own reference, if this parcel carries one. Their docket is dropped. */
  reference: string | null;
  /** What their vocabulary says this event is. */
  kind: EventKind;
  /**
   * The least this event proves about where the parcel is, or null to record
   * the scan and change nothing. See `floorFor`.
   */
  floor: OrderStatus | null;
  /** Their wording plus the office, as it will appear on the parcel's row. */
  scan: string;
  /** When it happened, as a UTC ISO instant. Null if unparseable. */
  at: string | null;
  /** The pincode they delivered to, for checking the match is really ours. */
  pincode: string | null;
}

export interface ParsedPostalImport {
  /** One row per article — the latest event for each. */
  rows: PostalRow[];
  /** Which heading we read for each field, so the screen can say what it used. */
  matched: Record<string, string>;
  /** Headings we did not use — useful when one was expected to be. */
  ignored: string[];
  /** Rows in the file, before events were collapsed to one per article. */
  total: number;
  /** Earlier events superseded by a later one for the same parcel. */
  superseded: number;
  /** How many parcels are at each kind of event, for the screen's summary. */
  kinds: Record<string, number>;
  error: string | null;
}

const fail = (error: string): ParsedPostalImport => ({
  rows: [], matched: {}, ignored: [], total: 0, superseded: 0, kinds: {}, error,
});

/**
 * A reference this system could have minted.
 *
 * `SP-UQ6EJP` is ours; `1074/131` is the counter clerk's docket number and
 * belongs to the post office. Matching on the second could only ever produce a
 * false positive, so the shape is checked rather than the value being trusted
 * because it sat in a column called "reference".
 *
 * Deliberately any two-to-four letter code, not just SP: `referenceCode()`
 * derives one per courier, and a parcel re-routed before it was posted can be
 * carrying BISH or ML.
 */
const OUR_REFERENCE = /^[A-Z]{2,4}-[A-Z0-9]{4,}$/;

/** India Post article numbers: two letters, nine digits, two-letter country. */
const ARTICLE = /^[A-Z]{2}\d{9}[A-Z]{2}$/;

/**
 * The least this event proves about where the parcel is.
 *
 * A FLOOR, not a setting, and that is the whole difference between this and
 * `statusFromEvent` in lib/india-post/status.ts. That function answers "what
 * does this scan mean for a parcel I have been following", and for a transit
 * event the honest answer is "nothing new" — the parcel was already Shipped
 * when it was booked.
 *
 * This file is the opposite situation. It describes parcels this system has
 * heard nothing about since they crossed the counter, most of which are still
 * sitting at Confirmed because nobody ticked them off. For those, "Item
 * Dispatched" is not a non-event: it is proof the parcel is inside the postal
 * network, and a parcel inside the postal network has shipped.
 *
 * Nothing here can move a parcel backwards — `canMoveTo` is applied on top and
 * refuses it — so a floor of Shipped on a parcel already Delivered does
 * nothing at all, which is exactly what it should do.
 */
export function floorFor(kind: EventKind): OrderStatus | null {
  switch (kind) {
    // Accepted at the counter: it has left us.
    case "booked":
      return "shipped";

    // Bagged, dispatched, received, held, redirected. All of it is inside the
    // postal network, and all of it proves the same minimum.
    case "in_transit":
      return "shipped";

    // The return journey has begun. The parcel is moving, so it has certainly
    // shipped — but it is NOT `returned` until it is actually back with us,
    // which is the delivery-to-sender event below. Marking it returned here
    // would void the referral commission on a parcel that may yet be
    // delivered on a second attempt.
    case "returning":
      return "shipped";

    case "out_for_delivery":
      return "out_for_delivery";

    case "delivered_to_addressee":
      return "delivered";

    /** A completed return to sender: it is back on our shelf. */
    case "delivered_to_sender":
      return "returned";

    // A delivery whose direction their file does not state. Guessing
    // "delivered" is the expensive half of the guess — it would approve a
    // referral commission on a book that came back — so it is not guessed, the
    // scan is recorded, and a person decides.
    case "delivered_unknown_direction":
    case "unknown":
      return null;
  }
}

/**
 * An Excel date serial as a UTC instant, or null.
 *
 * A workbook stores a date as a number and marks it a date in the cell's
 * format, which `lib/xlsx-read.ts` deliberately does not read — so a column
 * known to hold dates has to try this on a bare number. The range is narrow on
 * purpose: 20000 is 1954 and 80000 is 2119, so a pincode, a quantity or an
 * event code cannot be mistaken for a date, and the lower bound also excludes
 * Excel's phantom 29 February 1900.
 *
 * The serial is a wall-clock IST reading like everything else in this file, so
 * it gets the same correction.
 */
function excelSerial(value: string): string | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 20_000 || n > 80_000) return null;
  // Day 25569 is 1970-01-01 once Excel's phantom leap day is accounted for.
  return new Date(Math.round((n - 25_569) * 86_400_000) - 5.5 * 3_600_000).toISOString();
}

/**
 * Their timestamp as a UTC instant.
 *
 * Their format is `2026/09/03T12:02:37`, with no zone on it — and it is IST,
 * because it is an Indian post office recording an Indian delivery. The zone is
 * therefore supplied explicitly rather than left to `new Date()`, which would
 * read it as the server's local time: on Vercel that is UTC, and every delivery
 * would be recorded 5 hours 30 minutes early. For a parcel delivered before
 * 5:30am IST that lands on the previous day, which is the sort of error that
 * shows up later as a negative delivery time.
 *
 * A trailing zone the file DOES carry is honoured — their `full-dt` column
 * writes `+05:30` explicitly, and re-appending ours would be an error.
 */
export function parsePostalDate(value: string): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;

  const m = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?(Z|[+-]\d{2}:?\d{2})?/.exec(raw);
  if (m) {
    const [, y, mo, d, h = "0", mi = "0", s = "0", zone] = m;
    const pad = (v: string) => v.padStart(2, "0");
    const t = Date.parse(
      `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:${pad(s)}${zone ?? "+05:30"}`
    );
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }

  return excelSerial(raw);
}

/**
 * The sheet worth reading, as `{ heading: value }` rows.
 *
 * The first sheet with anything on it. Their export is one tab called Data;
 * taking the first non-empty one rather than the first one means a workbook
 * that leads with a blank cover tab still works.
 */
function toObjects(rows: string[][]): { headings: string[]; objects: Record<string, string>[] } {
  const first = rows.findIndex((r) => r.some((c) => c && c.trim()));
  if (first < 0) return { headings: [], objects: [] };

  const headings = rows[first].map((h) => (h ?? "").trim());

  const objects = rows.slice(first + 1).flatMap((cells) => {
    if (!cells.some((c) => c && c.trim())) return [];
    const row: Record<string, string> = {};
    headings.forEach((h, i) => {
      if (h) row[h] = (cells[i] ?? "").trim();
    });
    return [row];
  });

  return { headings, objects };
}

/** Turn their file into a plan. Takes their .xlsx, or a .csv saved from it. */
export function parsePostalExport(file: Buffer, filename = ""): ParsedPostalImport {
  let sheets: string[][][];

  try {
    sheets = /\.(csv|txt)$/i.test(filename)
      ? [readCSV(file.toString("utf8"))]
      : readXLSX(file).map((s) => s.rows);
  } catch {
    return fail(
      `"${filename || "That file"}" is not a spreadsheet this can read. ` +
        "Use the Export to Excel from the India Post portal, or a .csv."
    );
  }

  const rowsOfSheet = sheets.find((s) => s.some((r) => r.some((c) => c && c.trim())));
  if (!rowsOfSheet) return fail("That workbook has nothing in it.");

  const { headings, objects } = toObjects(rowsOfSheet);
  if (!headings.length) return fail("That sheet is empty.");
  if (!objects.length) return fail("There is a heading row but no data under it.");

  // Headings resolved by meaning, not position: their exports run to 29 columns
  // and the two we have seen do not carry the same set.
  const matched: Record<string, string> = {};
  const used = new Set<string>();
  for (const [key, aliases] of Object.entries(COLUMN_ALIASES)) {
    const found = headings.find((h) => h && !used.has(h) && aliases.includes(normalise(h)));
    if (found) {
      matched[key] = found;
      used.add(found);
    }
  }

  if (!matched.article && !matched.reference) {
    return fail(
      "That file has no article number and no reference column, so there is " +
        "nothing to match parcels on. Export it again from the India Post " +
        "portal without removing columns."
    );
  }
  if (!matched.eventCode && !matched.eventDescription) {
    return fail(
      "That file says nothing about what happened to each parcel — no event " +
        "code and no event description. Without one of those this cannot tell " +
        "a delivery from a parcel still in transit."
    );
  }

  const get = (row: Record<string, string>, key: string) =>
    matched[key] ? (row[matched[key]] ?? "").trim() : "";

  // ── One row per parcel, the latest event winning ──────────────────────────
  //
  // The delivery-only export has a single row per article and this is a no-op.
  // The full report does not promise that: an export covering a range can carry
  // a parcel's booking on Monday and its delivery on Wednesday, and applying
  // them in file order would leave the parcel at whichever happened to come
  // last in the sheet. Keyed on the article number, which is India Post's own
  // identity for the physical parcel.
  const latest = new Map<string, PostalRow>();
  const ordered: PostalRow[] = [];
  let superseded = 0;

  for (const row of objects) {
    const description = get(row, "eventDescription");
    const code = get(row, "eventCode");
    const office = get(row, "eventOffice");
    const reason = get(row, "reason");

    // Handed to India Post's own vocabulary rather than matched here. The code
    // is deliberately NOT passed: their portal export uses a third set of codes
    // ("DI", "OR", "CL", "1") that neither the webhook nor bulk tracking uses,
    // and `eventKind` reads the wording when no code is given — which is the
    // path built for bulk tracking and is exactly right here. Passing "DI"
    // would fall through their switch to "unknown" and the whole file would
    // change nothing.
    const event: IndiaPostEvent = {
      eventCode: "",
      eventDescription: description || code,
      at: null,
      office: office || null,
      nonDeliveryReason: reason && reason.toLowerCase() !== "delivered" ? reason : null,
    };

    const kind = eventKind(event);
    const article = get(row, "article").toUpperCase().replace(/\s+/g, "");
    const reference = get(row, "reference").toUpperCase().replace(/\s+/g, "");

    const parsedRow: PostalRow = {
      article: ARTICLE.test(article) ? article : null,
      // Their own docket is dropped here rather than at match time, so nothing
      // downstream has to know that column holds two different things.
      reference: OUR_REFERENCE.test(reference) ? reference : null,
      kind,
      floor: floorFor(kind),
      scan: describeEvent(event),
      at: parsePostalDate(get(row, "eventDate")),
      pincode: get(row, "destinationPin").replace(/\D/g, "").slice(0, 6) || null,
    };

    // A row identifying no parcel cannot be collapsed with anything, and is
    // kept so the screen can report it as unmatched rather than losing it.
    const key = parsedRow.article ?? parsedRow.reference;
    if (!key) {
      ordered.push(parsedRow);
      continue;
    }

    const seen = latest.get(key);
    if (!seen) {
      latest.set(key, parsedRow);
      ordered.push(parsedRow);
      continue;
    }

    superseded++;
    // A row with no readable date cannot claim to be later than one that has
    // one — otherwise a single unparseable timestamp would beat the parcel's
    // real history.
    const newer =
      parsedRow.at !== null && (seen.at === null || parsedRow.at > seen.at);
    if (newer) {
      latest.set(key, parsedRow);
      ordered[ordered.indexOf(seen)] = parsedRow;
    }
  }

  const rows = ordered.filter((r) => {
    const key = r.article ?? r.reference;
    return !key || latest.get(key) === r;
  });

  const kinds: Record<string, number> = {};
  for (const r of rows) kinds[r.kind] = (kinds[r.kind] ?? 0) + 1;

  return {
    rows,
    matched,
    ignored: headings.filter((h) => h && !used.has(h)),
    total: objects.length,
    superseded,
    kinds,
    error: null,
  };
}

/**
 * Reading KKR's daily report of what they could not send by Delhivery.
 *
 * They send a spreadsheet. We do not control its shape and should not pretend
 * to: column names will vary, order will vary, extra columns will appear. So
 * the parser identifies columns by what their heading *means* rather than by
 * position, and refuses politely when it cannot find the two it needs.
 *
 * CSV rather than .xlsx on purpose. An .xlsx is a ZIP of XML documents, and
 * reading one properly means a dependency and a parser to keep correct for a
 * file that arrives once a day and that Excel exports as CSV in one click. The
 * simpler format is also the one a human can check by eye before uploading.
 *
 * Nothing here writes. It produces a plan; the route decides what to do with
 * it, and the screen shows it before anything is applied.
 */

import { isPortalStatus } from "@/lib/db/delivery-portal";

/** What we look for, and every heading we will accept for it. */
const COLUMN_ALIASES: Record<string, string[]> = {
  order: ["order", "order no", "order number", "order id", "orderid", "order_no"],
  reference: ["reference", "reference no", "ref", "ref no", "refnum", "bish"],
  mode: ["mode", "transport", "transport mode", "service", "sent by", "courier", "via"],
  tracking: ["tracking", "tracking no", "tracking id", "awb", "waybill", "consignment", "docket"],
  status: ["status", "delivery status", "current status"],
};

/** Their wording for a stage, mapped onto ours. Anything else is left alone. */
const STATUS_WORDS: Record<string, string> = {
  packed: "processing",
  packing: "processing",
  ready: "processing",
  shipped: "shipped",
  dispatched: "shipped",
  "in transit": "shipped",
  intransit: "shipped",
  "out for delivery": "out_for_delivery",
  ofd: "out_for_delivery",
  delivered: "delivered",
  returned: "returned",
  rto: "returned",
};

export interface ImportRow {
  /** Which of ours it matches, once resolved. */
  orderNumber: string | null;
  reference: string | null;
  mode: string | null;
  tracking: string | null;
  /** One of our OrderStatus values, or null to leave the status alone. */
  status: string | null;
  /** Why this row cannot be used, if it cannot. */
  problem: string | null;
  /** The row as it appeared, for showing back to whoever uploaded it. */
  raw: Record<string, string>;
}

export interface ParsedImport {
  rows: ImportRow[];
  /** Headings we recognised, so the screen can say what it read. */
  matched: Record<string, string>;
  /** Headings we ignored — useful when a column was expected to be used. */
  ignored: string[];
  error: string | null;
}

/** Split a line on commas or tabs, honouring quoted fields. */
function splitLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      // "" inside a quoted field is a literal quote.
      if (c === '"' && line[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) { out.push(field); field = ""; }
    else field += c;
  }
  out.push(field);
  return out.map((f) => f.trim());
}

const normalise = (s: string) => s.toLowerCase().replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * Turn their file into a plan.
 *
 * Needs one column identifying the order — either our order number or the
 * reference we printed on the sheet — and at least one column worth applying.
 * Everything else is optional, because their spreadsheet is theirs.
 */
export function parseExceptionReport(text: string): ParsedImport {
  const clean = text.replace(/^﻿/, "").trim();
  if (!clean) return { rows: [], matched: {}, ignored: [], error: "The file is empty." };

  const lines = clean.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) {
    return { rows: [], matched: {}, ignored: [], error: "There is a heading row but no data under it." };
  }

  // Tabs win when present: a pasted Excel selection is tab-separated, and an
  // address with a comma in it would otherwise be split into pieces.
  const delimiter = lines[0].includes("\t") ? "\t" : ",";
  const headings = splitLine(lines[0], delimiter);

  const matched: Record<string, string> = {};
  const usedIndex = new Set<number>();
  for (const [key, aliases] of Object.entries(COLUMN_ALIASES)) {
    const i = headings.findIndex((h, idx) => !usedIndex.has(idx) && aliases.includes(normalise(h)));
    if (i >= 0) { matched[key] = headings[i]; usedIndex.add(i); }
  }
  const ignored = headings.filter((_, i) => !usedIndex.has(i)).filter(Boolean);

  if (!matched.order && !matched.reference) {
    return {
      rows: [], matched, ignored,
      error:
        "No column identifies the order. One of the headings needs to be an " +
        "order number or a reference number — for example \"Order No\" or " +
        `"Reference". Found: ${headings.filter(Boolean).join(", ") || "nothing"}.`,
    };
  }
  if (!matched.mode && !matched.tracking && !matched.status) {
    return {
      rows: [], matched, ignored,
      error:
        "Nothing in the file would change anything. Expected a column for the " +
        "service used, a tracking number, or a status.",
    };
  }

  const indexOf = (key: string) =>
    matched[key] ? headings.indexOf(matched[key]) : -1;
  const at = (cells: string[], key: string): string | null => {
    const i = indexOf(key);
    const v = i >= 0 ? (cells[i] ?? "").trim() : "";
    return v || null;
  };

  const rows: ImportRow[] = [];
  for (const line of lines.slice(1)) {
    const cells = splitLine(line, delimiter);
    const order = at(cells, "order");
    const reference = at(cells, "reference");
    const rawStatus = at(cells, "status");

    // Their word for the stage, mapped onto ours. An unrecognised word is not
    // an error — it just means the status is left where it is, because
    // guessing at a stage is how a customer gets told the wrong thing.
    let status: string | null = null;
    if (rawStatus) {
      const mapped = STATUS_WORDS[normalise(rawStatus)];
      if (mapped && isPortalStatus(mapped)) status = mapped;
    }

    const raw: Record<string, string> = {};
    headings.forEach((h, i) => { if (h) raw[h] = cells[i] ?? ""; });

    rows.push({
      orderNumber: order,
      reference,
      mode: at(cells, "mode"),
      tracking: at(cells, "tracking"),
      status,
      problem:
        !order && !reference
          ? "no order number or reference on this row"
          : rawStatus && !status
            ? `status "${rawStatus}" not recognised — the stage will be left alone`
            : null,
      raw,
    });
  }

  return { rows, matched, ignored, error: null };
}

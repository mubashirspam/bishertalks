import { STATUS_LABELS as ORDER_STATUS_LABELS } from "@/lib/types/order";

/**
 * The columns a parcel list gets downloaded as.
 *
 * Name, mobile, reference, order number, pincode — plus the order date, its
 * status and which courier has it, and what that courier last scanned, under
 * which waybill. That is what turns a list of people into something you can
 * reconcile against a courier's own sheet: our status and theirs, side by side,
 * with the number to quote when the two disagree.
 *
 * Still deliberately not everything. This is the file somebody opens next to a
 * courier's own form, or sends
 * to a partner who needs to know which parcels are theirs; it is not the
 * courier's bulk-upload sheet (that is `lib/courier-sheet.ts`, which carries
 * the full address and a weight, and whose download *confirms* the batch).
 *
 * Keeping the two apart is the point. Downloading this changes nothing: no
 * parcel is ticked Confirmed, no reference is reserved, nothing is handed to
 * anybody. It can be pressed as often as anyone likes, on any filter, which is
 * exactly what a plain export should be able to promise.
 *
 * No street address here either. These files get mailed around and left in
 * Downloads folders, so the export people reach for most often is the one that
 * carries the least — a pincode places a parcel without giving away where a
 * customer lives.
 */

/**
 * The words the admin uses for a status, not the database's.
 *
 * Imported rather than repeated: `processing` reads as "Packed" on every
 * screen in this panel, and a spreadsheet that called it something else would
 * be the one document nobody could reconcile.
 */
const STATUS_LABELS: Record<string, string> = ORDER_STATUS_LABELS;

export interface ContactRow {
  order_number: string;
  buyer_name: string | null;
  buyer_phone: string | null;
  courier_reference: string | null;
  pincode: string | null;
  /** The day it was paid for, which is the date a customer will quote. */
  ordered_at: string | null;
  status: string;
  /** Resolved to a name in the sheet — an id in a spreadsheet helps nobody. */
  courier_id: string | null;
  /**
   * The courier's own last word on the parcel, and when they said it.
   *
   * Our `status` above is what this business calls the parcel; this is what the
   * courier's network last scanned — "Pending — Aluva_AJNagar_D (Kerala)". They
   * disagree far more often than they agree: only Dispatched, In transit and
   * Delivered move an order, so a parcel sitting at a branch reads Confirmed
   * here and Pending there. Both belong in the file, because reconciling them
   * is the entire reason somebody downloads it.
   */
  courier_last_scan: string | null;
  courier_last_scan_at: string | null;
  /** The courier's number for it. Empty means nothing is tracking this parcel. */
  tracking_number: string | null;
}

/** The columns to select for a ContactRow, for any query that builds one. */
export const CONTACT_COLUMNS =
  "order_number,buyer_name,buyer_phone,courier_reference,pincode," +
  "ordered_at,status,courier_id,courier_last_scan,courier_last_scan_at," +
  "tracking_number";

/** Headings, in the order asked for. */
export const CONTACT_HEADERS = [
  "Name",
  "Mobile",
  "Reference ID",
  "Order Number",
  "Pincode",
  "Order Date",
  "Status",
  "Courier",
  // Appended rather than slotted in beside Reference ID, deliberately: people
  // have formulas and saved filters pointing at the eight columns above, and
  // moving those breaks a file nobody thinks of as an interface.
  "Courier Status",
  // Its own column rather than glued onto the line above. On screen the scan
  // and its time read as one thing; in a spreadsheet a date buried in a text
  // cell is a date nobody can sort by, which is most of what a date is for.
  "Status Updated",
  "Waybill",
];

/**
 * One row, in the same order as the headings.
 *
 * Every cell is a string, mobile and pincode included. They are digit strings,
 * not quantities — nothing is ever added up or averaged — and handing Excel a
 * number means watching it drop the leading zero off a pincode and render a
 * ten-digit mobile as 9.07235E+09. Neither is recoverable by the person who
 * opens the file.
 */
export function contactSheetRow(
  r: ContactRow,
  /** Courier id to name. A row whose courier is unknown says so, not a UUID. */
  courierNames: Map<string, string> = new Map()
): string[] {
  return [
    r.buyer_name ?? "",
    r.buyer_phone ?? "",
    r.courier_reference ?? "",
    r.order_number,
    r.pincode ?? "",
    // The IST calendar day, not the timestamp. Somebody opening this in Excel
    // is matching it against a date on a courier's sheet, and a time to the
    // second is noise that also invites Excel to reinterpret the cell.
    r.ordered_at ? istDay(r.ordered_at) : "",
    STATUS_LABELS[r.status] ?? r.status,
    r.courier_id ? (courierNames.get(r.courier_id) ?? "Unknown courier") : "Not routed",
    // Said plainly rather than left blank. A parcel with no scan and a parcel
    // the courier has never acknowledged look identical in an empty cell, and
    // they need chasing in completely different ways.
    r.courier_last_scan ?? (r.tracking_number ? "No scan yet" : "Not tracked"),
    // With the time, unlike Order Date: a day tells you nothing about whether a
    // parcel has moved since you last looked, which is the question being asked
    // of this column.
    r.courier_last_scan_at ? istMoment(r.courier_last_scan_at) : "",
    r.tracking_number ?? "",
  ];
}

/** "29 Aug 2026, 11:49 pm" in IST — a scan time, where the hour is the point. */
function istMoment(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** "29 Aug 2026" in IST. Stored timestamps are UTC and 5h30m is a whole day. */
function istDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** `parcels-2026-08-28.xlsx`, with whatever the filter was worth naming. */
export function contactFileName(parts: (string | null | undefined)[], today: string): string {
  const slug = parts
    .filter(Boolean)
    .map((p) => String(p).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""))
    .filter(Boolean)
    .join("-");
  return `parcels${slug ? `-${slug}` : ""}-${today}.xlsx`;
}

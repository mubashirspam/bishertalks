/**
 * The five columns a parcel list gets downloaded as.
 *
 * Name, mobile, reference, order number, pincode — and deliberately nothing
 * else. This is the file somebody opens next to a courier's own form, or sends
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

export interface ContactRow {
  order_number: string;
  buyer_name: string | null;
  buyer_phone: string | null;
  courier_reference: string | null;
  pincode: string | null;
}

/** The columns to select for a ContactRow, for any query that builds one. */
export const CONTACT_COLUMNS =
  "order_number,buyer_name,buyer_phone,courier_reference,pincode";

/** Headings, in the order asked for. */
export const CONTACT_HEADERS = [
  "Name",
  "Mobile",
  "Reference ID",
  "Order Number",
  "Pincode",
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
export function contactSheetRow(r: ContactRow): string[] {
  return [
    r.buyer_name ?? "",
    r.buyer_phone ?? "",
    r.courier_reference ?? "",
    r.order_number,
    r.pincode ?? "",
  ];
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

import { PdfDocument, A4, wrapText, measureText, truncate } from "@/lib/pdf";
import { formatIST } from "@/lib/format-date";
import {
  senderFromEnv,
  type LabelOrder,
  type SenderDetails,
} from "@/lib/shipping-label";

/**
 * Addresses, fifteen to an A4 sheet.
 *
 * A denser sibling of `buildLabelSheet`, for a different job. That one prints
 * six parcel labels to be cut out and taped on; this one is what a courier
 * partner takes away — the same addresses as the Excel download, on paper, so
 * a person walking a shelf can work down a page instead of a spreadsheet.
 *
 * Fifteen to a page is why this is a separate file rather than a constant on
 * the other one. At 3x5 a cell is ~189pt wide against ~282pt, and every
 * measurement in the label builder assumes room for a sender block, a contents
 * line and a full-size name. Parameterising it would have meant every one of
 * those growing a branch.
 *
 * The return address is resolved PER PARCEL, not per sheet. Each courier has
 * its own — a parcel that fails at KKR comes back to KKR's counter, one posted
 * through Speed Post to the branch it was booked at — and an owner printing
 * with no courier filter gets a page spanning several. One address stamped
 * across all of them would send failed parcels to a building that never had
 * them. See `senderForCourier` in lib/shipping-label.ts.
 */

const COLS = 3;
const ROWS = 5;
export const ADDRESSES_PER_PAGE = COLS * ROWS;

const MARGIN_X = 14;
const MARGIN_TOP = 12;
const MARGIN_BOTTOM = 22; // leaves the strip the sheet footer sits in

const CELL_W = (A4.width - MARGIN_X * 2) / COLS;
const CELL_H = (A4.height - MARGIN_TOP - MARGIN_BOTTOM) / ROWS;

const PAD_X = 8;
const PAD_Y = 9;
const INNER_W = CELL_W - PAD_X * 2;

/**
 * How many address lines a cell has room for.
 *
 * A hard cap, not a guess: a long address that wrapped freely would run over
 * the FROM block and out of the box, and every cell below it on the page still
 * has to start where it starts. Five rather than four, because a third of the
 * width went to the extra column and the same address now takes more lines.
 *
 * Overflow is truncated at the last line rather than pushed — the pincode and
 * phone below are what the parcel is actually sorted and delivered by, and
 * losing either to a spilled address line is the worse trade.
 */
const MAX_ADDRESS_LINES = 5;

/**
 * The bottom block, measured up from the foot of the cell.
 *
 * Fixed offsets rather than "wherever the address ended". A two-line address
 * and a five-line one would otherwise put the pincode in two different places,
 * and the pincode is the field somebody scans a whole page for — it has to sit
 * on a line your eye can follow straight down.
 */
const FROM_LINE_3 = 11;
const FROM_LINE_2 = 20;
const FROM_LINE_1 = 29;
const FROM_RULE = 37;
const PIN_ROW = 47;

/**
 * FROM, at 8pt over three lines.
 *
 * Bigger than the 7pt it started at, because this is the half of the sheet
 * somebody reads back down a phone when a parcel fails. In a 3-column cell a
 * real return address — name, business, floor, town, pincode, phone — runs to
 * about 120 characters, which does not fit in two lines at any size worth
 * reading. So it got a third line rather than a smaller font.
 */
const FROM_SIZE = 8;
const MAX_FROM_LINES = 3;

/** Resolves the return address for one parcel — usually by its courier. */
export type SenderFor<T> = (order: T) => SenderDetails;

// Generic over the row so a caller can hand in rows carrying more than the
// sheet draws — `courier_id`, in the one caller that resolves the return
// address per parcel — and still have it typed inside the callback.
export function buildAddressSheet<T extends LabelOrder>(
  orders: T[],
  /**
   * One address for the whole sheet, or a function asked per parcel.
   *
   * A plain object is still accepted because most callers have one courier in
   * hand and nothing to look up; the function form is what lets a mixed page
   * print each parcel's own.
   */
  sender: SenderDetails | SenderFor<T> = senderFromEnv()
): Buffer {
  const senderOf: SenderFor<T> = typeof sender === "function" ? sender : () => sender;

  const doc = new PdfDocument();
  const printedAt = formatIST(new Date().toISOString());
  const pageCount = Math.max(1, Math.ceil(orders.length / ADDRESSES_PER_PAGE));

  // Drawn as each page opens: the writer is forward-only, so there is no going
  // back to stamp page numbers once the run is finished — but the run length is
  // known before it starts.
  const openPage = (pageIndex: number) => {
    if (pageIndex > 0) doc.addPage();
    drawSheetFooter(doc, pageIndex + 1, pageCount, orders.length, printedAt);
  };

  openPage(0);

  orders.forEach((order, i) => {
    const slot = i % ADDRESSES_PER_PAGE;
    if (i > 0 && slot === 0) openPage(i / ADDRESSES_PER_PAGE);

    const x = MARGIN_X + (slot % COLS) * CELL_W;
    const y = MARGIN_TOP + Math.floor(slot / COLS) * CELL_H;
    drawAddress(doc, order, senderOf(order), x, y);
  });

  return doc.build();
}

function drawAddress(
  doc: PdfDocument,
  o: LabelOrder,
  sender: SenderDetails,
  x: number,
  y: number
): void {
  box(doc, x, y, CELL_W, CELL_H);

  const left = x + PAD_X;
  const right = x + CELL_W - PAD_X;
  let cy = y + PAD_Y + 7;

  // A parcel is one book unless the order says otherwise. Rows created before
  // the quantity column existed are all single copies.
  const copies = Math.max(1, o.quantity ?? 1);

  // ── Header: what is in the parcel, then which order it is ─────────────────
  // The count prints on every parcel, not only the multi-book ones. A blank
  // where the count should be reads as "no information"; "x1" reads as "one
  // book, checked" — and the packer is looking for the same mark in the same
  // place fifteen times down a page.
  doc.text(left, cy, `x${copies}`, { size: 8.5, bold: true });
  let markerX = left + measureText(`x${copies}`, 8.5, true) + 6;

  const num = o.order_number;
  const numberEdge = right - measureText(num, 7.5, true) - 4;
  doc.text(right - measureText(num, 7.5, true), cy, num, { size: 7.5, bold: true });

  // A drawn box rather than the word GIFT. There is no icon font here — the
  // document ships two Helvetica faces and nothing else — so the glyph is four
  // lines and a ribbon. It survives a bad photocopy better than 6pt text and is
  // findable at a glance down a column of fifteen.
  if (o.is_gift && markerX + 9 < numberEdge) {
    markerX += drawGift(doc, markerX, cy) + 5;
  }

  // Still a word: SIGNED changes what goes IN the box rather than how it is
  // wrapped, and a second drawn glyph beside the first would just be two shapes
  // to learn. Dropped rather than allowed to collide with the order number — an
  // overlap makes both unreadable, which is worse than either alone.
  if (o.is_signed && markerX + measureText("SIGNED", 6.5, true) < numberEdge) {
    doc.text(markerX, cy, "SIGNED", { size: 6.5, bold: true });
  }

  cy += 11;

  // ── TO ────────────────────────────────────────────────────────────────────
  // Labelled, because the cell carries two addresses and the FROM block at the
  // foot is now big enough to be mistaken for the delivery address at arm's
  // length. Naming both ends removes the question.
  doc.text(left, cy, "TO", { size: 6.5, bold: true, gray: 0.45 });
  cy += 9;

  doc.text(left, cy, truncate(o.buyer_name || "—", INNER_W, 9, true), {
    size: 9,
    bold: true,
  });
  cy += 10;

  const street = [o.address_line1, o.address_line2].filter(Boolean).join(", ");
  const town = [o.city, o.district].filter(Boolean).join(", ");
  const region = [town, o.state].filter(Boolean).join(", ");
  const body = [street, region].filter(Boolean).join(", ");

  const lines = wrapText(body, INNER_W, 7.5);
  const shown = lines.slice(0, MAX_ADDRESS_LINES);

  // The last line absorbs the overflow rather than the sheet losing it
  // silently — an ellipsis tells whoever is holding the paper that there is
  // more address on the screen, which is a thing they can act on.
  if (lines.length > MAX_ADDRESS_LINES) {
    shown[MAX_ADDRESS_LINES - 1] = truncate(
      `${shown[MAX_ADDRESS_LINES - 1]} …`,
      INNER_W,
      7.5
    );
  }

  for (const line of shown) {
    doc.text(left, cy, line, { size: 7.5, gray: 0.15 });
    cy += 8.6;
  }

  // ── Pincode and phone: what the parcel is actually sorted by ──────────────
  const footY = y + CELL_H - PIN_ROW;

  if (o.pincode) {
    doc.text(left, footY, `PIN ${o.pincode}`, { size: 9, bold: true });
  }
  if (o.buyer_phone) {
    const phone = `Ph ${o.buyer_phone}`;
    doc.text(right - measureText(phone, 8, true), footY, phone, {
      size: 8,
      bold: true,
    });
  }

  // ── FROM ──────────────────────────────────────────────────────────────────
  // Last, and no longer tiny. It is here because a parcel that cannot be
  // delivered has to come back, and the moment it matters is the moment
  // somebody is squinting at it — so it takes the whole foot of the cell.
  const ruleY = y + CELL_H - FROM_RULE;
  doc.line(left, ruleY, right, ruleY, { gray: 0.85, width: 0.5 });

  doc.text(left, y + CELL_H - FROM_LINE_1 - 8.5, "FROM", {
    size: 6.5,
    bold: true,
    gray: 0.45,
  });

  const from = [sender.name, sender.address, sender.phone && `Ph ${sender.phone}`]
    .filter(Boolean)
    .join(", ");

  const fromLines = wrapText(from, INNER_W, FROM_SIZE).slice(0, MAX_FROM_LINES);
  const fromTops = [FROM_LINE_1, FROM_LINE_2, FROM_LINE_3];

  fromLines.forEach((line, i) => {
    // The last line absorbs anything that did not fit, so an over-long sender
    // ends in an ellipsis rather than silently losing its tail.
    const isLast = i === fromLines.length - 1;
    const text =
      isLast && fromLines.length === MAX_FROM_LINES
        ? truncate(line, INNER_W, FROM_SIZE)
        : line;
    doc.text(left, y + CELL_H - fromTops[i], text, { size: FROM_SIZE, gray: 0.25 });
  });
}

/**
 * A gift box, drawn.
 *
 * Sits on the text baseline at `y`, so it lines up with the header beside it.
 * Returns its width, so the caller advances past it without knowing how it was
 * built.
 */
function drawGift(doc: PdfDocument, x: number, y: number): number {
  const w = 8;
  const h = 7;
  const top = y - h;
  const o = { gray: 0, width: 0.7 };

  doc.line(x, top, x + w, top, o);
  doc.line(x, y, x + w, y, o);
  doc.line(x, top, x, y, o);
  doc.line(x + w, top, x + w, y, o);

  // Ribbon, both ways. This is what stops it reading as a plain rectangle.
  doc.line(x + w / 2, top, x + w / 2, y, o);
  doc.line(x, top + h * 0.38, x + w, top + h * 0.38, o);

  // Bow, above the lid.
  doc.line(x + w / 2, top, x + w / 2 - 2.2, top - 2.4, o);
  doc.line(x + w / 2, top, x + w / 2 + 2.2, top - 2.4, o);

  return w;
}

/** Provenance strip, so a sheet found on a desk can be placed. */
function drawSheetFooter(
  doc: PdfDocument,
  page: number,
  pages: number,
  total: number,
  printedAt: string
): void {
  const y = A4.height - 9;
  doc.text(
    MARGIN_X,
    y,
    `${total} address${total === 1 ? "" : "es"} · printed ${printedAt}`,
    { size: 7, gray: 0.5 }
  );
  const right = `Page ${page} of ${pages}`;
  doc.text(A4.width - MARGIN_X - measureText(right, 7), y, right, {
    size: 7,
    gray: 0.5,
  });
}

/** Cut guide. */
function box(doc: PdfDocument, x: number, y: number, w: number, h: number): void {
  const o = { gray: 0.8, width: 0.5 };
  doc.line(x, y, x + w, y, o);
  doc.line(x, y + h, x + w, y + h, o);
  doc.line(x, y, x, y + h, o);
  doc.line(x + w, y, x + w, y + h, o);
}

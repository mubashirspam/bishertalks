import { PdfDocument, A4, wrapText, measureText, truncate } from "@/lib/pdf";
import { formatIST } from "@/lib/format-date";
import {
  senderFromEnv,
  sheetHeaderFromEnv,
  type LabelOrder,
  type SenderDetails,
  type SheetHeader,
} from "@/lib/shipping-label";

/**
 * Addresses, ten to an A4 sheet — each one a miniature contractual docket.
 *
 * A denser sibling of `buildLabelSheet`, for a different job. That one prints
 * six parcel labels to be cut out and taped on; this one is what a courier
 * partner takes away — the same addresses as the Excel download, on paper, so
 * a person walking a shelf can work down a page instead of a spreadsheet.
 *
 * Every cell carries the whole docket, in the order India Post's contractual
 * sheet has it: the heading, the customer and contract numbers the parcel is
 * booked against, TO, the address, PIN and MOB, the booking reference, then
 * FROM. Repeated ten times rather than printed once at the top of the page,
 * because a cell is a complete document — it gets cut out, handed over and
 * queried on its own, and a customer number that lives at the top of the sheet
 * is not on the piece of paper that travels with the parcel.
 *
 * Two columns, not three. At 3x5 a cell was ~189pt wide and everything in it
 * had to shrink to fit — 7pt headings, 7.5pt addresses — which is legible on a
 * screen and not on a page somebody reads at arm's length in a post office
 * queue. At 2x5 a cell is ~284pt, half as wide again, and every size in it
 * grew by about a third. The height did not change, so the room came from the
 * width: an address that needed four cramped lines now takes three roomy ones,
 * and a return address that needed three takes two.
 *
 * That trade is the whole layout. Fifty parcels is five pages rather than four,
 * which is a sheet of paper against a phone number somebody can actually read.
 *
 * The heading, the numbers and the return address are all resolved PER PARCEL,
 * by courier: a Speed Post parcel prints India Post's contract and comes back
 * to the branch it was booked at, a KKR one prints its own heading and comes
 * back to KKR's counter. A page may hold both, and each cell is right on its
 * own terms. See `sheetHeaderForCourier` and `senderForCourier` in
 * lib/shipping-label.ts.
 */

const COLS = 2;
const ROWS = 5;
export const ADDRESSES_PER_PAGE = COLS * ROWS;

const MARGIN_X = 14;
const MARGIN_TOP = 12;
const MARGIN_BOTTOM = 22; // leaves the strip the sheet footer sits in

const CELL_W = (A4.width - MARGIN_X * 2) / COLS;
const CELL_H = (A4.height - MARGIN_TOP - MARGIN_BOTTOM) / ROWS;

const PAD_X = 10;
const INNER_W = CELL_W - PAD_X * 2;

/**
 * The masthead rows, measured DOWN from the top of the cell.
 *
 * The account band is the one part that moves: "Customer ID: … | Contract ID: …"
 * is ~180pt of the ~264pt a cell now has, so it fits on one line for any real
 * pair of numbers — but a long one still drops to a second. Everything below it
 * starts at a fixed height anyway — see TO_LABEL — so a cell with two ID lines
 * and one beside it with one still put the address in the same place.
 */
const TITLE_ROW = 12;
const TITLE_RULE = 16;
const ACCOUNT_ROW_1 = 24.5;
const ACCOUNT_ROW_2 = 32;
const ACCOUNT_RULE_1 = 28;
const ACCOUNT_RULE_2 = 34;

const TITLE_SIZE = 9;
const ACCOUNT_SIZE = 7.5;

/** The delivery address, also fixed from the top. */
const TO_LABEL = 40;
const TO_SIZE = 8;
const NAME_ROW = 53;
const NAME_SIZE = 12;
const ADDRESS_TOP = 65;
const ADDRESS_STEP = 11.5;
const ADDRESS_SIZE = 10.5;

/**
 * How many address lines a cell has room for.
 *
 * Three, down from four, and it holds about what four used to: the cell is
 * half as wide again, so a line carries ~50 characters at 10.5pt where it
 * carried ~46 at 7.5pt.
 *
 * A hard cap, not a guess: a long address that wrapped freely would run over
 * the pincode and out of the box, and every cell below it on the page still has
 * to start where it starts.
 *
 * Overflow is truncated at the last line rather than pushed — the pincode and
 * phone below are what the parcel is actually sorted and delivered by, and
 * losing either to a spilled address line is the worse trade.
 */
const MAX_ADDRESS_LINES = 3;

/**
 * The bottom block, measured UP from the foot of the cell.
 *
 * Fixed offsets rather than "wherever the address ended". A two-line address
 * and a four-line one would otherwise put the pincode in two different places,
 * and the pincode is the field somebody scans a whole page for — it has to sit
 * on a line your eye can follow straight down.
 */
/**
 * PIN and MOB, side by side on one row, in two columns of equal width.
 *
 * They had a line each, at different sizes, on the theory that a long mobile
 * would collide with the pincode. At 2x5 there is width for both: the cell is
 * ~264pt inside, so each gets ~132pt, and the pair line up down the page in
 * two straight columns your eye can follow — which is what the separate rows
 * were protecting and now costs one row instead of two.
 *
 * The row the merge frees goes straight back into the address above it, which
 * is the part somebody actually has to read off the paper.
 *
 * One size for both, picked from the ladder below: the largest at which each
 * fits its own column. Two mobiles typed into one field — "99471 40490 /
 * 82810 55512" — is the case that needs the smaller steps, and it is why the
 * size is computed rather than fixed.
 */
const CONTACT_ROW = 58;
const CONTACT_SIZES = [11.5, 10.5, 9.5, 8.5] as const;
/** Keeps the two columns apart when the left one runs long. */
const CONTACT_GUTTER = 10;

const REF_DASH = 45;
const REF_ROW = 35;
const REF_SIZE = 9.5;
const FROM_RULE = 30;
const FROM_LINE_1 = 23;
const FROM_LINE_2 = 14;
const FROM_LINE_3 = 5;

/**
 * FROM, at 8pt over up to three lines.
 *
 * This is the half of the cell somebody reads back down a phone when a parcel
 * fails. A real return address — name, business, floor, town, pincode, phone —
 * runs to about 120 characters and now fits in two lines across ~264pt, with
 * the third held in reserve for a longer one.
 *
 * The reserve is not decoration. Cutting this to two lines during the 2x5
 * rework silently dropped the trailing "Ph: 6282680794" off every cell on the
 * sheet — the wrap just ended, with no ellipsis to show it had — which is the
 * one field on a returned parcel that has to be there.
 */
const FROM_SIZE = 8;
const MAX_FROM_LINES = 3;

/** Resolves the return address for one parcel — usually by its courier. */
export type SenderFor<T> = (order: T) => SenderDetails;
/** Resolves the heading and account numbers for one parcel — likewise. */
export type HeaderFor<T> = (order: T) => SheetHeader;

export interface AddressSheet {
  pdf: Buffer;
  /** Pages drawn, so the button can say what is coming without counting. */
  pages: number;
}

// Generic over the row so a caller can hand in rows carrying more than the
// sheet draws — `courier_id`, in the one caller that resolves per parcel — and
// still have it typed inside the callbacks.
export function buildAddressSheet<T extends LabelOrder>(
  orders: T[],
  /**
   * One return address for the whole sheet, or a function asked per parcel.
   *
   * A plain object is still accepted because most callers have one courier in
   * hand and nothing to look up; the function form is what lets a mixed page
   * print each parcel's own.
   */
  sender: SenderDetails | SenderFor<T> = senderFromEnv(),
  /** The masthead, same two forms and the same reasoning. */
  header: SheetHeader | HeaderFor<T> = sheetHeaderFromEnv()
): AddressSheet {
  const senderOf: SenderFor<T> = typeof sender === "function" ? sender : () => sender;
  const headerOf: HeaderFor<T> = typeof header === "function" ? header : () => header;

  const doc = new PdfDocument();
  const printedAt = formatIST(new Date().toISOString());
  const pages = Math.max(1, Math.ceil(orders.length / ADDRESSES_PER_PAGE));

  // Drawn as each page opens: the writer is forward-only, so there is no going
  // back to stamp page numbers once the run is finished — but the run length is
  // known before it starts.
  const openPage = (pageIndex: number) => {
    if (pageIndex > 0) doc.addPage();
    drawSheetFooter(doc, pageIndex + 1, pages, orders.length, printedAt);
  };

  openPage(0);

  orders.forEach((order, i) => {
    const slot = i % ADDRESSES_PER_PAGE;
    if (i > 0 && slot === 0) openPage(i / ADDRESSES_PER_PAGE);

    const x = MARGIN_X + (slot % COLS) * CELL_W;
    const y = MARGIN_TOP + Math.floor(slot / COLS) * CELL_H;
    drawAddress(doc, order, senderOf(order), headerOf(order), x, y);
  });

  return { pdf: doc.build(), pages };
}

function drawAddress(
  doc: PdfDocument,
  o: LabelOrder,
  sender: SenderDetails,
  header: SheetHeader,
  x: number,
  y: number
): void {
  box(doc, x, y, CELL_W, CELL_H);

  const left = x + PAD_X;
  const right = x + CELL_W - PAD_X;

  // -- Heading -------------------------------------------------------------
  // Centred and in capitals, as on the docket it is a small copy of: on a
  // contractual parcel this line is what the counter sorts by before it reads
  // anything else.
  const title = truncate((header.title || "").toUpperCase(), INNER_W, TITLE_SIZE, true);
  doc.text(
    x + (CELL_W - measureText(title, TITLE_SIZE, true)) / 2,
    y + TITLE_ROW,
    title,
    { size: TITLE_SIZE, bold: true }
  );

  doc.line(left, y + TITLE_RULE, right, y + TITLE_RULE, { gray: 0, width: 1 });

  // -- The account the parcel is booked against ----------------------------
  // Printed only when there is one. A partner we simply hand parcels to has no
  // contract, and an empty "Customer ID:" reads as a number somebody forgot to
  // fill in — which is exactly the thing a counter stops on.
  const customer = header.customerId && `Customer ID: ${header.customerId}`;
  const contract = header.contractId && `Contract ID: ${header.contractId}`;
  const oneLine = [customer, contract].filter(Boolean).join("  |  ");

  if (oneLine) {
    // Both numbers on one line where they fit, stacked where they do not. A
    // contract number is not a thing to truncate: it is the field the parcel is
    // charged against, and half of one is worse than none.
    const fits = measureText(oneLine, ACCOUNT_SIZE, true) <= INNER_W;
    const rows = fits ? [oneLine] : [customer, contract].filter(Boolean);

    rows.forEach((row, i) => {
      doc.text(
        left,
        y + (i === 0 ? ACCOUNT_ROW_1 : ACCOUNT_ROW_2),
        truncate(row as string, INNER_W, ACCOUNT_SIZE, true),
        { size: ACCOUNT_SIZE, bold: true }
      );
    });

    const ruleY = rows.length > 1 ? ACCOUNT_RULE_2 : ACCOUNT_RULE_1;
    doc.line(left, y + ruleY, right, y + ruleY, { gray: 0.4, width: 0.4 });
  }

  // -- TO ------------------------------------------------------------------
  // Both ends of the parcel are in this cell and both are addresses; naming
  // them is what stops a hurried reader posting it back to us.
  doc.text(left, y + TO_LABEL, "TO:", { size: TO_SIZE, bold: true, gray: 0.45 });

  doc.text(left, y + NAME_ROW, truncate(o.buyer_name || "—", INNER_W, NAME_SIZE, true), {
    size: NAME_SIZE,
    bold: true,
  });

  // City and district are separate columns and are very often the same word —
  // a Kottayam address sits in Kottayam district — so one is dropped rather
  // than spending a line of a four-line cell saying it twice.
  const district =
    o.district && o.district.trim().toLowerCase() === (o.city ?? "").trim().toLowerCase()
      ? null
      : o.district;

  const street = [o.address_line1, o.address_line2].filter(Boolean).join(", ");
  const region = [[o.city, district].filter(Boolean).join(", "), o.state]
    .filter(Boolean)
    .join(", ");
  const body = [street, region].filter(Boolean).join(", ");

  const lines = wrapText(body, INNER_W, ADDRESS_SIZE);
  const shown = lines.slice(0, MAX_ADDRESS_LINES);

  // The last line absorbs the overflow rather than the sheet losing it
  // silently — an ellipsis tells whoever is holding the paper that there is
  // more address on the screen, which is a thing they can act on.
  if (lines.length > MAX_ADDRESS_LINES) {
    shown[MAX_ADDRESS_LINES - 1] = truncate(
      `${shown[MAX_ADDRESS_LINES - 1]} …`,
      INNER_W,
      ADDRESS_SIZE
    );
  }

  shown.forEach((line, i) => {
    doc.text(left, y + ADDRESS_TOP + i * ADDRESS_STEP, line, {
      size: ADDRESS_SIZE,
      gray: 0.15,
    });
  });

  // -- PIN and MOB: what the parcel is actually sorted and delivered by -----
  // One row, two columns of equal width, spelled the way the docket spells
  // them. See CONTACT_ROW.
  const pinText = o.pincode ? `PIN: ${o.pincode}` : "";
  const mobText = o.buyer_phone ? `MOB: ${o.buyer_phone}` : "";
  const colW = INNER_W / 2;
  const mobX = left + colW;

  // The largest size at which both still sit inside their own column. Shared,
  // so the two read as one row rather than two things that happen to be level.
  const contactSize =
    CONTACT_SIZES.find(
      (size) =>
        measureText(pinText, size, true) <= colW - CONTACT_GUTTER &&
        measureText(mobText, size, true) <= colW
    ) ?? CONTACT_SIZES[CONTACT_SIZES.length - 1];

  const contactY = y + CELL_H - CONTACT_ROW;

  if (pinText) {
    doc.text(left, contactY, pinText, { size: contactSize, bold: true });
  }
  if (mobText) {
    // Truncated only when even the smallest step will not hold it, which takes
    // two full mobile numbers in one field. The first number survives at the
    // front and the ellipsis says there is more on the screen — better than
    // quietly printing a number that is missing its last digits.
    doc.text(mobX, contactY, truncate(mobText, colW, contactSize, true), {
      size: contactSize,
      bold: true,
    });
  }

  // -- Booking reference ---------------------------------------------------
  // The order number is what a query about this parcel comes back as — a
  // customer asks about an order, not a waybill — with what is in the box
  // beside it, because the packer works from this cell too.
  const refY = y + CELL_H - REF_ROW;
  const dashY = y + CELL_H - REF_DASH;
  doc.line(left, dashY, right, dashY, { gray: 0.4, width: 0.5, dash: true });

  doc.text(left, refY, o.order_number, { size: REF_SIZE, bold: true });

  // A parcel is one book unless the order says otherwise. Rows created before
  // the quantity column existed are all single copies. The count prints on
  // every parcel, not only the multi-book ones: a blank where the count should
  // be reads as "no information", "x1" reads as "one book, checked".
  const copies = Math.max(1, o.quantity ?? 1);
  let markerX = left + measureText(o.order_number, REF_SIZE, true) + 9;

  doc.text(markerX, refY, `x${copies}`, { size: REF_SIZE, bold: true });
  markerX += measureText(`x${copies}`, REF_SIZE, true) + 7;

  // A drawn box rather than the word GIFT. There is no icon font here — the
  // document ships two Helvetica faces and nothing else — so the glyph is four
  // lines and a ribbon. It survives a bad photocopy better than 6pt text and is
  // findable at a glance down a column of ten.
  if (o.is_gift && markerX + 11 < right) {
    markerX += drawGift(doc, markerX, refY) + 5;
  }

  // Still a word: SIGNED changes what goes IN the box rather than how it is
  // wrapped, and a second drawn glyph beside the first would just be two shapes
  // to learn. Dropped rather than allowed to run out of the cell.
  if (o.is_signed && markerX + measureText("SIGNED", 7.5, true) < right) {
    doc.text(markerX, refY, "SIGNED", { size: 7.5, bold: true });
  }

  // -- FROM ----------------------------------------------------------------
  // Last, as on the docket. It is here because a parcel that cannot be
  // delivered has to come back, and the moment it matters is the moment
  // somebody is squinting at it — so it takes the whole foot of the cell.
  const ruleY = y + CELL_H - FROM_RULE;
  doc.line(left, ruleY, right, ruleY, { gray: 0.85, width: 0.5 });

  const from = [sender.name, sender.address, sender.phone && `Ph: ${sender.phone}`]
    .filter(Boolean)
    .join(", ");

  // The label shares the first line rather than taking one of its own: three
  // lines of return address is already what a real one needs.
  const labelW = measureText("FROM: ", TO_SIZE, true);
  doc.text(left, y + CELL_H - FROM_LINE_1, "FROM:", {
    size: TO_SIZE,
    bold: true,
    gray: 0.45,
  });

  const [firstLine, ...restText] = splitFrom(from, labelW);
  doc.text(left + labelW, y + CELL_H - FROM_LINE_1, firstLine, {
    size: FROM_SIZE,
    gray: 0.25,
  });

  const tops = [FROM_LINE_2, FROM_LINE_3];
  restText.forEach((line, i) => {
    // The last line absorbs anything that did not fit, so an over-long sender
    // ends in an ellipsis rather than silently losing its tail.
    const text =
      i === tops.length - 1 ? truncate(line, INNER_W, FROM_SIZE) : line;
    doc.text(left, y + CELL_H - tops[i], text, { size: FROM_SIZE, gray: 0.25 });
  });
}

/**
 * Wrap the return address, with the first line short by the width of the
 * "FROM:" label sitting beside it.
 *
 * Two passes rather than one: wrapping the whole thing to the narrow width
 * would indent every line, and the two lines below the label have the full cell
 * to use.
 */
function splitFrom(from: string, labelW: number): string[] {
  const first = wrapText(from, INNER_W - labelW, FROM_SIZE)[0] ?? "";
  const rest = from.slice(first.length).trim();
  return [first, ...wrapText(rest, INNER_W, FROM_SIZE).slice(0, MAX_FROM_LINES - 1)];
}

/**
 * A gift box, drawn.
 *
 * Sits on the text baseline at `y`, so it lines up with the reference beside
 * it. Returns its width, so the caller advances past it without knowing how it
 * was built.
 */
function drawGift(doc: PdfDocument, x: number, y: number): number {
  const w = 9;
  const h = 7.5;
  const top = y - h;
  const o = { gray: 0, width: 0.6 };

  doc.line(x, top, x + w, top, o);
  doc.line(x, y, x + w, y, o);
  doc.line(x, top, x, y, o);
  doc.line(x + w, top, x + w, y, o);

  // Ribbon, both ways. This is what stops it reading as a plain rectangle.
  doc.line(x + w / 2, top, x + w / 2, y, o);
  doc.line(x, top + h * 0.38, x + w, top + h * 0.38, o);

  // Bow, above the lid.
  doc.line(x + w / 2, top, x + w / 2 - 2.5, top - 2.8, o);
  doc.line(x + w / 2, top, x + w / 2 + 2.5, top - 2.8, o);

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

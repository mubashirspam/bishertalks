import { PdfDocument, A4, wrapText, measureText } from "@/lib/pdf";
import { formatIST } from "@/lib/format-date";

/**
 * Address labels, six to an A4 sheet.
 *
 * 2 columns x 3 rows is the standard for a book-sized parcel: big enough that
 * a courier can read the pincode without squinting, small enough that a day's
 * orders is a couple of sheets. Cut along the boxes, tape one to each parcel.
 */

const COLS = 2;
const ROWS = 3;
export const LABELS_PER_PAGE = COLS * ROWS;

const MARGIN_X = 16;
const MARGIN_TOP = 14;
const MARGIN_BOTTOM = 24; // leaves a strip for the sheet footer

const CELL_W = (A4.width - MARGIN_X * 2) / COLS;
const CELL_H = (A4.height - MARGIN_TOP - MARGIN_BOTTOM) / ROWS;

const PAD_X = 14;
const PAD_Y = 13;
const INNER_W = CELL_W - PAD_X * 2;

/** Height reserved at the bottom of a label for the sender / contents block. */
const FOOTER_H = 46;

export interface LabelOrder {
  order_number: string;
  buyer_name: string | null;
  buyer_phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  district: string | null;
  state: string | null;
  pincode: string | null;
  /** Copies of the book in this parcel. Absent on older rows — treat as one. */
  quantity?: number | null;
  /**
   * Wrap it before it goes in the box (0027).
   *
   * The flag belongs here; the message deliberately does not. This sheet is
   * stuck to the outside of the parcel, and a private note to the recipient
   * printed where the courier and the whole household can read it is the one
   * way to ruin a gift while getting every other detail right. The message is
   * on the admin order page, for whoever writes the card.
   */
  is_gift?: boolean | null;
  /**
   * Every copy in this parcel is signed (0040).
   *
   * On the label because it changes what goes in the box, not just how it is
   * wrapped: an unsigned copy packed against a signed order is a parcel that
   * comes back. Only ever true alongside is_gift.
   */
  is_signed?: boolean | null;
  created_at: string;
}

export interface SenderDetails {
  name: string;
  address: string;
  phone: string;
}

/**
 * Return address. Read from the environment so it can be corrected without a
 * deploy, with the real values as defaults — a label with no sender is
 * undeliverable if the courier can't complete it.
 */
export function senderFromEnv(): SenderDetails {
  return {
    name: process.env.SHIP_FROM_NAME || "Bisher KC",
    address: process.env.SHIP_FROM_ADDRESS || "",
    phone: process.env.SHIP_FROM_PHONE || "",
  };
}

/** What's in the box. One title, one copy — this is a single-product store. */
/**
 * What's in the parcel.
 *
 * The count is the operative word: a label reading "x 1" on a three-book order
 * is how someone packs one book and closes the box.
 */
const contentsLine = (quantity: number, isGift: boolean, isSigned: boolean) =>
  `Neuro Code (Book) x ${quantity}` +
  (isSigned ? " — SIGNED" : "") +
  (isGift ? " — GIFT WRAPPED" : "");

export function buildLabelSheet(
  orders: LabelOrder[],
  sender: SenderDetails = senderFromEnv()
): Buffer {
  const doc = new PdfDocument();
  const printedAt = formatIST(new Date().toISOString());
  const pageCount = Math.max(1, Math.ceil(orders.length / LABELS_PER_PAGE));

  // The footer is drawn as each page opens: the writer is forward-only, so
  // there's no going back to stamp pages once the run length is known — but
  // the run length is known up front.
  const openPage = (pageIndex: number) => {
    if (pageIndex > 0) doc.addPage();
    drawSheetFooter(doc, pageIndex + 1, pageCount, orders.length, printedAt);
  };

  openPage(0);

  orders.forEach((order, i) => {
    const slot = i % LABELS_PER_PAGE;
    if (i > 0 && slot === 0) openPage(i / LABELS_PER_PAGE);

    const x = MARGIN_X + (slot % COLS) * CELL_W;
    const y = MARGIN_TOP + Math.floor(slot / COLS) * CELL_H;
    drawLabel(doc, order, sender, x, y);
  });

  return doc.build();
}

/** Provenance strip, so a sheet found on a desk can be placed. */
function drawSheetFooter(
  doc: PdfDocument,
  page: number,
  pages: number,
  total: number,
  printedAt: string
): void {
  const y = A4.height - 10;
  doc.text(MARGIN_X, y, `${total} label${total === 1 ? "" : "s"} · printed ${printedAt}`, {
    size: 7,
    gray: 0.5,
  });
  const right = `Page ${page} of ${pages}`;
  doc.text(A4.width - MARGIN_X - measureText(right, 7), y, right, {
    size: 7,
    gray: 0.5,
  });
}

function drawLabel(
  doc: PdfDocument,
  o: LabelOrder,
  sender: SenderDetails,
  x: number,
  y: number
): void {
  // Cut guide.
  box(doc, x, y, CELL_W, CELL_H);

  const left = x + PAD_X;
  const right = x + CELL_W - PAD_X;
  let cy = y + PAD_Y + 8;

  // A parcel is one book unless the order says otherwise. Rows created before
  // the quantity column existed are all single copies.
  const copies = Math.max(1, o.quantity ?? 1);

  // ── Header: prepaid marker + order number ────────────────────────────────
  doc.text(left, cy, "PREPAID", { size: 8, bold: true, gray: 0.3 });
  const num = o.order_number;
  doc.text(right - measureText(num, 9.5, true), cy, num, { size: 9.5, bold: true });

  // Anything that changes how the parcel is packed says so in the header, at
  // the size of the order number. The contents line at the foot carries it too,
  // but someone working down a sheet of six labels reads the top of each one
  // and no further.
  //
  // Laid out left to right with a running cursor, and dropped entirely rather
  // than allowed to collide with the right-aligned order number — an overlap
  // makes both unreadable, which is worse than either alone.
  let markerX = left + measureText("PREPAID   ", 8, true);
  const numberEdge = right - measureText(num, 9.5, true) - 6;
  const marker = (text: string) => {
    const w = measureText(text, 9.5, true);
    if (markerX + w > numberEdge) return;
    doc.text(markerX, cy, text, { size: 9.5, bold: true });
    markerX += w + measureText("  ", 9.5, true);
  };

  if (copies > 1) marker(`${copies} BOOKS`);
  if (o.is_gift) marker("GIFT");
  // Last, so it is the first dropped if the header runs out of room — markers
  // are laid left to right and `marker` skips any that would collide. Nothing
  // is lost when that happens: the contents line at the foot always carries it,
  // and GIFT is the one whose absence a packer cannot recover from once the
  // parcel is taped shut.
  if (o.is_signed) marker("SIGNED");

  cy += 7;
  doc.line(left, cy, right, cy, { gray: 0.7, width: 0.7 });

  // ── Deliver to ───────────────────────────────────────────────────────────
  cy += 13;
  doc.text(left, cy, "DELIVER TO", { size: 6.5, bold: true, gray: 0.5 });

  cy += 15;
  doc.text(left, cy, o.buyer_name?.trim() || "—", {
    size: 12,
    bold: true,
    maxWidth: INNER_W,
  });

  // ── Address ──────────────────────────────────────────────────────────────
  // Everything below the name shares a fixed budget; a long address loses its
  // least important lines rather than running over the sender block.
  const budgetEnd = y + CELL_H - FOOTER_H;

  const street = [o.address_line1, o.address_line2]
    .map((s) => s?.trim())
    .filter(Boolean)
    .join(", ");
  const area = [o.city, o.district]
    .map((s) => s?.trim())
    .filter(Boolean)
    .join(", ");

  cy += 14;
  for (const line of wrapText(street, INNER_W, 9.5)) {
    if (cy > budgetEnd) break;
    doc.text(left, cy, line, { size: 9.5 });
    cy += 11.5;
  }
  for (const line of wrapText(area, INNER_W, 9.5)) {
    if (cy > budgetEnd) break;
    doc.text(left, cy, line, { size: 9.5 });
    cy += 11.5;
  }

  // State + pincode, the two fields the sorting hub actually reads.
  if (cy <= budgetEnd) {
    const state = o.state?.trim() || "";
    const pin = o.pincode?.trim() || "";
    doc.text(left, cy + 2, [state, pin && `PIN ${pin}`].filter(Boolean).join("  -  "), {
      size: 11,
      bold: true,
      maxWidth: INNER_W,
    });
    cy += 15;
  }

  if (o.buyer_phone && cy <= budgetEnd + 12) {
    doc.text(left, cy + 2, `Phone: +91 ${o.buyer_phone}`, { size: 9.5, bold: true });
  }

  // ── Sender + contents, pinned to the bottom of the label ─────────────────
  const footTop = y + CELL_H - FOOTER_H;
  doc.line(left, footTop, right, footTop, { gray: 0.8, width: 0.5 });

  doc.text(left, footTop + 12, `Contents: ${contentsLine(copies, !!o.is_gift, !!o.is_signed)}`, {
    size: 7.5,
    gray: 0.35,
    maxWidth: INNER_W,
  });

  const ordered = new Date(o.created_at).toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  doc.text(left, footTop + 22, `Ordered ${ordered}`, { size: 7, gray: 0.45 });

  const from = [sender.name, sender.address, sender.phone && `Ph ${sender.phone}`]
    .filter(Boolean)
    .join(", ");
  let fy = footTop + 32;
  for (const line of wrapText(`FROM: ${from}`, INNER_W, 7)) {
    if (fy > y + CELL_H - 5) break;
    doc.text(left, fy, line, { size: 7, gray: 0.45 });
    fy += 8;
  }
}

function box(doc: PdfDocument, x: number, y: number, w: number, h: number): void {
  const o = { gray: 0.78, width: 0.6 };
  doc.line(x, y, x + w, y, o);
  doc.line(x, y + h, x + w, y + h, o);
  doc.line(x, y, x, y + h, o);
  doc.line(x + w, y, x + w, y + h, o);
}

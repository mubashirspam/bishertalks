import { PdfDocument, wrapText, measureText, printableOnly } from "@/lib/pdf";
import { drawBarcode } from "@/lib/barcode";
import { indiaPostEmblem, INDIA_POST_FORM, INDIA_POST_VIEWBOX } from "@/lib/india-post-logo";
import { formatIST } from "@/lib/format-date";
import type { CourierConfig } from "@/lib/couriers/types";

/**
 * Address labels, one per 4x6 page, for a thermal label printer.
 *
 * These used to be six to an A4 sheet, printed on an office laser and cut up
 * with scissors. A 4x6 roll printer removes the cutting, and with it the
 * reason to cram six addresses onto one page: each label is now its own page,
 * so the address gets the whole face of the parcel sticker and can be set
 * large enough to read at arm's length on a loading dock.
 *
 * The page is a true 4in x 6in at 72pt to the inch. Thermal printers size the
 * image to the stock they are loaded with, so a page even slightly off gets
 * scaled or centred with a white strip down one side — which shifts the
 * barcode and is the usual reason a label that looks right on screen will not
 * scan.
 */
export const LABEL_4X6 = { width: 288, height: 432 };

/** One label, one page. Kept exported: callers still count pages with it. */
export const LABELS_PER_PAGE = 1;

const MARGIN = 13;
const LEFT = MARGIN;
const RIGHT = LABEL_4X6.width - MARGIN;
const INNER_W = RIGHT - LEFT;

/**
 * The barcode's own margin, on top of the page margin.
 *
 * Code 128 needs a clear quiet zone either side or a scanner reads the label
 * edge as part of the symbol. Ten modules is the specified minimum; this is
 * wider than that at every length we print, and costs nothing but width we
 * were not using.
 */
const BARCODE_INSET = 14;

// ── Vertical anchors, measured from the top of the page ─────────────────────
// The address grows downwards from the header and the despatch block is pinned
// to the bottom, so a long address runs out of room against a fixed line
// rather than colliding with the barcode.

/** Baseline of the provenance strip — the last thing on the page. */
const PROVENANCE_Y = LABEL_4X6.height - MARGIN;
/** Baseline of the human-readable number printed under the barcode. */
const BARCODE_TEXT_Y = PROVENANCE_Y - 12;
const BARCODE_H = 54;
const BARCODE_TOP = BARCODE_TEXT_Y - 11 - BARCODE_H;
/** The heavy rule that separates the barcode from everything above it. */
const BARCODE_RULE_Y = BARCODE_TOP - 11;
/** Top of the contents / return-address block. */
const DESPATCH_TOP = BARCODE_RULE_Y - 72;
/** The address may not grow past this. */
const ADDRESS_END = DESPATCH_TOP - 6;

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
   * The flag belongs on the label; the message still does not. This sheet is
   * stuck to the outside of the parcel, and a private note to the recipient
   * printed where the courier and the whole household can read it is the one
   * way to ruin a gift while getting every other detail right.
   *
   * The message now prints on a packing slip instead — its own page, headed
   * DO NOT STICK ON PARCEL, which the packer reads at the bench. See
   * drawPackingSlip().
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
  /**
   * What to write on the card. Only ever set alongside is_gift.
   *
   * Never printed on the address label — see is_gift above.
   */
  gift_message?: string | null;
  /**
   * The order date — when it was paid (0043).
   *
   * Not created_at, which is when checkout began. A customer who abandoned on
   * Monday and paid on Friday would otherwise get a parcel stamped Monday, and
   * the first thing they check against their bank statement is the date.
   */
  ordered_at: string;
  /**
   * India Post's article number, once one has been allotted to this parcel.
   *
   * When it is set it becomes the barcode on the label, in place of our own
   * order number. That is not a cosmetic swap: a Speed Post article is
   * tracked, sorted and delivered against this number, it is the number on the
   * bulk booking file the parcel was posted on, and the counter scans the
   * label to accept it. A label carrying our order number instead is a parcel
   * the postal system cannot see.
   *
   * The order number does not disappear — it stays in the header, where the
   * packer reads it. See lib/db/postal-barcodes.ts for where the number comes
   * from and why it is never reused.
   */
  postal_barcode?: string | null;
  /**
   * The number this parcel is filed under on the courier's side (0024).
   *
   * Not printed on a 4x6 label — that one is stuck to the parcel and carries
   * one barcode by design. It is here because the A4 address sheet falls back
   * to it: a Delhivery parcel has no article number, and its reference is what
   * the courier's own system and our tracking sync both match on.
   */
  courier_reference?: string | null;
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

/**
 * The return address for one courier, falling back to the environment.
 *
 * Per field, not per courier: a partner that has been given its own phone but
 * not its own street keeps the default street. Falling back as a whole object
 * would mean half-filling the form produced a return address with a name from
 * one place and nothing else — worse than either source on its own.
 *
 * `senderFromEnv()` remains the answer for anything printed across couriers,
 * and for a parcel not routed to one at all.
 */
export function senderForCourier(config: CourierConfig | null | undefined): SenderDetails {
  const fallback = senderFromEnv();
  return {
    name: config?.from_name?.trim() || fallback.name,
    address: config?.from_address?.trim() || fallback.address,
    phone: config?.from_phone?.trim() || fallback.phone,
  };
}

/**
 * The masthead of an address sheet: the heading, and the account the parcel is
 * booked against.
 *
 * Separate from `SenderDetails` because it answers a different question. The
 * sender is where a failed parcel goes back to; this is what the counter reads
 * to accept it in the first place — and a partner can need one without the
 * other, which is why an empty `customerId` prints no band rather than an
 * empty one.
 */
export interface SheetHeader {
  title: string;
  customerId: string;
  contractId: string;
}

/**
 * The default masthead — environment first, so it can be corrected without a
 * deploy, exactly like the return address.
 *
 * The title falls back to a partner-neutral word rather than India Post's:
 * a sheet printed for a courier nobody has configured should not claim to be
 * contractual post, because the counter it is handed to would be right to
 * refuse it.
 */
export function sheetHeaderFromEnv(): SheetHeader {
  return {
    title: process.env.SHIP_SHEET_TITLE || "PARCEL ADDRESS",
    customerId: process.env.SHIP_CUSTOMER_ID || "",
    contractId: process.env.SHIP_CONTRACT_ID || "",
  };
}

/**
 * The masthead for one courier, falling back to the environment.
 *
 * Per field for the same reason `senderForCourier` is: a partner given its own
 * heading but no contract number keeps the default numbers rather than losing
 * the heading too.
 */
export function sheetHeaderForCourier(
  config: CourierConfig | null | undefined
): SheetHeader {
  const fallback = sheetHeaderFromEnv();
  return {
    title: config?.sheet_title?.trim() || fallback.title,
    customerId: config?.customer_id?.trim() || fallback.customerId,
    contractId: config?.contract_id?.trim() || fallback.contractId,
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

/**
 * What this parcel's barcode carries, or "" for a parcel that must not be
 * given one.
 */
export type LabelBarcodeFor<T = LabelOrder> = (order: T) => string;

/**
 * What the strip above the barcode calls this parcel — "" for no strip.
 *
 * The label used to say "SPEED POST — ARTICLE NUMBER", hard-coded, and that
 * was wrong in the way that matters at a counter: these parcels are not Speed
 * Post articles, they are posted under a contractual account, and the words
 * the counter expects are the ones already on the account's paperwork. Those
 * live in the courier's `sheet_title` — "INDIA POST PARCEL CONTRACTUAL" — and
 * the A4 sheet has been printing them as its masthead all along. This is that
 * same string reaching the label.
 *
 * A resolver rather than a constant because it is the courier's, not the
 * label's: a second postal account books under a different heading, and a
 * label claiming the wrong contract is one the counter should refuse.
 */
export type LabelCaptionFor<T = LabelOrder> = (order: T) => string;

/** The caption for a parcel going out under an India Post contract. */
export function postalLabelCaption(config: CourierConfig | null | undefined): string {
  return sheetHeaderForCourier(config).title;
}

/**
 * The default: the article number where there is one, our order number
 * otherwise.
 *
 * Right for every courier that indexes on whatever we hand them — the order
 * number is what our own screens, exports and audit trail are keyed by, so
 * scanning it finds the order.
 */
export function labelBarcodeValue(o: LabelOrder): string {
  return o.postal_barcode?.trim() || o.order_number;
}

/**
 * The rule for a parcel going out by India Post: their article number, or
 * nothing.
 *
 * No fallback, deliberately. An article is registered and sorted against a
 * number from their own allotment; our order number is not a key in their
 * system. A barcode carrying it would scan cleanly at the booking counter and
 * resolve to nothing — which is worse than a blank space, because a blank
 * space is visibly blank and a wrong barcode is not.
 */
export function postalLabelBarcode(o: LabelOrder): string {
  return o.postal_barcode?.trim() ?? "";
}

/**
 * The return address for one parcel, or one address for the whole run.
 *
 * A function because a batch can span couriers, and the return address is the
 * carrying courier's: a Speed Post parcel comes back to the branch it was
 * booked at, a Mubashir Logistic one comes back to Wayanad. One address across
 * both sends a failed parcel to a building that never had it — which is the
 * same reasoning `SenderFor` in lib/address-sheet.ts already carries, and this
 * is that rule reaching the 4x6 label.
 *
 * A plain `SenderDetails` is still accepted, because most callers print one
 * courier's parcels and have nothing to resolve.
 */
export type LabelSenderFor<T = LabelOrder> = (order: T) => SenderDetails;

// Generic over the row, like buildAddressSheet, so a caller can hand in rows
// carrying more than the label draws — `courier_id`, in the callers that
// resolve the barcode rule or the sender per parcel — and still have it typed
// inside the callback.
export interface LabelSheetOptions<T extends LabelOrder> {
  /** One address for the run, or one per parcel. See LabelSenderFor. */
  sender?: SenderDetails | LabelSenderFor<T>;
  /** Resolved per parcel, because the rule depends on the courier. */
  barcodeFor?: LabelBarcodeFor<T>;
  /** The contract heading over the barcode. "" prints no strip at all. */
  captionFor?: LabelCaptionFor<T>;
  /**
   * Print the bench instructions for gifts and signed copies.
   *
   * On by default, because the master queue is where a batch is printed to be
   * packed and the slip is the only place the gift message appears.
   *
   * Off for the delivery portal. That screen belongs to whoever is moving
   * parcels that are already packed, and a run of fifty labels there was
   * coming out with extra pages they had to pull off the stack and throw away
   * — while the private message on them went through a courier partner's
   * printer, which is the one place it should never be.
   */
  packingSlips?: boolean;
}

export function buildLabelSheet<T extends LabelOrder>(
  orders: T[],
  options: LabelSheetOptions<T> = {}
): Buffer {
  const {
    sender = senderFromEnv(),
    barcodeFor = labelBarcodeValue,
    captionFor = () => "",
    packingSlips = true,
  } = options;
  const doc = new PdfDocument(LABEL_4X6.width, LABEL_4X6.height);
  const printedAt = formatIST(new Date().toISOString());
  const senderFor: LabelSenderFor<T> =
    typeof sender === "function" ? sender : () => sender;

  // Registered once for the whole run and written to the file once, however
  // many labels stamp it. Defining it costs nothing if no parcel is postal —
  // an unstamped form is never written. See PdfDocument.defineForm.
  doc.defineForm(INDIA_POST_FORM, INDIA_POST_VIEWBOX, indiaPostEmblem());

  orders.forEach((order, i) => {
    if (i > 0) doc.addPage();
    drawLabel(
      doc,
      order,
      senderFor(order),
      printedAt,
      barcodeFor(order),
      i + 1,
      orders.length,
      captionFor(order)
    );

    // A parcel that needs something done to it before the box is taped shut
    // gets a second page. Only gifts and signed copies — about ten parcels in
    // a thousand — so this does not double the stack for a normal day's post.
    //
    // Its own page rather than a corner of the label, because the two sheets
    // have opposite destinations: the label is stuck to the outside where the
    // courier and the household read it, and this is read at the bench and
    // thrown away or dropped in the box.
    if (packingSlips && (order.is_gift || order.is_signed)) {
      doc.addPage();
      drawPackingSlip(doc, order, i + 1, orders.length);
    }
  });

  return doc.build();
}

/**
 * The instructions for a parcel that is not just a book in a box.
 *
 * Everything the person packing has to know and could not get from the
 * address label: whether the copies need signing, whether it is wrapped, and
 * the exact words to write on the card. Before this the message lived only on
 * the admin order page, so packing one gift meant leaving the bench, finding
 * the order and copying a line of Malayalam by hand.
 *
 * Deliberately unmistakable for a label: no address, no barcode, and the
 * warning is the first thing on the page at a size nobody skims past. A gift
 * message stuck to the outside of a parcel is worse than no gift message.
 */
function drawPackingSlip(
  doc: PdfDocument,
  o: LabelOrder,
  index: number,
  total: number
): void {
  let cy = MARGIN + 12;
  const copies = Math.max(1, o.quantity ?? 1);

  doc.text(LEFT, cy, "PACKING SLIP", { size: 15, bold: true });
  cy += 15;
  doc.text(LEFT, cy, "DO NOT STICK ON PARCEL", { size: 10, bold: true, gray: 0.35 });

  cy += 8;
  doc.line(LEFT, cy, RIGHT, cy, { gray: 0.4, width: 1.2 });

  cy += 18;
  doc.text(LEFT, cy, o.order_number, { size: 13, bold: true });
  cy += 15;
  doc.text(LEFT, cy, o.buyer_name?.trim() || "—", { size: 11, maxWidth: INNER_W });

  // ── What to do, in the order it is done ──────────────────────────────────
  cy += 24;
  doc.text(LEFT, cy, "BEFORE PACKING", { size: 8, bold: true, gray: 0.5 });

  const steps: string[] = [];
  if (o.is_signed) {
    steps.push(
      copies > 1
        ? `Get all ${copies} copies signed by Bisher`
        : "Get the copy signed by Bisher"
    );
  }
  if (o.is_gift) steps.push("Gift wrap before it goes in the box");
  if (o.is_gift) {
    steps.push(
      o.gift_message?.trim()
        ? "Write the message below on the card"
        : "Include a blank card — no message was left"
    );
  }

  for (const step of steps) {
    cy += 17;
    doc.text(LEFT, cy, `•  ${step}`, { size: 11, bold: true, maxWidth: INNER_W });
  }

  // ── The message, verbatim where it can be ────────────────────────────────
  //
  // Half the gift messages in this shop are Malayalam or carry an emoji, and
  // the built-in PDF fonts have a glyph for neither — they print as a row of
  // question marks. That is worse than printing nothing: it looks like the
  // message rather than like a failure, and the card goes out copied from it.
  //
  // So what cannot be printed is named as such, with the order number already
  // at the top of this slip to look it up by.
  const raw = o.gift_message?.trim() ?? "";
  const message = raw ? printableOnly(raw) : "";
  const lostMost = !!raw && (!message || message.length < raw.length * 0.7);

  if (raw && lostMost) {
    cy += 22;
    doc.text(LEFT, cy, "WRITE ON THE CARD", { size: 8, bold: true, gray: 0.5 });
    cy += 17;
    doc.text(LEFT, cy, "Message is in Malayalam or uses emoji.", {
      size: 11,
      bold: true,
      maxWidth: INNER_W,
    });
    cy += 15;
    doc.text(LEFT, cy, `Open ${o.order_number} in the admin to copy it.`, {
      size: 10,
      maxWidth: INNER_W,
    });
  } else if (message) {
    cy += 22;
    doc.text(LEFT, cy, "WRITE ON THE CARD", { size: 8, bold: true, gray: 0.5 });
    cy += 6;
    doc.line(LEFT, cy, RIGHT, cy, { gray: 0.75, width: 0.5 });

    // Wrapped, never silently truncated: half a message is worse than none,
    // because the card goes out wrong and nobody at the bench knows it did.
    for (const line of wrapText(message, INNER_W, 12)) {
      cy += 16;
      if (cy > LABEL_4X6.height - MARGIN - 26) {
        doc.text(LEFT, cy, "… message continues on the order page", {
          size: 8,
          gray: 0.45,
        });
        break;
      }
      doc.text(LEFT, cy, line, { size: 12, maxWidth: INNER_W });
    }

    cy += 8;
    doc.line(LEFT, cy, RIGHT, cy, { gray: 0.75, width: 0.5 });

    // A stray emoji dropped out of an otherwise English message. Worth one
    // line, because the card should not silently lose a heart.
    if (message.length < raw.length) {
      cy += 12;
      doc.text(LEFT, cy, "(an emoji could not be printed — check the order)", {
        size: 8,
        gray: 0.45,
      });
    }
  }

  doc.text(LEFT, LABEL_4X6.height - MARGIN, `Packing slip ${index} of ${total}`, {
    size: 7.5,
    gray: 0.5,
  });
}

function drawLabel(
  doc: PdfDocument,
  o: LabelOrder,
  sender: SenderDetails,
  printedAt: string,
  barcodeValue: string,
  index: number,
  total: number,
  caption = ""
): void {
  let cy = MARGIN + 10;

  // A parcel is one book unless the order says otherwise. Rows created before
  // the quantity column existed are all single copies.
  const copies = Math.max(1, o.quantity ?? 1);

  // ── Header: prepaid marker + order number ────────────────────────────────
  doc.text(LEFT, cy, "PREPAID", { size: 9, bold: true, gray: 0.3 });
  const num = o.order_number;
  doc.text(RIGHT - measureText(num, 13, true), cy, num, { size: 13, bold: true });

  // Anything that changes how the parcel is packed says so in the header, at
  // the size of the order number. The contents line further down carries it
  // too, but someone working through a stack of labels reads the top of each
  // one and no further.
  //
  // On their own row now rather than squeezed beside the order number: a 4x6
  // page has the width to print all three without any of them having to be
  // dropped to avoid a collision, which is what the A4 layout had to do.
  const markers = [
    copies > 1 ? `${copies} BOOKS` : "",
    o.is_gift ? "GIFT" : "",
    o.is_signed ? "SIGNED" : "",
  ].filter(Boolean);

  if (markers.length) {
    cy += 15;
    doc.text(LEFT, cy, markers.join("   "), { size: 11, bold: true, maxWidth: INNER_W });
  }

  cy += 8;
  doc.line(LEFT, cy, RIGHT, cy, { gray: 0.6, width: 0.8 });

  // ── Deliver to ───────────────────────────────────────────────────────────
  cy += 15;
  doc.text(LEFT, cy, "DELIVER TO", { size: 7.5, bold: true, gray: 0.5 });

  // Wrapped over two lines rather than truncated. A Malayalam name written out
  // in full is regularly wider than the label, and the A4 layout cut it off —
  // which puts a parcel on a doorstep addressed to somebody who does not quite
  // exist. Two lines is where it stops: past that it is no longer a name, and
  // the address underneath matters more.
  const nameLines = wrapText(o.buyer_name?.trim() || "—", INNER_W, 16, true).slice(0, 2);
  for (const line of nameLines) {
    cy += 20;
    doc.text(LEFT, cy, line, { size: 16, bold: true, maxWidth: INNER_W });
  }

  // ── Address ──────────────────────────────────────────────────────────────
  // Everything below the name shares a fixed budget; a long address loses its
  // least important lines rather than running over the despatch block.
  const street = [o.address_line1, o.address_line2]
    .map((t) => t?.trim())
    .filter(Boolean)
    .join(", ");
  const area = [o.city, o.district]
    .map((t) => t?.trim())
    .filter(Boolean)
    .join(", ");

  cy += 19;
  for (const line of [...wrapText(street, INNER_W, 12), ...wrapText(area, INNER_W, 12)]) {
    if (cy > ADDRESS_END) break;
    doc.text(LEFT, cy, line, { size: 12 });
    cy += 14.5;
  }

  // State + pincode, the two fields the sorting hub actually reads.
  const state = o.state?.trim() || "";
  const pin = o.pincode?.trim() || "";
  const region = [state, pin && `PIN ${pin}`].filter(Boolean).join("  -  ");
  if (region && cy <= ADDRESS_END) {
    doc.text(LEFT, cy + 4, region, { size: 15, bold: true, maxWidth: INNER_W });
    cy += 22;
  }

  if (o.buyer_phone && cy <= ADDRESS_END + 14) {
    doc.text(LEFT, cy + 3, `Phone: +91 ${o.buyer_phone}`, { size: 12, bold: true });
  }

  // ── Contents + return address, pinned above the barcode ──────────────────
  doc.line(LEFT, DESPATCH_TOP, RIGHT, DESPATCH_TOP, { gray: 0.8, width: 0.5 });

  doc.text(
    LEFT,
    DESPATCH_TOP + 13,
    `Contents: ${contentsLine(copies, !!o.is_gift, !!o.is_signed)}`,
    { size: 8.5, gray: 0.3, maxWidth: INNER_W }
  );

  const ordered = new Date(o.ordered_at).toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  doc.text(LEFT, DESPATCH_TOP + 25, `Ordered ${ordered}`, { size: 8, gray: 0.45 });

  const from = [sender.name, sender.address, sender.phone && `Ph ${sender.phone}`]
    .filter(Boolean)
    .join(", ");
  // Stops short of the contract strip below rather than of the rule itself:
  // the emblem stands 15pt above the rule, and a fourth line of return address
  // would have been drawn straight through it.
  let fy = DESPATCH_TOP + 37;
  for (const line of wrapText(`FROM: ${from}`, INNER_W, 8)) {
    if (fy > BARCODE_RULE_Y - 17) break;
    doc.text(LEFT, fy, line, { size: 8, gray: 0.45 });
    fy += 9.5;
  }

  // ── Barcode ──────────────────────────────────────────────────────────────
  //
  // The article number where the parcel has one, and our order number where it
  // does not.
  //
  // The default is the order number, and the reason is that this is *our*
  // label: the number on it is what our own screens, exports and audit trail
  // are keyed by, so scanning it finds the order. A partner that wants its own
  // barcode issues its own at the counter, and Delhivery's packing slip
  // already carries theirs — a second barcode on the same parcel is how the
  // wrong one gets scanned.
  //
  // India Post is the exception, and it is the one case where that reasoning
  // inverts. There is no counter-printed label: the article number is minted
  // from our own allotment before the parcel is posted, it is what went onto
  // the bulk booking file, and it is what every scan from the booking office
  // to the doorstep is recorded against. Printing our order number there would
  // leave the parcel with no machine-readable identity in the system carrying
  // it — so when a postal barcode is present it wins, and the order number
  // stays in the header where the packer reads it.
  const isArticle = !!barcodeValue && barcodeValue === o.postal_barcode?.trim();

  // Named, because a bare thirteen-character code on a parcel is ambiguous to
  // the person at the booking counter and to us six weeks later.
  //
  // The words are the courier's contract heading — "INDIA POST PARCEL
  // CONTRACTUAL" — and not the "SPEED POST" this once said. These parcels are
  // booked against a contract, not bought as Speed Post articles at the
  // window, and the counter reads that line to decide which queue the parcel
  // is in. India Post's emblem sits at the right of the same strip: it is the
  // first thing recognised across a counter, and putting it beside the words
  // rather than up in the header keeps the whole postal identity — mark,
  // contract, barcode — in one block that reads as a unit.
  if (isArticle && caption) {
    const emblemW = 26;
    const emblemH = 13;
    // Bottom of the emblem just clear of the rule, so the two never touch.
    doc.drawForm(
      INDIA_POST_FORM,
      RIGHT - emblemW,
      BARCODE_RULE_Y - emblemH - 2,
      emblemW,
      emblemH
    );

    doc.text(LEFT, BARCODE_RULE_Y - 4, caption.toUpperCase(), {
      size: 7,
      bold: true,
      gray: 0.4,
      // Stops long contract wording running under the emblem.
      maxWidth: INNER_W - emblemW - 6,
    });
  }

  doc.line(LEFT, BARCODE_RULE_Y, RIGHT, BARCODE_RULE_Y, { gray: 0, width: 1.5 });

  // Nothing to print, and nothing printed. An India Post parcel that has not
  // been on a booking file has no number the postal system knows, and the
  // space says so rather than being filled with one that scans to nothing.
  // The order number is still in the header, which is what the packer reads.
  if (!barcodeValue) {
    const note = "NO ARTICLE NUMBER — NOT YET ON A BOOKING FILE";
    const wrapped = wrapText(note, INNER_W, 9);
    wrapped.slice(0, 2).forEach((line, i) => {
      doc.text(
        LEFT + (INNER_W - measureText(line, 9, true)) / 2,
        BARCODE_TOP + 20 + i * 12,
        line,
        { size: 9, bold: true, gray: 0.5 }
      );
    });
    doc.text(LEFT, PROVENANCE_Y, `Printed ${printedAt}`, { size: 6.5, gray: 0.5 });
    const shortCount = `${index} of ${total}`;
    doc.text(RIGHT - measureText(shortCount, 6.5), PROVENANCE_Y, shortCount, {
      size: 6.5,
      gray: 0.5,
    });
    return;
  }

  const drawn = drawBarcode(doc, barcodeValue, {
    x: LEFT + BARCODE_INSET,
    y: BARCODE_TOP,
    width: INNER_W - BARCODE_INSET * 2,
    height: BARCODE_H,
  });

  // The number under the barcode is not decoration: it is what a packer reads
  // out when a scanner will not read the label at all.
  if (drawn) {
    const centred = LEFT + (INNER_W - measureText(barcodeValue, 13, true)) / 2;
    doc.text(centred, BARCODE_TEXT_Y, barcodeValue, { size: 13, bold: true });
  }

  // ── Provenance, so a label found loose on a bench can be placed ──────────
  doc.text(LEFT, PROVENANCE_Y, `Printed ${printedAt}`, { size: 6.5, gray: 0.5 });
  const count = `${index} of ${total}`;
  doc.text(RIGHT - measureText(count, 6.5), PROVENANCE_Y, count, { size: 6.5, gray: 0.5 });
}

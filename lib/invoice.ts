import { PdfDocument, A4, wrapText, measureText } from "@/lib/pdf";
import { formatIST } from "@/lib/format-date";
import { senderFromEnv } from "@/lib/shipping-label";

/**
 * The bill a customer asks for — a one-page A4 invoice PDF, generated on
 * demand from the admin order page and downloaded straight to the admin's
 * machine. Nothing is emailed, sent on WhatsApp, or recorded anywhere: the
 * same click can be repeated any number of times, so tracking it would be
 * noise.
 *
 * Printed books are exempt from GST (HSN 4901), and this store sells exactly
 * one product, so the bill always shows GST as Nil rather than trying to be a
 * general tax invoice.
 */

export interface InvoiceOrder {
  order_number: string;
  buyer_name: string | null;
  buyer_phone: string | null;
  buyer_email: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  district: string | null;
  state: string | null;
  pincode: string | null;
  amount_paise: number;
  quantity: number | null;
  /** When the payment was confirmed (0043). Null on orders paid before it. */
  paid_at: string | null;
  /** Gift wrapping charged on this order, or 0 / null (migration 0027). */
  gift_charge_paise: number | null;
  discount_paise: number;
  promo_code: string | null;
  razorpay_payment_id: string | null;
  created_at: string;
  invoice_email_sent_at: string | null;
  address_submitted_at: string | null;
}

const MARGIN = 48;
const RIGHT = A4.width - MARGIN;
const WIDTH = RIGHT - MARGIN;

/** Item table columns: description stretches, the rest are fixed. */
const COL_HSN = 320;
const COL_QTY = 385;
const COL_RATE = 470;
// Amount column is right-aligned at RIGHT.

/** The built-in fonts have no rupee glyph, so amounts are written as "Rs.". */
const money = (paise: number) =>
  `Rs. ${(paise / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

function right(doc: PdfDocument, x: number, y: number, text: string, opts: Parameters<PdfDocument["text"]>[3] = {}) {
  doc.text(x - measureText(text, opts.size ?? 10, opts.bold ?? false), y, text, opts);
}

export function buildInvoice(order: InvoiceOrder): Buffer {
  const doc = new PdfDocument();
  const sender = senderFromEnv();

  const copies = Math.max(1, order.quantity ?? 1);

  // Wrapping is a separate line, not part of the book. Folding it into the
  // subtotal would divide it across the copies and quote a per-book rate the
  // customer was never charged — on a two-copy gift, ₹779.50 a book for a book
  // that costs ₹699.
  //
  // Signing is not a line at all: it is free (0041), and a ₹0 row on a bill
  // invites the question of what it is doing there.
  const giftPaise = Math.max(0, order.gift_charge_paise ?? 0);

  // The pre-discount book total, derived from what was actually charged so the
  // maths always adds up to amount_paise — the figure Razorpay captured.
  const subtotalPaise = order.amount_paise - giftPaise + (order.discount_paise || 0);
  const ratePaise = subtotalPaise / copies;

  // When the money landed. Exact since 0043; the stand-ins behind it are for
  // orders paid before that column existed, and created_at is the last resort
  // rather than the first answer — on a lead that came back days later it would
  // date the bill to the day they first opened the checkout.
  const paidAt =
    order.paid_at ??
    order.invoice_email_sent_at ??
    order.address_submitted_at ??
    order.created_at;

  // ── Header ────────────────────────────────────────────────────────────────
  let y = 56;
  doc.text(MARGIN, y, sender.name.toUpperCase(), { size: 16, bold: true });
  right(doc, RIGHT, y + 2, "INVOICE", { size: 20, bold: true, gray: 0.25 });

  let sy = y + 16;
  for (const line of wrapText(sender.address, 250, 9)) {
    doc.text(MARGIN, sy, line, { size: 9, gray: 0.35 });
    sy += 11;
  }
  if (sender.phone) {
    doc.text(MARGIN, sy, `Phone: ${sender.phone}`, { size: 9, gray: 0.35 });
    sy += 11;
  }

  right(doc, RIGHT, 100, `Invoice No: ${order.order_number}`, { size: 10.5, bold: true });
  right(doc, RIGHT, 115, `Date: ${formatIST(paidAt)}`, { size: 9, gray: 0.35 });

  // ── Bill to ───────────────────────────────────────────────────────────────
  y = 168;
  doc.line(MARGIN, y, RIGHT, y, { gray: 0.8, width: 0.7 });
  y += 22;
  doc.text(MARGIN, y, "BILL TO", { size: 8, bold: true, gray: 0.5 });
  y += 16;
  doc.text(MARGIN, y, order.buyer_name?.trim() || "—", { size: 11.5, bold: true, maxWidth: WIDTH });

  const street = [order.address_line1, order.address_line2]
    .map((s) => s?.trim())
    .filter(Boolean)
    .join(", ");
  const area = [order.city, order.district].map((s) => s?.trim()).filter(Boolean).join(", ");
  const statePin = [order.state?.trim(), order.pincode && `PIN ${order.pincode.trim()}`]
    .filter(Boolean)
    .join(" - ");

  y += 15;
  for (const line of [street, area, statePin].filter(Boolean)) {
    for (const wrapped of wrapText(line, WIDTH, 9.5)) {
      doc.text(MARGIN, y, wrapped, { size: 9.5 });
      y += 12;
    }
  }
  if (order.buyer_phone) {
    doc.text(MARGIN, y, `Phone: +91 ${order.buyer_phone}`, { size: 9.5 });
    y += 12;
  }
  if (order.buyer_email) {
    doc.text(MARGIN, y, order.buyer_email, { size: 9.5 });
    y += 12;
  }

  // ── Items ─────────────────────────────────────────────────────────────────
  y += 26;
  doc.rect(MARGIN, y - 8, WIDTH, 24, 0.94);
  doc.text(MARGIN + 8, y + 8, "DESCRIPTION", { size: 8, bold: true, gray: 0.4 });
  doc.text(COL_HSN, y + 8, "HSN", { size: 8, bold: true, gray: 0.4 });
  right(doc, COL_QTY, y + 8, "QTY", { size: 8, bold: true, gray: 0.4 });
  right(doc, COL_RATE, y + 8, "RATE", { size: 8, bold: true, gray: 0.4 });
  right(doc, RIGHT - 8, y + 8, "AMOUNT", { size: 8, bold: true, gray: 0.4 });

  y += 32;
  doc.text(MARGIN + 8, y, `Neuro Code (Book)${copies > 1 ? ` x ${copies}` : ""}`, {
    size: 10.5,
    bold: true,
    maxWidth: COL_HSN - MARGIN - 20,
  });
  doc.text(MARGIN + 8, y + 13, "by Bisher KC", { size: 8.5, gray: 0.45 });
  doc.text(COL_HSN, y, "4901", { size: 10 });
  right(doc, COL_QTY, y, String(copies), { size: 10 });
  right(doc, COL_RATE, y, money(ratePaise), { size: 10 });
  right(doc, RIGHT - 8, y, money(subtotalPaise), { size: 10 });

  // Its own line, because it is a service and not a book — the GST note at the
  // foot of this page is about HSN 4901, and it would be quietly wrong if the
  // wrapping charge were hidden inside that row.
  if (giftPaise > 0) {
    y += 30;
    doc.text(MARGIN + 8, y, "Gift wrapping", {
      size: 10.5,
      bold: true,
      maxWidth: COL_HSN - MARGIN - 20,
    });
    doc.text(MARGIN + 8, y + 13, "wrapped by hand, with card", { size: 8.5, gray: 0.45 });
    doc.text(COL_HSN, y, "-", { size: 10, gray: 0.45 });
    right(doc, COL_QTY, y, "1", { size: 10 });
    right(doc, COL_RATE, y, money(giftPaise), { size: 10 });
    right(doc, RIGHT - 8, y, money(giftPaise), { size: 10 });
  }

  y += 34;
  doc.line(MARGIN, y, RIGHT, y, { gray: 0.85, width: 0.6 });

  // ── Totals ────────────────────────────────────────────────────────────────
  const labelX = COL_HSN;
  y += 20;
  doc.text(labelX, y, "Subtotal", { size: 10 });
  right(doc, RIGHT, y, money(subtotalPaise), { size: 10 });

  if (order.discount_paise > 0) {
    y += 15;
    doc.text(labelX, y, `Discount${order.promo_code ? ` (${order.promo_code})` : ""}`, { size: 10 });
    right(doc, RIGHT, y, `- ${money(order.discount_paise)}`, { size: 10 });
  }

  if (giftPaise > 0) {
    y += 15;
    doc.text(labelX, y, "Gift wrapping", { size: 10 });
    right(doc, RIGHT, y, money(giftPaise), { size: 10 });
  }

  y += 15;
  doc.text(labelX, y, "GST (books exempt, HSN 4901)", { size: 10, gray: 0.35 });
  right(doc, RIGHT, y, money(0), { size: 10, gray: 0.35 });

  y += 12;
  doc.line(labelX, y, RIGHT, y, { gray: 0.6, width: 0.8 });
  y += 20;
  doc.text(labelX, y, "Total", { size: 12, bold: true });
  right(doc, RIGHT, y, money(order.amount_paise), { size: 12, bold: true });

  // ── Payment ───────────────────────────────────────────────────────────────
  y += 34;
  doc.text(MARGIN, y, "Payment received", { size: 9.5, bold: true });
  if (order.razorpay_payment_id) {
    doc.text(MARGIN + measureText("Payment received  ", 9.5, true), y, `via Razorpay - ${order.razorpay_payment_id}`, {
      size: 9.5,
      gray: 0.35,
      maxWidth: WIDTH - 110,
    });
  }

  // ── Footer, pinned near the bottom of the page ────────────────────────────
  const footY = A4.height - 92;
  doc.line(MARGIN, footY, RIGHT, footY, { gray: 0.85, width: 0.6 });
  doc.text(MARGIN, footY + 14, "Printed books are exempt from GST (HSN 4901) — no GST has been charged on this invoice.", {
    size: 8.5,
    gray: 0.45,
    maxWidth: WIDTH,
  });
  doc.text(MARGIN, footY + 26, "This is a computer-generated invoice and does not require a signature.", {
    size: 8.5,
    gray: 0.45,
  });
  doc.text(MARGIN, footY + 44, "Thank you for your purchase!", { size: 9, bold: true });

  return doc.build();
}

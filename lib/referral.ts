/**
 * Referral codes — the pure parts.
 *
 * Kept free of database imports so the middleware and the client share can use
 * it, and so the commission maths can be tested on its own.
 */

/**
 * Unambiguous alphabet: no O/0, no I/1/L. Codes get read aloud, retyped from a
 * WhatsApp message, and squinted at on a phone screen — a code nobody can
 * transcribe is a referral nobody makes.
 */
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export const CODE_MIN = 4;
export const CODE_MAX = 20;

/** Normalise anything a customer might type or paste. */
export function normalizeCode(raw: string | null | undefined): string {
  return (raw ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, CODE_MAX);
}

export function isValidCodeFormat(code: string): boolean {
  return code.length >= CODE_MIN && code.length <= CODE_MAX && /^[A-Z0-9]+$/.test(code);
}

/**
 * A code for a person: their name, plus random characters.
 *
 * Personal beats random — "PRIYA7K2" shared by Priya is obviously hers, which
 * is the whole social mechanism. The random tail is what keeps it unique; the
 * caller retries on collision.
 */
export function generateCode(name: string | null | undefined): string {
  const stem = (name ?? "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, 6);

  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const tail = Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join("");

  // Four random characters, not three. Codes only ever collide within the same
  // name stem, and common Malayalam names repeat heavily across a customer
  // base — three characters gives ~30k codes per stem, where a few hundred
  // people called Priya already produce collisions the insert has to retry
  // through. Four gives ~920k, which makes it a non-event, and costs one
  // character of something people paste rather than type.
  //
  // Names in Malayalam or other scripts strip to nothing — those fall back to
  // a fully random code rather than a bare stub.
  return stem.length >= 3 ? `${stem}${tail.slice(0, 4)}` : `NC${tail}`;
}

// ── Commission maths ────────────────────────────────────────────────────────

export interface CommissionInput {
  /** What the customer actually paid, in paise. */
  orderPaise: number;
  commissionType: "percent" | "flat";
  /** Percent (1-100) or whole rupees. */
  commissionValue: number;
}

/**
 * What the referrer earns on this order.
 *
 * Calculated on the amount actually paid, not the list price, so a discounted
 * order doesn't pay a commission on money that never arrived. Capped at the
 * order value — a misconfigured 150% rate should be a visibly wrong number in
 * admin, not a debt.
 */
export function commissionPaise(input: CommissionInput): number {
  const { orderPaise, commissionType, commissionValue } = input;
  if (orderPaise <= 0 || commissionValue <= 0) return 0;

  const raw =
    commissionType === "percent"
      ? Math.floor((orderPaise * commissionValue) / 100)
      : commissionValue * 100;

  return Math.max(0, Math.min(raw, orderPaise));
}

/** Minimum chargeable amount — Razorpay rejects anything below ₹1. */
const MIN_PAYABLE_PAISE = 100;

export type RefereePricingMode = "discount" | "fixed";

export interface RefereePricingInput {
  /** The normal price of the book, in paise. */
  basePaise: number;
  mode: RefereePricingMode;
  /** Used when mode is "discount". Whole rupees off. */
  discountRupees: number;
  /** Used when mode is "fixed". The exact price a referred buyer pays. */
  priceRupees?: number | null;
}

export interface RefereePricing {
  /** What the referred buyer is charged, in paise. */
  finalPaise: number;
  /** The difference from the normal price — recorded on the order. */
  discountPaise: number;
}

/**
 * What a referred buyer pays.
 *
 * Two ways of saying it, because they fail differently. A discount stays
 * correct when the book price changes but can't express "referred buyers pay
 * ₹599"; a fixed price says exactly that but quietly stops tracking the book
 * price, which is why the admin screen shows the resulting margin next to it.
 *
 * Both are clamped so the order stays chargeable — Razorpay rejects anything
 * under ₹1 — and a fixed price above the book price is ignored rather than
 * charging a referred customer *more* than an ordinary one.
 */
export function refereePricing(input: RefereePricingInput): RefereePricing {
  const { basePaise, mode, discountRupees, priceRupees } = input;
  const floor = Math.min(MIN_PAYABLE_PAISE, basePaise);

  if (mode === "fixed") {
    // No price set yet — behave as if there were no referral rather than
    // selling the book for nothing.
    if (priceRupees == null || priceRupees <= 0) {
      return { finalPaise: basePaise, discountPaise: 0 };
    }
    const finalPaise = Math.max(floor, Math.min(priceRupees * 100, basePaise));
    return { finalPaise, discountPaise: basePaise - finalPaise };
  }

  if (discountRupees <= 0) return { finalPaise: basePaise, discountPaise: 0 };

  const discountPaise = Math.min(discountRupees * 100, Math.max(0, basePaise - floor));
  return { finalPaise: basePaise - discountPaise, discountPaise };
}

// ── Sharing ─────────────────────────────────────────────────────────────────

export function referralUrl(code: string, appUrl: string): string {
  return `${appUrl.replace(/\/$/, "")}/refer/${code}`;
}

/**
 * The pre-written WhatsApp message.
 *
 * This is where essentially all sharing happens, so it matters more than any
 * dashboard: first person, specific, and it leads with what the friend gets
 * rather than what the sharer earns.
 */
export function shareMessage(params: {
  code: string;
  appUrl: string;
  discountRupees: number;
}): string {
  const { code, appUrl, discountRupees } = params;
  const link = referralUrl(code, appUrl);
  const saving = discountRupees > 0 ? ` and save ₹${discountRupees}` : "";

  return (
    `I've been reading Neuro Code by Bisher KC — it's about rewriting the ` +
    `mental patterns that run your life, and it comes with a free NLP course.\n\n` +
    `Use my code *${code}*${saving}:\n${link}`
  );
}

export function whatsappShareLink(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

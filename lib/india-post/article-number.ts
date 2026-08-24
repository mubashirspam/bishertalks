/**
 * India Post article numbers — the tracking barcode, minted by us.
 *
 * This is the difference from Delhivery that shapes everything else. Delhivery
 * assigns a waybill in the create response; India Post allots us a *range* of
 * article IDs and we mint numbers from it ourselves, before booking. A number
 * is a consumable with a finite stock, and it is spent whether or not the
 * booking that used it succeeded.
 *
 * Not to be confused with lib/barcode.ts, which draws a Code 128 symbol on a
 * PDF. This module produces the thirteen characters; that one draws them.
 *
 * The format is the UPU's, not India Post's own invention — the same shape
 * every EMS item in the world carries:
 *
 *   ET 21433001 X IN
 *   │  │        │  └─ ISO country code of the origin administration
 *   │  │        └──── check digit, weighted modulus 11
 *   │  └───────────── eight-digit serial, from the range they allotted
 *   └──────────────── two letters identifying the service
 */

/** Positions 1–2 and 12–13 are letters; 3–11 are digits. */
const FORMAT = /^[A-Z]{2}\d{9}[A-Z]{2}$/;

/**
 * The weighting factors, applied left to right across the eight serial digits.
 *
 * Straight from the Department of Posts' barcode generation note. They are not
 * a sequence and there is no formula behind them — copying them wrongly
 * produces numbers that look right and fail at a sorting hub, so they live
 * here once and nowhere else.
 */
const WEIGHTS = [8, 6, 4, 2, 3, 5, 9, 7] as const;

/**
 * The check digit for an eight-digit serial.
 *
 * Weighted modulus 11, with three special cases that are easy to skip and
 * impossible to notice afterwards:
 *
 *   remainder 0  → 5
 *   remainder 1  → 0
 *   otherwise    → 11 - remainder, and if that is 10 use 0, if 11 use 5
 *
 * The last clause cannot arise from the arithmetic above — a remainder of 0 or
 * 1 is already handled, so 11 - remainder never reaches 10 — but it is in
 * their specification and it costs nothing to honour, and a future reader
 * comparing this against the document should find the same rules in it.
 */
export function checkDigit(serial: string): number {
  if (!/^\d{8}$/.test(serial)) {
    throw new Error(`Serial must be exactly 8 digits, got "${serial}"`);
  }

  const sum = [...serial].reduce((total, d, i) => total + Number(d) * WEIGHTS[i], 0);
  const remainder = sum % 11;

  if (remainder === 0) return 5;
  if (remainder === 1) return 0;

  const digit = 11 - remainder;
  if (digit === 10) return 0;
  if (digit === 11) return 5;
  return digit;
}

/**
 * One article number, from a serial in the allotted range.
 *
 * `serial` is the number itself, not a string: the range is arithmetic — the
 * allocator counts through it — and formatting it back to eight digits is this
 * function's job rather than every caller's.
 */
export function articleNumber(
  prefix: string,
  serial: number,
  suffix = "IN"
): string {
  const p = prefix.trim().toUpperCase();
  const s = suffix.trim().toUpperCase();

  if (!/^[A-Z]{2}$/.test(p)) throw new Error(`Prefix must be two letters, got "${prefix}"`);
  if (!/^[A-Z]{2}$/.test(s)) throw new Error(`Suffix must be two letters, got "${suffix}"`);
  if (!Number.isInteger(serial) || serial < 0 || serial > 99_999_999) {
    throw new Error(`Serial must be an integer of at most 8 digits, got ${serial}`);
  }

  const digits = String(serial).padStart(8, "0");
  return `${p}${digits}${checkDigit(digits)}${s}`;
}

/**
 * Is this a well-formed article number whose check digit agrees?
 *
 * Used on the way in as well as the way out: a range typed into the admin is
 * checked with this before a single parcel is booked against it, because a
 * mistyped prefix produces numbers that are structurally perfect and belong to
 * somebody else's allotment.
 */
export function isValidArticleNumber(value: string): boolean {
  const v = (value ?? "").trim().toUpperCase();
  if (!FORMAT.test(v)) return false;
  return Number(v[10]) === checkDigit(v.slice(2, 10));
}

/** The parts, for a number we are reading rather than minting. */
export function parseArticleNumber(
  value: string
): { prefix: string; serial: number; check: number; suffix: string } | null {
  const v = (value ?? "").trim().toUpperCase();
  if (!isValidArticleNumber(v)) return null;
  return {
    prefix: v.slice(0, 2),
    serial: Number(v.slice(2, 10)),
    check: Number(v[10]),
    suffix: v.slice(11),
  };
}

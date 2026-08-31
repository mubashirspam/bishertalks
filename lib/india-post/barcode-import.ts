import { articleNumber, checkDigit } from "./article-number";

/**
 * Reading an allotment off the file India Post gives us.
 *
 * Article numbers are not ours to invent. The Barcode Management System in the
 * Customer Selfservice Portal allots a block against our contractual account —
 * a prefix, a start and an end — and publishes it as a spreadsheet under
 * *Allocated Barcodes*. Only numbers from that block may be posted: an article
 * booked under anything else is either untracked or somebody else's.
 *
 * So this reads their file rather than asking anyone to retype it. Typing a
 * range by hand is the one input where a slip is invisible — a wrong digit
 * produces numbers that are structurally perfect, pass every check we have,
 * and belong to another customer's allotment.
 *
 * ── What it does with what it finds ───────────────────────────────────────
 *
 * Their file may list every barcode, or only the two ends of the range. Both
 * are read the same way: every article number anywhere in the workbook is
 * collected, sorted, and split into runs of consecutive serials. Each run
 * becomes one range in `postal_barcode_ranges`, which is the form the
 * allocator counts through.
 *
 * ── The check digit is verified, not assumed ──────────────────────────────
 *
 * This is the part worth being careful about. We mint each number from the
 * range with our own implementation of their weighted modulus-11 check digit
 * (article-number.ts). If that implementation disagreed with theirs by even
 * one case, every parcel would go out under a number their sorting hub reads
 * as invalid — and we would not find out until parcels started going missing.
 *
 * When their file lists the numbers themselves, we hold the answer key. So
 * every listed barcode is recomputed and compared, and a single disagreement
 * refuses the whole import naming the number. That turns the one silent
 * failure in this integration into a message on a screen, at the only moment
 * anybody is in a position to act on it.
 */

export interface ParsedRange {
  prefix: string;
  suffix: string;
  serialFrom: number;
  serialTo: number;
  count: number;
}

export interface ParsedAllotment {
  ranges: ParsedRange[];
  /** How many distinct article numbers the file contained. */
  found: number;
  /** Numbers whose check digit disagrees with ours — see above. Fatal. */
  mismatched: string[];
}

/** The shape of an article number, before its check digit is looked at. */
const ARTICLE = /^[A-Z]{2}\d{9}[A-Z]{2}$/;

/**
 * Every article number in the file, however it was laid out.
 *
 * Cell by cell rather than by column heading, deliberately. Their exports have
 * changed shape before and the heading above the numbers is not something we
 * control; a thirteen-character article number is unmistakable wherever it
 * appears, and nothing else in one of these files looks like one.
 */
export function parseAllottedBarcodes(rows: string[][]): ParsedAllotment {
  const serialsByBlock = new Map<string, Set<number>>();
  const mismatched: string[] = [];
  let found = 0;

  for (const row of rows) {
    for (const raw of row) {
      const value = (raw ?? "").replace(/\s+/g, "").toUpperCase();
      if (!ARTICLE.test(value)) continue;

      const prefix = value.slice(0, 2);
      const serial = Number(value.slice(2, 10));
      const check = Number(value[10]);
      const suffix = value.slice(11);

      found++;

      // Their number against our arithmetic. A disagreement is not a bad row
      // to skip — it means our minting is wrong for this whole allotment.
      if (check !== checkDigit(value.slice(2, 10)) && mismatched.length < 5) {
        mismatched.push(value);
      }

      const key = `${prefix}|${suffix}`;
      const set = serialsByBlock.get(key) ?? new Set<number>();
      set.add(serial);
      serialsByBlock.set(key, set);
    }
  }

  const ranges: ParsedRange[] = [];

  for (const [key, set] of serialsByBlock) {
    const [prefix, suffix] = key.split("|");
    const serials = [...set].sort((a, b) => a - b);

    // Consecutive serials become one range; a gap starts another. An allotment
    // is normally one unbroken block, but a file covering two of them — or one
    // with a number already spent removed — must not be flattened into a range
    // spanning the hole, which would hand out numbers we were never given.
    let start = serials[0];
    let previous = serials[0];

    for (let i = 1; i <= serials.length; i++) {
      const serial = serials[i];
      if (i < serials.length && serial === previous + 1) {
        previous = serial;
        continue;
      }
      ranges.push({
        prefix,
        suffix,
        serialFrom: start,
        serialTo: previous,
        count: previous - start + 1,
      });
      start = serial;
      previous = serial;
    }
  }

  ranges.sort((a, b) => a.prefix.localeCompare(b.prefix) || a.serialFrom - b.serialFrom);

  return { ranges, found, mismatched };
}

/**
 * The first and last number of a range, spelled out.
 *
 * For the confirmation an admin reads before saving — "ET21433001IN to
 * ET21434000IN, 1,000 numbers" is checkable against the allotment letter;
 * a pair of eight-digit serials is not.
 */
export function describeRange(r: ParsedRange): string {
  return `${articleNumber(r.prefix, r.serialFrom, r.suffix)} – ${articleNumber(
    r.prefix,
    r.serialTo,
    r.suffix
  )}`;
}

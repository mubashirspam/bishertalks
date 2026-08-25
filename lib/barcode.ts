import type { PdfDocument } from "@/lib/pdf";

/**
 * Code 128 barcodes, drawn straight onto a PDF as filled rectangles.
 *
 * Same reasoning as the hand-rolled PDF writer next door: a barcode is a
 * run-length pattern looked up in a fixed table, so the whole encoder is a
 * table and two loops. Pulling in a barcode library to draw ~150 black
 * rectangles would cost more in the serverless bundle than this file does in
 * total.
 *
 * Subset B only. It covers every printable ASCII character, which is all our
 * order numbers (`ORD-XXXXXX`) and any courier waybill can contain. Subset C
 * would pack long digit runs into half the width, but nothing we print is long
 * enough for that to matter, and an unused code path in a barcode encoder is a
 * scanner failure waiting to happen at a sorting hub.
 */

/**
 * The 107 Code 128 symbols, as alternating bar/space widths in modules.
 *
 * Index is the symbol value. Every pattern is six runs and 11 modules wide
 * except the stop symbol, which is seven runs and 13 — its extra bar is what
 * lets a scanner tell it read the symbol the right way round.
 */
const PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];

const START_B = 104;
const STOP = 106;

/**
 * Fold `value` into something subset B can carry.
 *
 * A character the table has no symbol for cannot be encoded at all, so the
 * choice is between dropping it and refusing to print the label. Dropping it
 * wins: a barcode missing one character still gets the parcel scanned against
 * a number a human can read off the same label, whereas no label at all stops
 * the parcel leaving the room.
 */
export function sanitizeBarcodeValue(value: string): string {
  let out = "";
  for (const c of value.trim()) {
    const code = c.codePointAt(0)!;
    if (code >= 32 && code <= 126) out += c;
  }
  return out;
}

/**
 * Bar and space widths for `value`, in modules, starting with a bar.
 *
 * Returns an empty array for a value with nothing encodable in it, so callers
 * can skip drawing rather than emit a barcode that scans as garbage.
 */
export function code128Runs(value: string): number[] {
  const text = sanitizeBarcodeValue(value);
  if (!text) return [];

  const symbols = [START_B];
  for (const c of text) symbols.push(c.codePointAt(0)! - 32);

  // Modulo-103 weighted checksum. The start symbol counts once; every symbol
  // after it is weighted by its position, counting from one.
  let sum = START_B;
  for (const [i, symbol] of symbols.slice(1).entries()) sum += symbol * (i + 1);
  symbols.push(sum % 103, STOP);

  const runs: number[] = [];
  for (const symbol of symbols) {
    for (const width of PATTERNS[symbol]) runs.push(Number(width));
  }
  return runs;
}

/** How many modules wide `value` is once encoded. Zero if it can't be. */
export function code128Width(value: string): number {
  return code128Runs(value).reduce((total, run) => total + run, 0);
}

export interface BarcodeOptions {
  /** Left edge, in points. */
  x: number;
  /** Top edge, in points — y grows downwards, as everywhere else in lib/pdf. */
  y: number;
  /** The width to fill. Bars are scaled to land exactly on it. */
  width: number;
  /** Bar height, in points. */
  height: number;
}

/**
 * Draw `value` as a Code 128 barcode, scaled to fill `width` exactly.
 *
 * Returns false when there was nothing encodable to draw, so a caller can put
 * something else in the space rather than leave a labelled gap.
 *
 * The caller owns the quiet zone. Code 128 needs a clear margin of at least
 * ten modules on both sides, and a scanner reads a barcode butted against a
 * black rule as one long bar — so `width` should be comfortably inside
 * whatever box this is being drawn into, never equal to it.
 */
export function drawBarcode(doc: PdfDocument, value: string, opts: BarcodeOptions): boolean {
  const runs = code128Runs(value);
  if (!runs.length) return false;

  const totalModules = runs.reduce((total, run) => total + run, 0);
  const module = opts.width / totalModules;

  let x = opts.x;
  for (const [i, run] of runs.entries()) {
    const w = run * module;
    // Even runs are bars, odd runs are the spaces between them. Only the bars
    // get drawn; the spaces are the label stock showing through.
    if (i % 2 === 0) doc.rect(x, opts.y, w, opts.height, 0);
    x += w;
  }
  return true;
}

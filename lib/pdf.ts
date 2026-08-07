/**
 * A very small PDF writer — enough to lay out text and rules on a page, which
 * is all a shipping label needs.
 *
 * Same reasoning as the hand-rolled .xlsx in `lib/export.ts`: the output is a
 * fixed, simple document, and a PDF using only the two built-in Helvetica
 * faces needs no font embedding, no compression and no object graph beyond a
 * catalogue and some pages. That's ~150 lines here versus a megabyte of
 * dependency in the serverless bundle.
 *
 * Coordinates are top-left origin with y increasing downwards, because that's
 * how layout code reads; the conversion to PDF's bottom-left origin happens in
 * one place.
 */

export const A4 = { width: 595.28, height: 841.89 };

export interface TextOptions {
  size?: number;
  bold?: boolean;
  /** 0 = black, 1 = white. */
  gray?: number;
  /** Truncate with an ellipsis if wider than this. */
  maxWidth?: number;
}

export interface LineOptions {
  width?: number;
  gray?: number;
  /** Dashed, for cut marks. */
  dash?: boolean;
}

// ── Text metrics ────────────────────────────────────────────────────────────
// Approximate Helvetica advance widths, as a fraction of font size. Exact AFM
// tables buy nothing here: these widths only decide where an address line
// wraps, and being a few percent out never changes the answer.
function charWidth(c: string): number {
  if (c === " ") return 0.28;
  if ("iljtfr.,:;'|!I[]()".includes(c)) return 0.28;
  if ("mwMW@".includes(c)) return 0.86;
  if (c >= "A" && c <= "Z") return 0.68;
  if (c >= "0" && c <= "9") return 0.56;
  return 0.53;
}

export function measureText(text: string, size: number, bold = false): number {
  let w = 0;
  for (const c of text) w += charWidth(c);
  // Bold is a touch wider across the board.
  return w * size * (bold ? 1.05 : 1);
}

/** Greedy word wrap. Words longer than the line are hard-broken. */
export function wrapText(
  text: string,
  maxWidth: number,
  size: number,
  bold = false
): string[] {
  const lines: string[] = [];
  let line = "";

  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (measureText(candidate, size, bold) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);

    if (measureText(word, size, bold) <= maxWidth) {
      line = word;
      continue;
    }
    // Single word too long for the line — break it mid-word.
    let chunk = "";
    for (const c of word) {
      if (measureText(chunk + c, size, bold) > maxWidth) {
        lines.push(chunk);
        chunk = c;
      } else {
        chunk += c;
      }
    }
    line = chunk;
  }

  if (line) lines.push(line);
  return lines;
}

export function truncate(
  text: string,
  maxWidth: number,
  size: number,
  bold = false
): string {
  if (measureText(text, size, bold) <= maxWidth) return text;
  let out = "";
  for (const c of text) {
    if (measureText(`${out + c}...`, size, bold) > maxWidth) break;
    out += c;
  }
  return `${out}...`;
}

// ── Encoding ────────────────────────────────────────────────────────────────
// The built-in fonts are WinAnsi, so anything outside Latin-1 has to be folded
// down. Addresses are typed in English but a stray ₹, a curly quote pasted
// from WhatsApp or an em dash would otherwise render as garbage.
const FOLD: Record<string, string> = {
  "₹": "Rs.", "—": "-", "–": "-", "‘": "'", "’": "'", "“": '"', "”": '"',
  "…": "...", " ": " ",
};

function encodeText(s: string): string {
  let out = "";
  for (const c of s) {
    const folded = FOLD[c] ?? c;
    for (const f of folded) {
      out += f.codePointAt(0)! <= 0xff ? f : "?";
    }
  }
  // PDF string literal escapes.
  return out.replace(/[\\()]/g, (m) => `\\${m}`);
}

// ── Builder ─────────────────────────────────────────────────────────────────

export class PdfDocument {
  private pages: string[][] = [];
  private current: string[] = [];
  private readonly width: number;
  private readonly height: number;

  constructor(width = A4.width, height = A4.height) {
    this.width = width;
    this.height = height;
    this.pages.push(this.current);
  }

  addPage(): void {
    this.current = [];
    this.pages.push(this.current);
  }

  get pageCount(): number {
    return this.pages.length;
  }

  /** Draw `text` with its baseline at `y` from the top of the page. */
  text(x: number, y: number, text: string, opts: TextOptions = {}): void {
    const { size = 10, bold = false, gray = 0, maxWidth } = opts;
    const body = maxWidth ? truncate(text, maxWidth, size, bold) : text;
    if (!body) return;

    this.current.push(
      `BT ${gray} g /${bold ? "F2" : "F1"} ${size} Tf ` +
        `1 0 0 1 ${fmt(x)} ${fmt(this.height - y)} Tm (${encodeText(body)}) Tj ET`
    );
  }

  line(x1: number, y1: number, x2: number, y2: number, opts: LineOptions = {}): void {
    const { width = 0.5, gray = 0.75, dash = false } = opts;
    this.current.push(
      `q ${gray} G ${fmt(width)} w ${dash ? "[2 3] 0 d " : ""}` +
        `${fmt(x1)} ${fmt(this.height - y1)} m ${fmt(x2)} ${fmt(this.height - y2)} l S Q`
    );
  }

  /** Filled rectangle, y measured from the top of the page. */
  rect(x: number, y: number, w: number, h: number, gray = 0.9): void {
    this.current.push(
      `q ${gray} g ${fmt(x)} ${fmt(this.height - y - h)} ${fmt(w)} ${fmt(h)} re f Q`
    );
  }

  build(): Buffer {
    const objects: string[] = [];
    const push = (body: string) => {
      objects.push(body);
    };

    // 1 catalog, 2 pages, 3 regular font, 4 bold font — fixed, so page objects
    // can reference them before they're written.
    const firstPageObj = 5;
    const pageIds = this.pages.map((_, i) => firstPageObj + i * 2);

    push(`<< /Type /Catalog /Pages 2 0 R >>`);
    push(
      `<< /Type /Pages /Count ${this.pages.length} ` +
        `/Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`
    );
    push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`);
    push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`);

    for (const [i, ops] of this.pages.entries()) {
      const stream = ops.join("\n");
      push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fmt(this.width)} ${fmt(this.height)}] ` +
          `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageIds[i] + 1} 0 R >>`
      );
      push(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
    }

    // Serialise, tracking byte offsets for the cross-reference table.
    const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n", "latin1")];
    let offset = chunks[0].length;
    const offsets: number[] = [];

    for (const [i, body] of objects.entries()) {
      const buf = Buffer.from(`${i + 1} 0 obj\n${body}\nendobj\n`, "latin1");
      offsets.push(offset);
      offset += buf.length;
      chunks.push(buf);
    }

    const xref = [
      `xref`,
      `0 ${objects.length + 1}`,
      `0000000000 65535 f `,
      ...offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n `),
    ].join("\n");

    chunks.push(
      Buffer.from(
        `${xref}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
          `startxref\n${offset}\n%%EOF\n`,
        "latin1"
      )
    );

    return Buffer.concat(chunks);
  }
}

/** PDF numbers: trim float noise, which otherwise triples the file size. */
function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

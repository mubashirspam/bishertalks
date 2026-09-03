import { loadFont, shape, glyphWidth, type Font } from "@/lib/truetype";
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

/**
 * The faces that can carry Malayalam, loaded only when something needs them.
 *
 * Embedding costs 103KB per face in the output, so a normal day's labels —
 * all Latin — should not pay it. `text()` records which faces a document
 * actually used and `build()` embeds exactly those.
 */
const UNICODE_FACE = {
  regular: "NotoSansMalayalam-Regular.ttf",
  bold: "NotoSansMalayalam-Bold.ttf",
} as const;

/** Does this string need more than the built-in WinAnsi faces can draw? */
function needsUnicode(s: string): boolean {
  for (const c of s) {
    const folded = FOLD[c] ?? c;
    for (const f of folded) if (f.codePointAt(0)! > 0xff) return true;
  }
  return false;
}

export function measureText(text: string, size: number, bold = false): number {
  // Measured from the embedded face when that is what will draw it. Using the
  // Helvetica table for Malayalam would wrap and truncate against the wrong
  // width, and a name cut in the wrong place is a parcel addressed to somebody
  // who does not quite exist.
  if (needsUnicode(text)) {
    const font = loadFont(UNICODE_FACE[bold ? "bold" : "regular"]);
    const glyphs = shape(font, text);
    if (glyphs) return glyphWidth(font, glyphs) * size;
  }

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
  "…": "...", " ": " ", "•": "-",
};

/**
 * Whether this string survives the fold above intact.
 *
 * Callers printing text somebody typed — a gift message, say — need to know
 * before they print it. Half the gift messages in this shop carry an emoji or
 * are written in Malayalam, and neither has a glyph in a built-in PDF font:
 * they come out as a row of question marks, which is worse than not printing
 * the message at all, because it looks like the message rather than a failure.
 */
export function isPrintable(s: string): boolean {
  for (const c of s) {
    const folded = FOLD[c] ?? c;
    for (const f of folded) if (f.codePointAt(0)! > 0xff) return false;
  }
  return true;
}

/** The same string with anything unprintable removed. May come back empty. */
export function printableOnly(s: string): string {
  let out = "";
  for (const c of s) {
    const folded = FOLD[c] ?? c;
    let ok = true;
    for (const f of folded) if (f.codePointAt(0)! > 0xff) ok = false;
    if (ok) out += folded;
  }
  return out.replace(/\s+/g, " ").trim();
}

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



/**
 * A drawing stored once and stamped onto many pages — a PDF Form XObject.
 *
 * `viewBox` is the coordinate space `content` is drawn in, and it is read as
 * SVG reads it: x right, y DOWN from the top-left. That is the opposite of
 * PDF's own axis, and the flip lives in the matrix this class builds rather
 * than in the caller, so path data lifted straight out of an SVG file can be
 * used unchanged.
 */
interface FormDef {
  viewBox: { width: number; height: number };
  content: string;
}

/**
 * A form's name in a page's resource dictionary.
 *
 * Derived from the caller's name rather than a counter so the same drawing
 * keeps the same key across pages, and sanitised because a PDF name may not
 * carry spaces or delimiters.
 */
function formRes(name: string): string {
  return `Fm${name.replace(/[^A-Za-z0-9]/g, "")}`;
}

export class PdfDocument {
  /** Which embedded faces this document has actually drawn with. */
  private usedFaces = new Set<"regular" | "bold">();
  /** Reusable drawings, by name. See defineForm. */
  private forms = new Map<string, FormDef>();
  /** The forms actually stamped, so an unused definition costs no bytes. */
  private usedForms = new Set<string>();
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

    // Malayalam, or anything else outside WinAnsi, goes through the embedded
    // face: shaped to glyph ids and written as a hex string, because
    // Identity-H addresses glyphs rather than characters.
    if (needsUnicode(body)) {
      const face = bold ? "bold" : "regular";
      const font = loadFont(UNICODE_FACE[face]);
      const glyphs = shape(font, body);

      // A character this font has no glyph for would draw as an empty box,
      // which reads as a broken label rather than a missing font. Falling back
      // gives the old row of question marks — no better, but no worse, and it
      // keeps the failure recognisable.
      if (glyphs) {
        this.usedFaces.add(face);
        const hex = glyphs.map((g) => g.toString(16).padStart(4, "0")).join("");
        this.current.push(
          `BT ${gray} g /${face === "bold" ? "F4" : "F3"} ${size} Tf ` +
            `1 0 0 1 ${fmt(x)} ${fmt(this.height - y)} Tm <${hex}> Tj ET`
        );
        return;
      }
    }

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

  /**
   * Register a drawing that can be stamped on any number of pages.
   *
   * The point is that the content is written to the file **once**. India
   * Post's emblem is about two kilobytes of path data; repeating it inline on
   * a three-hundred-label run would add most of a megabyte to a PDF somebody
   * downloads over a phone connection, for a picture that is identical every
   * time.
   *
   * Defining costs nothing on its own — a form nobody stamps is never written.
   */
  defineForm(name: string, viewBox: { width: number; height: number }, content: string): void {
    this.forms.set(name, { viewBox, content });
  }

  /**
   * Stamp a registered form into a box, y measured from the top of the page.
   *
   * Scaled to fit while keeping its proportions, and centred in whatever room
   * is left over — a logo squashed to fill a box exactly is worse than a
   * smaller one that is still the right shape.
   */
  drawForm(name: string, x: number, y: number, w: number, h: number): boolean {
    const form = this.forms.get(name);
    if (!form || !form.viewBox.width || !form.viewBox.height) return false;

    const scale = Math.min(w / form.viewBox.width, h / form.viewBox.height);
    const drawnW = form.viewBox.width * scale;
    const drawnH = form.viewBox.height * scale;
    const left = x + (w - drawnW) / 2;
    // The form's own space runs y-down from its top-left, so the matrix flips
    // it and lands that top-left at the top of the box.
    const top = this.height - (y + (h - drawnH) / 2);

    this.usedForms.add(name);
    this.current.push(
      `q ${fmt(scale)} 0 0 ${fmt(-scale)} ${fmt(left)} ${fmt(top)} cm /${formRes(name)} Do Q`
    );
    return true;
  }

  build(): Buffer {
    const objects: string[] = [];
    const push = (body: string) => {
      objects.push(body);
    };

    // 1 catalog, 2 pages, 3 regular font, 4 bold font — fixed, so page objects
    // can reference them before they're written. Each embedded face then takes
    // four more (Type0, CID font, descriptor, the file itself), which is why
    // the first page object is no longer a constant.
    const faces = [...this.usedFaces].sort();
    const faceIds = new Map<string, number>();
    faces.forEach((face, i) => faceIds.set(face, 5 + i * 4));

    // Only the forms something actually stamped — a definition nobody used
    // must not reach the file, and a page may not reference an object that was
    // never written.
    const formNames = [...this.usedForms].sort();
    const formIds = new Map<string, number>();
    formNames.forEach((name, i) => formIds.set(name, 5 + faces.length * 4 + i));

    const firstPageObj = 5 + faces.length * 4 + formNames.length;
    const pageIds = this.pages.map((_, i) => firstPageObj + i * 2);

    push(`<< /Type /Catalog /Pages 2 0 R >>`);
    push(
      `<< /Type /Pages /Count ${this.pages.length} ` +
        `/Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`
    );
    push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`);
    push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`);

    for (const face of faces) {
      const font = loadFont(UNICODE_FACE[face]);
      const id = faceIds.get(face)!;
      const name = font.postscriptName.replace(/[^A-Za-z0-9]/g, "");
      const scale = 1000 / font.unitsPerEm;
      const round = (n: number) => Math.round(n * scale);

      // Identity-H: the string addresses glyph ids directly, so no encoding
      // table has to agree with the font about what a character is.
      push(
        `<< /Type /Font /Subtype /Type0 /BaseFont /${name} ` +
          `/Encoding /Identity-H /DescendantFonts [${id + 1} 0 R] >>`
      );

      // Every glyph's width, rather than the used ones: the array is 641
      // numbers for this face and working out which glyphs a document touched
      // would mean threading that back from every text() call.
      const widths = font.advances.map(round).join(" ");
      push(
        `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${name} ` +
          `/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> ` +
          `/FontDescriptor ${id + 2} 0 R /DW 1000 /W [0 [${widths}]] ` +
          `/CIDToGIDMap /Identity >>`
      );

      // Flags bit 3 (value 4) is "symbolic", which is what a font carrying a
      // non-Latin script must claim; declaring it nonsymbolic invites a
      // viewer to apply StandardEncoding over the top.
      push(
        `<< /Type /FontDescriptor /FontName /${name} /Flags 4 ` +
          `/FontBBox [${font.bbox.map(round).join(" ")}] /ItalicAngle 0 ` +
          `/Ascent ${round(font.ascent)} /Descent ${round(font.descent)} ` +
          `/CapHeight ${round(font.ascent)} /StemV 80 /FontFile2 ${id + 3} 0 R >>`
      );

      const ttf = font.data.toString("latin1");
      push(
        `<< /Length ${font.data.length} /Length1 ${font.data.length} >>\n` +
          `stream\n${ttf}\nendstream`
      );
    }

    for (const name of formNames) {
      const form = this.forms.get(name)!;
      const stream = form.content;
      // BBox in the form's own y-down space, which the stamping matrix flips.
      // A BBox smaller than the drawing clips it, so it is the full viewBox.
      push(
        `<< /Type /XObject /Subtype /Form /FormType 1 ` +
          `/BBox [0 0 ${fmt(form.viewBox.width)} ${fmt(form.viewBox.height)}] ` +
          `/Resources << >> /Length ${Buffer.byteLength(stream, "latin1")} >>\n` +
          `stream\n${stream}\nendstream`
      );
    }

    const xobjectRes = formNames.length
      ? ` /XObject << ${formNames
          .map((n) => `/${formRes(n)} ${formIds.get(n)} 0 R`)
          .join(" ")} >>`
      : "";

    // Only the faces this document used are in the resource dictionary; a
    // page referencing a font object that was never written is a broken PDF.
    const fontRes =
      `/F1 3 0 R /F2 4 0 R` +
      (faceIds.has("regular") ? ` /F3 ${faceIds.get("regular")} 0 R` : "") +
      (faceIds.has("bold") ? ` /F4 ${faceIds.get("bold")} 0 R` : "");

    for (const [i, ops] of this.pages.entries()) {
      const stream = ops.join("\n");
      push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fmt(this.width)} ${fmt(this.height)}] ` +
          `/Resources << /Font << ${fontRes} >>${xobjectRes} >> /Contents ${pageIds[i] + 1} 0 R >>`
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

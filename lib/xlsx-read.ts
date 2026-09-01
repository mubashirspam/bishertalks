import { inflateRawSync } from "node:zlib";

/**
 * Reading a .xlsx, with no third-party dependency.
 *
 * The mirror of the writer in lib/export.ts, and here for the same reason: a
 * spreadsheet library is a large dependency to add for one admin upload. A
 * workbook is a ZIP of XML, both halves of which the standard library already
 * knows how to handle.
 *
 * Deliberately small. It reads cell *text* — every value as the string a
 * person would see — and nothing else: no formulas, no dates, no styles, no
 * merged cells. That is the whole of what the one caller needs, which is a
 * column of article numbers off a file India Post produced, and every feature
 * beyond it is a way for this to be wrong in a way nobody notices.
 *
 * A file that is not a workbook at all — a .csv renamed, a PDF, an HTML
 * export — fails here rather than three functions later, because the error a
 * person can act on is "that is not a spreadsheet", not "no barcodes found".
 */

/**
 * Element names, with or without a namespace prefix.
 *
 * Excel writes `<row>`, `<c>`, `<v>`; other writers of the same format —
 * ClosedXML and the .NET stacks built on it, which is what came back from the
 * portal-export tooling — declare the spreadsheet namespace with a prefix and
 * write `<x:row>`, `<x:c>`, `<x:v>` instead. Both are the same document to an
 * XML parser and neither is unusual, so every tag here is matched through
 * `tag()` rather than spelled literally. Matching only the bare form reads a
 * perfectly valid workbook as an empty one, and the caller then reports the
 * file as having no article numbers in it — an error about the wrong thing,
 * pointed at the one person who cannot fix it.
 */
const NS = "(?:[A-Za-z_][\\w.-]*:)?";
const tag = (name: string, rest = "") => new RegExp(`<${NS}${name}\\b${rest}`, "g");

/** The `<t>` runs that carry text, in a shared string or an inline one. */
const TEXT_RUN = tag("t", "[^>]*>([\\s\\S]*?)</" + NS + "t>");

interface ZipEntry {
  name: string;
  data: Buffer;
}

/** Every file in the archive, decompressed. */
function unzip(buf: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();

  // The end-of-central-directory record is last, but may be followed by a
  // comment of up to 64 KB — so it is found by scanning backwards for the
  // signature rather than read from a fixed offset.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 65_536; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not-a-zip");

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);

  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) break;

    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);

    // The local header repeats the name and extra fields, and its own lengths
    // are the ones that count — some writers pad the extra field differently
    // in the two places, and trusting the central copy reads from the wrong
    // byte.
    if (buf.readUInt32LE(localOffset) === 0x04034b50) {
      const lNameLen = buf.readUInt16LE(localOffset + 26);
      const lExtraLen = buf.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + lNameLen + lExtraLen;
      const raw = buf.subarray(start, start + compressedSize);

      try {
        files.set(name, method === 0 ? Buffer.from(raw) : inflateRawSync(raw));
      } catch {
        // A part we cannot decompress is skipped rather than fatal: the
        // workbook may still contain the sheet we want.
      }
    }

    p += 46 + nameLen + extraLen + commentLen;
  }

  if (!files.size) throw new Error("not-a-zip");
  return files;
}

const unescapeXml = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");

/** The `<si>` table, which is where most text in a real workbook lives. */
function sharedStrings(files: Map<string, Buffer>): string[] {
  const xml = files.get("xl/sharedStrings.xml")?.toString("utf8");
  if (!xml) return [];

  const out: string[] = [];
  for (const si of xml.matchAll(new RegExp(`<${NS}si\\b[^>]*>([\\s\\S]*?)</${NS}si>`, "g"))) {
    // A single <si> can be split across several <t> runs when part of the text
    // is styled differently; joining them is what the reader sees as one cell.
    const text = [...si[1].matchAll(TEXT_RUN)].map((t) => t[1]).join("");
    out.push(unescapeXml(text));
  }
  return out;
}

export interface XLSXReadSheet {
  name: string;
  /** Rows of cell text, ragged — trailing empty cells are not padded. */
  rows: string[][];
}

/**
 * Every sheet in the workbook, as text.
 *
 * Sheets come back in workbook order with their tab names, because which tab a
 * value was on can be the difference between an allotment and an example.
 */
export function readXLSX(buf: Buffer, maxRowsPerSheet = 20_000): XLSXReadSheet[] {
  const files = unzip(buf);
  const strings = sharedStrings(files);

  const workbook = files.get("xl/workbook.xml")?.toString("utf8") ?? "";
  const rels = files.get("xl/_rels/workbook.xml.rels")?.toString("utf8") ?? "";

  // Id and Target are read out of the tag separately because their order in it
  // is not fixed: Excel writes Id first, ClosedXML writes Type, Target, Id. One
  // pattern spanning both attributes matches only one of those two files.
  const target = new Map<string, string>();
  for (const m of rels.matchAll(tag("Relationship", "([^>]*?)/?>"))) {
    const id = /\bId="([^"]+)"/.exec(m[1])?.[1];
    const path = /\bTarget="([^"]+)"/.exec(m[1])?.[1];
    if (id && path) target.set(id, path.replace(/^\/?(xl\/)?/, ""));
  }

  const sheets: XLSXReadSheet[] = [];

  for (const m of workbook.matchAll(tag("sheet", "([^>]*?)/?>"))) {
    const attrs = m[1];
    const name = unescapeXml(/name="([^"]*)"/.exec(attrs)?.[1] ?? "");
    const rid = /[\w.-]+:id="([^"]*)"/.exec(attrs)?.[1] ?? "";
    const path = target.get(rid);
    if (!path) continue;

    const xml = files.get(`xl/${path}`)?.toString("utf8");
    if (!xml) continue;

    sheets.push({ name, rows: parseSheet(xml, strings, maxRowsPerSheet) });
  }

  // A workbook whose relationships we could not follow still has its sheets on
  // disk under conventional names. Worth the fallback: this reads files other
  // people's systems produced, and "no sheets" over a naming detail is a
  // support call.
  if (!sheets.length) {
    for (const [name, data] of files) {
      if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(name)) continue;
      sheets.push({
        name: name.replace(/^xl\/worksheets\//, "").replace(/\.xml$/, ""),
        rows: parseSheet(data.toString("utf8"), strings, maxRowsPerSheet),
      });
    }
  }

  return sheets;
}

function parseSheet(xml: string, strings: string[], maxRows: number): string[][] {
  const rows: string[][] = [];

  for (const r of xml.matchAll(new RegExp(`<${NS}row\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${NS}row>)`, "g"))) {
    if (rows.length >= maxRows) break;

    const cells: string[] = [];
    // The attribute run is LAZY, and that is not a style choice.
    //
    // Greedy, `[^>]*` swallows the `/` of a self-closing `<c r="B1" s="5"/>`,
    // so the `\/>` branch can never match and the `>` branch takes over —
    // which then runs `([\s\S]*?)<\/c>` on to the NEXT cell's closing tag and
    // eats it whole. The empty cell and the one after it come back as a single
    // cell, carrying the wrong column and the following cell's raw `<v>`.
    //
    // The visible symptom is a shared string appearing as its own index: a
    // header reading "7" instead of "PRIORITY FLAG", and — the reason this is
    // worth a paragraph — an article number in the cell after a blank one
    // silently not being read at all by the allotment importer.
    for (const c of (r[2] ?? "").matchAll(
      new RegExp(`<${NS}c\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${NS}c>)`, "g")
    )) {
      const attrs = c[1];
      const inner = c[2] ?? "";

      // The cell's column letters place it, so a row that skips B does not
      // shift everything after it one to the left.
      const ref = /r="([A-Z]+)\d+"/.exec(attrs)?.[1];
      const index = ref ? colIndex(ref) : cells.length;

      const type = /t="([^"]*)"/.exec(attrs)?.[1];
      let value = "";

      if (type === "inlineStr") {
        value = [...inner.matchAll(TEXT_RUN)].map((t) => t[1]).join("");
      } else {
        const v = new RegExp(`<${NS}v\\b[^>]*>([\\s\\S]*?)</${NS}v>`).exec(inner)?.[1] ?? "";
        value =
          type === "s"
            ? strings[Number(v)] ?? ""
            : // A boolean is stored as 1/0 and read by a person as TRUE/FALSE.
              // India Post's own Information tab uses them for the flag
              // columns, and "1" in a column documented as TRUE/FALSE is the
              // kind of difference that gets copied into a file and refused.
              type === "b"
              ? v === "1"
                ? "TRUE"
                : "FALSE"
              : v;
      }

      while (cells.length < index) cells.push("");
      cells[index] = unescapeXml(value).trim();
    }

    rows.push(cells);
  }

  return rows;
}

/** "A" -> 0, "AA" -> 26. */
function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * A .csv or .txt as the same ragged rows, so one caller can take either.
 *
 * Quoted fields are honoured because an address or a note in a column will
 * contain a comma; nothing else about CSV is interpreted.
 */
export function readCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  const push = () => {
    row.push(cell.trim());
    cell = "";
  };
  const endRow = () => {
    push();
    rows.push(row);
    row = [];
  };

  const s = text.replace(/^﻿/, "");

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];

    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') quoted = true;
    else if (ch === ",") push();
    else if (ch === "\n") endRow();
    else if (ch !== "\r") cell += ch;
  }

  if (cell || row.length) endRow();
  return rows;
}

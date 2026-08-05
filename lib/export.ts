import { deflateRawSync, crc32 } from "node:zlib";

/**
 * CSV and real .xlsx export, with no third-party dependency.
 *
 * XLSX is just a ZIP of XML parts, and these exports are small, so writing the
 * archive directly is cheaper than adding a spreadsheet library to the bundle.
 */

// ── CSV ──────────────────────────────────────────────────────────────────────

function csvCell(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  // Quote anything containing a delimiter, quote or newline; double inner quotes.
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Rows to CSV.
 *
 * Prefixed with a UTF-8 BOM: without it Excel on Windows reads the file as
 * ANSI and mangles ₹ and non-ASCII names.
 */
export function toCSV(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvCell).join(",")];
  for (const r of rows) lines.push(r.map(csvCell).join(","));
  return "﻿" + lines.join("\r\n");
}

// ── XLSX ─────────────────────────────────────────────────────────────────────

const xmlEscape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
   .replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** Column index (0-based) to spreadsheet letters: 0 -> A, 26 -> AA. */
function colName(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  }
  return s;
}

function sheetXml(headers: string[], rows: unknown[][]): string {
  const cell = (v: unknown, ci: number, ri: number) => {
    const ref = `${colName(ci)}${ri}`;
    if (typeof v === "number" && Number.isFinite(v)) {
      return `<c r="${ref}"><v>${v}</v></c>`;
    }
    if (v == null || v === "") return "";
    // `t="inlineStr"` avoids needing a shared-strings part.
    return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(String(v))}</t></is></c>`;
  };

  const body = [
    `<row r="1">${headers.map((h, i) => cell(h, i, 1)).join("")}</row>`,
    ...rows.map(
      (r, ri) => `<row r="${ri + 2}">${r.map((v, ci) => cell(v, ci, ri + 2)).join("")}</row>`
    ),
  ].join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

interface ZipEntry { name: string; data: Buffer; }

/** Minimal ZIP writer (deflate), enough for the OOXML parts below. */
function zip(entries: ZipEntry[]): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const compressed = deflateRawSync(e.data);
    const crc = crc32(e.data) >>> 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);   // local file header
    local.writeUInt16LE(20, 4);           // version needed
    local.writeUInt16LE(0, 6);            // flags
    local.writeUInt16LE(8, 8);            // method: deflate
    local.writeUInt16LE(0, 10);           // mod time
    local.writeUInt16LE(0x21, 12);        // mod date (1 Jan 1980)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);           // extra length

    chunks.push(local, name, compressed);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);      // central directory header
    cd.writeUInt16LE(20, 4);              // version made by
    cd.writeUInt16LE(20, 6);              // version needed
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0x21, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(compressed.length, 20);
    cd.writeUInt32LE(e.data.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt16LE(0, 30);              // extra
    cd.writeUInt16LE(0, 32);              // comment
    cd.writeUInt16LE(0, 34);              // disk
    cd.writeUInt16LE(0, 36);              // internal attrs
    cd.writeUInt32LE(0, 38);              // external attrs
    cd.writeUInt32LE(offset, 42);         // local header offset
    central.push(cd, name);

    offset += local.length + name.length + compressed.length;
  }

  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);       // end of central directory
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, cdBuf, end]);
}

/** Build a single-sheet .xlsx workbook. */
export function toXLSX(headers: string[], rows: unknown[][], sheetName = "Sheet1"): Buffer {
  const b = (s: string) => Buffer.from(s, "utf8");

  return zip([
    {
      name: "[Content_Types].xml",
      data: b(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`),
    },
    {
      name: "_rels/.rels",
      data: b(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    },
    {
      name: "xl/workbook.xml",
      data: b(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEscape(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: b(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`),
    },
    { name: "xl/worksheets/sheet1.xml", data: b(sheetXml(headers, rows)) },
  ]);
}

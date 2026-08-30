import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Enough TrueType to put Malayalam on a label.
 *
 * The PDF writer next door uses the two built-in Helvetica faces, which are
 * WinAnsi — every Malayalam codepoint folds to a question mark. Ten of four
 * thousand paid orders have a Malayalam buyer name and thirty have Malayalam
 * somewhere in the address, and each of those printed a row of `?` where a
 * delivery person needed a name.
 *
 * So: read a font, find the glyph for each character, measure it, and hand
 * the PDF layer a glyph-id string it can embed with Identity-H.
 *
 * What this parses, and nothing more:
 *
 *   head  unitsPerEm, so advances scale to points
 *   maxp  glyph count
 *   hhea  how many entries hmtx really has
 *   hmtx  advance widths
 *   cmap  character to glyph, formats 4 and 12
 *   GSUB  single and ligature substitutions, which is what joins a Malayalam
 *         conjunct into one glyph instead of leaving a visible chandrakkala
 *
 * It is not a shaping engine. GPOS is ignored, so marks sit on their default
 * advances, and the reordering below is the one rule Malayalam cannot do
 * without. That is the honest ceiling of ~400 lines; it renders these names
 * correctly and would not survive being pointed at Devanagari.
 */

export interface Font {
  data: Buffer;
  unitsPerEm: number;
  numGlyphs: number;
  /** Advance width per glyph id, in font units. */
  advances: number[];
  cmap: Map<number, number>;
  /** Applied in order; see shape(). */
  lookups: GsubLookup[];
  postscriptName: string;
  /** In font units — what a PDF FontDescriptor asks for. */
  bbox: [number, number, number, number];
  ascent: number;
  descent: number;
}

type GsubLookup =
  | { type: 1; map: Map<number, number> }
  | { type: 4; ligatures: Map<number, { components: number[]; glyph: number }[]> };

// ── Table plumbing ──────────────────────────────────────────────────────────

const u16 = (b: Buffer, o: number) => b.readUInt16BE(o);
const i16 = (b: Buffer, o: number) => b.readInt16BE(o);
const u32 = (b: Buffer, o: number) => b.readUInt32BE(o);

function tables(b: Buffer): Map<string, { offset: number; length: number }> {
  const out = new Map<string, { offset: number; length: number }>();
  const count = u16(b, 4);
  for (let i = 0; i < count; i++) {
    const p = 12 + i * 16;
    out.set(b.toString("latin1", p, p + 4), {
      offset: u32(b, p + 8),
      length: u32(b, p + 12),
    });
  }
  return out;
}

// ── cmap ────────────────────────────────────────────────────────────────────

function readCmap(b: Buffer, off: number): Map<number, number> {
  const map = new Map<number, number>();
  const n = u16(b, off + 2);

  // Prefer a full-Unicode subtable, fall back to the BMP one. Malayalam sits
  // in the BMP, so format 4 is enough here — but a font that only ships
  // format 12 would otherwise look like a font with no characters at all.
  let best = -1;
  let bestScore = -1;
  for (let i = 0; i < n; i++) {
    const p = off + 4 + i * 8;
    const platform = u16(b, p);
    const encoding = u16(b, p + 2);
    const sub = off + u32(b, p + 4);
    const format = u16(b, sub);
    const score =
      platform === 3 && encoding === 10 ? 4 // Windows UCS-4
      : platform === 0 && format === 12 ? 3
      : platform === 3 && encoding === 1 ? 2 // Windows BMP
      : platform === 0 ? 1
      : 0;
    if (score > bestScore) {
      bestScore = score;
      best = sub;
    }
  }
  if (best < 0) return map;

  const format = u16(b, best);

  if (format === 4) {
    const segX2 = u16(b, best + 6);
    const segs = segX2 / 2;
    const ends = best + 14;
    const starts = ends + segX2 + 2;
    const deltas = starts + segX2;
    const ranges = deltas + segX2;

    for (let s = 0; s < segs; s++) {
      const end = u16(b, ends + s * 2);
      const start = u16(b, starts + s * 2);
      const delta = i16(b, deltas + s * 2);
      const rangeOff = u16(b, ranges + s * 2);
      if (start > end) continue;

      for (let c = start; c <= end && c !== 0xffff; c++) {
        let g: number;
        if (rangeOff === 0) {
          g = (c + delta) & 0xffff;
        } else {
          const gi = ranges + s * 2 + rangeOff + (c - start) * 2;
          if (gi + 1 >= b.length) continue;
          g = u16(b, gi);
          if (g !== 0) g = (g + delta) & 0xffff;
        }
        if (g) map.set(c, g);
      }
    }
  } else if (format === 12) {
    const groups = u32(b, best + 12);
    for (let i = 0; i < groups; i++) {
      const p = best + 16 + i * 12;
      const start = u32(b, p);
      const end = u32(b, p + 4);
      const startGlyph = u32(b, p + 8);
      // A pathological font could claim a range covering the whole plane.
      for (let c = start; c <= end && c - start < 0x10000; c++) {
        map.set(c, startGlyph + (c - start));
      }
    }
  }

  return map;
}

// ── GSUB ────────────────────────────────────────────────────────────────────

function readCoverage(b: Buffer, off: number): number[] {
  const format = u16(b, off);
  const out: number[] = [];
  if (format === 1) {
    const n = u16(b, off + 2);
    for (let i = 0; i < n; i++) out.push(u16(b, off + 4 + i * 2));
  } else if (format === 2) {
    const n = u16(b, off + 2);
    for (let i = 0; i < n; i++) {
      const p = off + 4 + i * 6;
      const start = u16(b, p);
      const end = u16(b, p + 2);
      for (let g = start; g <= end; g++) out.push(g);
    }
  }
  return out;
}

/**
 * The features that build a Malayalam cluster, in the order they apply.
 *
 * Taken from the OpenType Indic shaping model. `akhn` makes the ka-ssa and
 * conjunct akhands, `cjct` and `half` join a consonant to a following one
 * across a chandrakkala, and the rest place the pieces. Ordering matters:
 * running `cjct` before `akhn` produces a different, wrong, glyph for കൃ.
 */
const MALAYALAM_FEATURES = [
  "akhn", "rphf", "pref", "blwf", "half", "pstf", "vatu", "cjct",
  "abvs", "blws", "psts", "haln", "calt", "liga",
];

function readGsub(b: Buffer, off: number): GsubLookup[] {
  const featureListOff = off + u16(b, off + 6);
  const lookupListOff = off + u16(b, off + 8);

  // Which lookups the features above use. Read from the feature list directly
  // rather than walking the script list: this font is only ever asked to set
  // Malayalam and Latin, and a script/langsys walk adds a layer of indirection
  // for no behaviour we would use.
  const wanted = new Set<number>();
  const featureCount = u16(b, featureListOff);
  const order = new Map<number, number>();

  for (let i = 0; i < featureCount; i++) {
    const p = featureListOff + 2 + i * 6;
    const tag = b.toString("latin1", p, p + 4);
    const rank = MALAYALAM_FEATURES.indexOf(tag);
    if (rank < 0) continue;

    const feature = featureListOff + u16(b, p + 4);
    const n = u16(b, feature + 2);
    for (let j = 0; j < n; j++) {
      const idx = u16(b, feature + 4 + j * 2);
      wanted.add(idx);
      // A lookup used by two features runs at the earlier one's rank.
      order.set(idx, Math.min(order.get(idx) ?? rank, rank));
    }
  }

  const lookupCount = u16(b, lookupListOff);
  const parsed: { rank: number; lookup: GsubLookup }[] = [];

  for (const index of wanted) {
    if (index >= lookupCount) continue;
    const lookup = lookupListOff + u16(b, lookupListOff + 2 + index * 2);
    const type = u16(b, lookup);
    const subCount = u16(b, lookup + 4);

    for (let s = 0; s < subCount; s++) {
      const sub = lookup + u16(b, lookup + 6 + s * 2);

      if (type === 1) {
        const format = u16(b, sub);
        const coverage = readCoverage(b, sub + u16(b, sub + 2));
        const map = new Map<number, number>();
        if (format === 1) {
          const delta = i16(b, sub + 4);
          for (const g of coverage) map.set(g, (g + delta) & 0xffff);
        } else if (format === 2) {
          const n = u16(b, sub + 4);
          for (let i = 0; i < n && i < coverage.length; i++) {
            map.set(coverage[i], u16(b, sub + 6 + i * 2));
          }
        }
        if (map.size) parsed.push({ rank: order.get(index)!, lookup: { type: 1, map } });
      } else if (type === 4) {
        const coverage = readCoverage(b, sub + u16(b, sub + 2));
        const setCount = u16(b, sub + 4);
        const ligatures = new Map<number, { components: number[]; glyph: number }[]>();

        for (let i = 0; i < setCount && i < coverage.length; i++) {
          const set = sub + u16(b, sub + 6 + i * 2);
          const ligCount = u16(b, set);
          const list: { components: number[]; glyph: number }[] = [];

          for (let l = 0; l < ligCount; l++) {
            const lig = set + u16(b, set + 2 + l * 2);
            const glyph = u16(b, lig);
            const compCount = u16(b, lig + 2);
            const components: number[] = [];
            for (let c = 1; c < compCount; c++) components.push(u16(b, lig + 2 + c * 2));
            list.push({ components, glyph });
          }
          // Longest first, so ക്ക്ക does not match the two-glyph ligature
          // when a three-glyph one exists.
          list.sort((a, z) => z.components.length - a.components.length);
          ligatures.set(coverage[i], list);
        }
        if (ligatures.size) {
          parsed.push({ rank: order.get(index)!, lookup: { type: 4, ligatures } });
        }
      }
      // Types 2, 5, 6, 7 and 8 are ignored. Contextual substitution is where
      // a real shaper starts and this deliberately stops.
    }
  }

  parsed.sort((a, z) => a.rank - z.rank);
  return parsed.map((p) => p.lookup);
}

// ── Loading ─────────────────────────────────────────────────────────────────

const cache = new Map<string, Font>();

export function loadFont(file: string): Font {
  const cached = cache.get(file);
  if (cached) return cached;

  const data = readFileSync(path.join(process.cwd(), "public/fonts", file));
  const t = tables(data);

  const head = t.get("head")!;
  const maxp = t.get("maxp")!;
  const hhea = t.get("hhea")!;
  const hmtx = t.get("hmtx")!;

  const unitsPerEm = u16(data, head.offset + 18);
  const bbox: [number, number, number, number] = [
    i16(data, head.offset + 36),
    i16(data, head.offset + 38),
    i16(data, head.offset + 40),
    i16(data, head.offset + 42),
  ];
  const ascent = i16(data, hhea.offset + 4);
  const descent = i16(data, hhea.offset + 6);
  const numGlyphs = u16(data, maxp.offset + 4);
  const numHMetrics = u16(data, hhea.offset + 34);

  // hmtx stores a width per glyph up to numHMetrics, then every remaining
  // glyph repeats the last one — that is how a monospaced tail is encoded.
  const advances: number[] = [];
  let last = 0;
  for (let g = 0; g < numGlyphs; g++) {
    if (g < numHMetrics) last = u16(data, hmtx.offset + g * 4);
    advances.push(last);
  }

  const cmapTable = t.get("cmap");
  const gsubTable = t.get("GSUB");

  const font: Font = {
    data,
    unitsPerEm,
    numGlyphs,
    advances,
    cmap: cmapTable ? readCmap(data, cmapTable.offset) : new Map(),
    lookups: gsubTable ? readGsub(data, gsubTable.offset) : [],
    postscriptName: file.replace(/\.ttf$/i, ""),
    bbox,
    ascent,
    descent,
  };

  cache.set(file, font);
  return font;
}

// ── Shaping, such as it is ──────────────────────────────────────────────────

/** Malayalam vowel signs stored after the consonant but drawn before it. */
const PRE_BASE = new Set(["െ", "േ", "ൈ"]);

/**
 * Two-part vowel signs, which Unicode stores as one character and the font
 * draws as a pre-base piece plus a post-base one.
 */
const SPLIT_VOWELS: Record<string, [string, string]> = {
  "ൊ": ["െ", "ാ"], // ொ
  "ോ": ["േ", "ാ"], // ோ
  "ൌ": ["െ", "ൗ"], // ൌ
};

/**
 * Reorder a Malayalam cluster the way it is drawn rather than stored.
 *
 * Unicode keeps a vowel sign after its consonant because that is how the
 * syllable is spoken. Malayalam draws ്െ to the LEFT of the consonant it
 * belongs to, so a renderer that trusts the byte order puts the vowel on the
 * wrong side of the letter. This is the single reordering rule the script
 * cannot be read without.
 */
function reorder(text: string): string {
  const chars = [...text];
  const out: string[] = [];
  let i = 0;

  while (i < chars.length) {
    const c = chars[i];

    // Expand a two-part vowel first, so the pre-base half is moved and the
    // post-base half stays put.
    const split = SPLIT_VOWELS[c];
    if (split) {
      chars.splice(i, 1, split[0], split[1]);
      continue;
    }

    if (PRE_BASE.has(c) && out.length) {
      // Walk back over the consonant cluster this vowel belongs to: the base
      // consonant plus any chandrakkala-joined consonants before it.
      let start = out.length - 1;
      while (start > 0 && out[start - 1] === "്") start -= 2;
      if (start < 0) start = 0;
      out.splice(start, 0, c);
      i++;
      continue;
    }

    out.push(c);
    i++;
  }

  return out.join("");
}

/**
 * Text to glyph ids, with substitutions applied.
 *
 * Returns null when a character has no glyph in this font, so the caller can
 * fall back rather than print a row of notdefs — which look like empty boxes
 * and read as a broken label rather than a missing font.
 */
export function shape(font: Font, text: string): number[] | null {
  let glyphs: number[] = [];

  for (const c of reorder(text)) {
    const g = font.cmap.get(c.codePointAt(0)!);
    if (g === undefined) return null;
    glyphs.push(g);
  }

  for (const lookup of font.lookups) {
    if (lookup.type === 1) {
      glyphs = glyphs.map((g) => lookup.map.get(g) ?? g);
      continue;
    }

    const out: number[] = [];
    for (let i = 0; i < glyphs.length; ) {
      const candidates = lookup.ligatures.get(glyphs[i]);
      let matched = false;

      for (const lig of candidates ?? []) {
        const end = i + 1 + lig.components.length;
        if (end > glyphs.length) continue;
        if (lig.components.every((g, k) => glyphs[i + 1 + k] === g)) {
          out.push(lig.glyph);
          i = end;
          matched = true;
          break;
        }
      }

      if (!matched) out.push(glyphs[i++]);
    }
    glyphs = out;
  }

  return glyphs;
}

/** The width of a shaped run, as a fraction of the font size. */
export function glyphWidth(font: Font, glyphs: number[]): number {
  let total = 0;
  for (const g of glyphs) total += font.advances[g] ?? 0;
  return total / font.unitsPerEm;
}

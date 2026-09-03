/**
 * SVG path data, converted to PDF path operators.
 *
 * Written because the label needs India Post's emblem on it and this PDF
 * writer has no image support — no XObject images, no Flate stream, no PNG
 * decoder. Adding all three to paint one logo would be the larger change, and
 * a raster logo on a thermal printer is the worse result: it prints at
 * whatever resolution it was rasterised for, while a path is re-rendered by
 * the printer at its own.
 *
 * PDF and SVG draw with almost the same primitives, which is what makes this
 * short. Both have move / line / cubic Bézier / close; PDF's `m l c h` are
 * SVG's `M L C Z`. Three things do not line up, and they are the whole file:
 *
 *   * SVG has shorthands — `H V S T` and every command in a relative form —
 *     that PDF does not. They are expanded here.
 *   * SVG has elliptical arcs and quadratic Béziers. PDF has neither, so both
 *     are converted to cubics.
 *   * SVG's y axis points down and PDF's points up. NOT handled here: the
 *     caller sets a transform once (see PdfDocument.form) rather than having
 *     every coordinate flipped twice.
 */

/** A number, trimmed — PDF is a text format and these repeat thousands of times. */
function fmt(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? "0" : String(r);
}

/**
 * Split path data into commands and their numbers.
 *
 * Handles the compressions real SVG files use and hand-written examples do
 * not: implicit repeats (`M` followed by several coordinate pairs continues as
 * `L`), separators that are commas or spaces or neither, exponents, and the
 * sign doubling as a separator — `M83.4,67.83H426.14V261.51` and
 * `c-1.5-2.3.4-.9` are both in the file this was written for.
 */
function tokenize(d: string): { cmd: string; args: number[] }[] {
  const out: { cmd: string; args: number[] }[] = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?)/g;

  let cmd = "";
  let args: number[] = [];
  const flush = () => {
    if (cmd) out.push({ cmd, args });
    args = [];
  };

  for (const m of d.matchAll(re)) {
    if (m[1]) {
      flush();
      cmd = m[1];
    } else {
      args.push(Number(m[2]));
    }
  }
  flush();
  return out;
}

/** How many numbers each command consumes per repeat. */
const ARITY: Record<string, number> = {
  M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0,
};

/**
 * One elliptical arc as up to four cubic Béziers.
 *
 * The endpoint parameterisation SVG uses says where the arc ends; PDF needs
 * control points, so the centre has to be recovered first. This is the
 * conversion in the SVG specification's implementation notes (F.6.5 and
 * F.6.6), including the correction step where a radius too small to span the
 * two points is scaled up until it fits — without it, a rounding error in the
 * source file turns into a NaN and the whole path vanishes.
 */
function arcToCubics(
  x1: number,
  y1: number,
  rx: number,
  ry: number,
  angleDeg: number,
  largeArc: boolean,
  sweep: boolean,
  x2: number,
  y2: number
): number[][] {
  // Degenerate radii are a straight line, per the specification.
  if (!rx || !ry) return [[x2, y2, x2, y2, x2, y2]];

  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const phi = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);

  const dx2 = (x1 - x2) / 2;
  const dy2 = (y1 - y2) / 2;
  const x1p = cos * dx2 + sin * dy2;
  const y1p = -sin * dx2 + cos * dy2;

  // F.6.6 — grow the radii until they can actually reach.
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }

  const sign = largeArc === sweep ? -1 : 1;
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const co = sign * Math.sqrt(Math.max(0, num / den));

  const cxp = (co * rx * y1p) / ry;
  const cyp = (-co * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;

  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const dot = ux * vx + uy * vy;
    const len = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy));
    let a = Math.acos(Math.min(1, Math.max(-1, dot / (len || 1))));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };

  const theta = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let delta = angle(
    (x1p - cxp) / rx,
    (y1p - cyp) / ry,
    (-x1p - cxp) / rx,
    (-y1p - cyp) / ry
  );
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;

  // A cubic approximates a circular arc well below about 90 degrees and
  // visibly badly above it, so the sweep is split.
  const segments = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2)));
  const step = delta / segments;
  // The magic constant: the control-point distance that makes a cubic match a
  // circular arc of this angle.
  const k = (4 / 3) * Math.tan(step / 4);

  const out: number[][] = [];
  let t = theta;

  for (let i = 0; i < segments; i++) {
    const cosT = Math.cos(t);
    const sinT = Math.sin(t);
    const t1 = t + step;
    const cosT1 = Math.cos(t1);
    const sinT1 = Math.sin(t1);

    // Points and tangents on the unit circle, then scaled by the radii and
    // rotated back into place.
    const map = (ex: number, ey: number): [number, number] => [
      cx + cos * rx * ex - sin * ry * ey,
      cy + sin * rx * ex + cos * ry * ey,
    ];

    const [p1x, p1y] = map(cosT - k * sinT, sinT + k * cosT);
    const [p2x, p2y] = map(cosT1 + k * sinT1, sinT1 - k * cosT1);
    const [ex, ey] = map(cosT1, sinT1);

    out.push([p1x, p1y, p2x, p2y, ex, ey]);
    t = t1;
  }

  return out;
}

/**
 * SVG path data as a PDF path — the construction operators only.
 *
 * No painting operator is appended: the caller decides whether this is filled,
 * stroked, non-zero or even-odd, and appending `f` here would make a path that
 * cannot be used as a clip.
 *
 * Anything unparseable yields "", so a malformed `d` costs the shape and not
 * the page.
 */
export function svgPathToPdf(d: string): string {
  const ops: string[] = [];
  let x = 0;
  let y = 0;
  // The start of the current subpath, which is where `Z` returns to — not the
  // start of the path. A logo is many subpaths and closing to the wrong one
  // draws a line across the whole glyph.
  let startX = 0;
  let startY = 0;
  // The previous curve's second control point, reflected by `S` and `T`.
  let lastC: [number, number] | null = null;
  let lastQ: [number, number] | null = null;
  let prev = "";

  const move = (nx: number, ny: number) => {
    ops.push(`${fmt(nx)} ${fmt(ny)} m`);
    x = startX = nx;
    y = startY = ny;
  };
  const line = (nx: number, ny: number) => {
    ops.push(`${fmt(nx)} ${fmt(ny)} l`);
    x = nx;
    y = ny;
  };
  const cubic = (
    c1x: number, c1y: number, c2x: number, c2y: number, ex: number, ey: number
  ) => {
    ops.push(
      `${fmt(c1x)} ${fmt(c1y)} ${fmt(c2x)} ${fmt(c2y)} ${fmt(ex)} ${fmt(ey)} c`
    );
    lastC = [c2x, c2y];
    x = ex;
    y = ey;
  };

  for (const { cmd, args } of tokenize(d)) {
    const upper = cmd.toUpperCase();
    const rel = cmd !== upper;
    const arity = ARITY[upper];
    if (arity === undefined) continue;

    if (upper === "Z") {
      ops.push("h");
      x = startX;
      y = startY;
      lastC = lastQ = null;
      prev = upper;
      continue;
    }

    // A command's numbers repeat: `L 1 2 3 4` is two lines. `M` is the odd one
    // — its repeats are lines, not moves, which is how most path data encodes
    // a polygon.
    for (let i = 0; i + arity <= args.length; i += arity) {
      const a = args.slice(i, i + arity);
      const implicit = i > 0;
      const op = implicit && upper === "M" ? "L" : upper;

      switch (op) {
        case "M":
          move(rel ? x + a[0] : a[0], rel ? y + a[1] : a[1]);
          lastC = lastQ = null;
          break;
        case "L":
          line(rel ? x + a[0] : a[0], rel ? y + a[1] : a[1]);
          lastC = lastQ = null;
          break;
        case "H":
          line(rel ? x + a[0] : a[0], y);
          lastC = lastQ = null;
          break;
        case "V":
          line(x, rel ? y + a[0] : a[0]);
          lastC = lastQ = null;
          break;
        case "C":
          cubic(
            rel ? x + a[0] : a[0], rel ? y + a[1] : a[1],
            rel ? x + a[2] : a[2], rel ? y + a[3] : a[3],
            rel ? x + a[4] : a[4], rel ? y + a[5] : a[5]
          );
          lastQ = null;
          break;
        case "S": {
          // The first control point mirrors the previous curve's second one —
          // but only when the previous command actually was a cubic. After
          // anything else the specification says use the current point.
          const smooth = prev === "C" || prev === "S";
          const c1x = smooth && lastC ? 2 * x - lastC[0] : x;
          const c1y = smooth && lastC ? 2 * y - lastC[1] : y;
          cubic(
            c1x, c1y,
            rel ? x + a[0] : a[0], rel ? y + a[1] : a[1],
            rel ? x + a[2] : a[2], rel ? y + a[3] : a[3]
          );
          lastQ = null;
          break;
        }
        case "Q": {
          const qx = rel ? x + a[0] : a[0];
          const qy = rel ? y + a[1] : a[1];
          const ex = rel ? x + a[2] : a[2];
          const ey = rel ? y + a[3] : a[3];
          // A quadratic is exactly a cubic whose controls sit two thirds of
          // the way to the quadratic's single one.
          cubic(
            x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y),
            ex + (2 / 3) * (qx - ex), ey + (2 / 3) * (qy - ey),
            ex, ey
          );
          lastQ = [qx, qy];
          break;
        }
        case "T": {
          const smooth = prev === "Q" || prev === "T";
          const qx: number = smooth && lastQ ? 2 * x - lastQ[0] : x;
          const qy: number = smooth && lastQ ? 2 * y - lastQ[1] : y;
          const ex = rel ? x + a[0] : a[0];
          const ey = rel ? y + a[1] : a[1];
          cubic(
            x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y),
            ex + (2 / 3) * (qx - ex), ey + (2 / 3) * (qy - ey),
            ex, ey
          );
          lastQ = [qx, qy];
          break;
        }
        case "A": {
          const ex = rel ? x + a[5] : a[5];
          const ey = rel ? y + a[6] : a[6];
          for (const c of arcToCubics(x, y, a[0], a[1], a[2], !!a[3], !!a[4], ex, ey)) {
            cubic(c[0], c[1], c[2], c[3], c[4], c[5]);
          }
          lastC = lastQ = null;
          break;
        }
      }
      prev = op;
    }
  }

  return ops.join("\n");
}

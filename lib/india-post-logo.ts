/**
 * India Post's emblem, as PDF path data.
 *
 * Lifted from public/images/India-Post.svg — the same file the site uses —
 * and reduced to the emblem: the envelope block and the three ribbons over
 * it. The wordmark that sits above and below it in the original is dropped,
 * for two reasons. It is four fifths of the file's path data, and at the size
 * a 4x6 label can give a logo it would be a grey smudge — while the words it
 * spells are already printed beside it, in a typeface chosen to be read.
 *
 * Coordinates are the SVG's own, y running down from the top-left. Nothing
 * here flips them; PdfDocument.drawForm does that once in its matrix.
 *
 * Regenerating: take the `d` attribute of each of the first four <path>
 * elements. Their classes carry the fill — cls-1 is the black block, cls-2
 * the grey ribbons — and both are fill-rule:evenodd, which is why the
 * painting operator below is `f*` and not `f`.
 */

/** The emblem's own coordinate space, from the source file's viewBox. */
export const INDIA_POST_VIEWBOX = { width: 560.93, height: 300 };

/** Fill grey per class: cls-1 is black, cls-2 is #999. */
const PATHS: { gray: number; d: string }[] = [
  { gray: 0, d: "M83.4,67.83H426.14V261.51H83.4Z" },
  { gray: 0.6, d: "M424.4,90.82a82.26,82.26,0,0,1-10,7.2c-14.29,9.24-35,25.49-49.61,35.83-13.54,9.7-25.88,19.1-39.62,28.56-32.08,22.09-77,54.38-118.47,51.93a59.91,59.91,0,0,1-26-8.1c-16.58-9.34-20.73-22.19-33.67-34.48a145.54,145.54,0,0,0-40.57-27.59c-5-2.5-23.34-9.2-24-10-9-2-33.52-10.8-41.77-9.35A279.37,279.37,0,0,0,10,132.57L0,135.92c.85,1.2-.5,1,5,.9a160,160,0,0,1,27.63,2.5c2.19.3,3.54.3,5.54.65,12.74,2.3,17.14,3.2,30,6.39a110.78,110.78,0,0,1,14.39,4.1c10.89,1.4,36.27,15.5,45.62,22.2a161.88,161.88,0,0,1,13.69,11.54c1.5,1.81,2.89,2.7,4.39,4.45A221.77,221.77,0,0,0,162,207c29.23,26.84,64.95,23.64,102.38,5.45,26.53-12.95,58.66-36.24,82-53.88,18.83-14.3,39.27-30,58.3-43.93,3-2.25,18-13.4,20-14.2l39.22-26.64c3.14-2.35,8.64-5.3,12.44-7.5l17-9.49c1.6-.9,2.84-1.4,4.33-2.3l13.19-6.7,2.1-1,39-17.64,4.7-1.95c2.25-.95,3.55-1.3,4.29-2.35a87.82,87.82,0,0,0-14.48,4.1c-10,3.2-30.48,11.4-41,16.14l-37.72,19.1L424.49,90.84Z" },
  { gray: 0.6, d: "M417.35,75.33l-39.22,27.58c-24.68,18.15-52.41,38.19-77.85,55.33-24.18,16.3-64.95,41.59-96.28,34.49-20.93-5-26.73-20.6-36.22-30a170.92,170.92,0,0,0-58.5-41.13c-13.64-6.45-12.65-5-26.94-3.75l-21.23,2.8c1.08,1.44,0,.65,5,1.55l5.54,1.08c2,.4,3.75.85,5.4,1.25a37.72,37.72,0,0,1,5,1.4c12,2,37.22,14.1,47.92,20.29,43.62,25.44,39.57,53.58,79.34,57.88,31.68,3.4,72.65-23,96.23-40,13.34-9.65,26.83-19.25,39.62-28.94s26-20,39.17-29.49c3.8-2.8,36.28-27.24,40-28.79l41-26.69,54.15-28.64c1.35-.6,2.35-.7,3.1-1.75a265.51,265.51,0,0,0-28.73,11.5c-12.69,6.44-19.63,9.19-33,17.09-2.3,1.35-4.34,2.35-6.45,3.75l-3,1.85L448,55.91l-3,1.89-15.43,10c-4.2,2.5-8.94,6.14-12.39,8Z" },
  { gray: 0.6, d: "M386.32,75.33l-78.44,56.42c-22.94,15.35-63.91,44.44-92.24,42.59-20.48-1.3-51.16-50-75.44-59.38-3.55-1.35-21.88,0-26.78.3,1.6,1,7.89,2.8,10,3.85a145.41,145.41,0,0,1,27.18,15.8,151.3,151.3,0,0,1,29.68,27.44c7.84,10,17.19,21,36.17,21,16,0,32.88-7.35,44.12-13.55A344.22,344.22,0,0,0,295.79,148c11.29-8.1,22.13-15.64,33.17-23.94s21.53-16.19,32.52-24.58C365,96.78,391,76.74,394.36,75L402.8,69c.8-.65,1.15-.85,2.05-1.5L460.26,29.1c.95-.65,1.55-1,1.95-2-3.5,1.8-6.55,3.44-10,5.49L432.78,44.35c-1.55,1-3,1.7-4.7,2.85L409.44,59.49c-1.69,1.15-3.09,1.95-5,3.2-5,3.69-13.79,9.09-18.39,12.65Z" },
];
import { svgPathToPdf } from "@/lib/svg-path";

/** The name the emblem is registered and stamped under. */
export const INDIA_POST_FORM = "indiapost";

/**
 * The emblem as one PDF content stream.
 *
 * Built on first use and kept, because a run of three hundred labels asks for
 * it three hundred times and the answer never changes. `defineForm` then
 * writes it to the file once however many pages stamp it.
 *
 * `f*` is the even-odd fill rule, which both classes in the source file
 * declare. It matters: the ribbons cross the envelope block and each other,
 * and filling non-zero would flood the overlaps solid.
 */
let cached: string | null = null;

export function indiaPostEmblem(): string {
  if (cached !== null) return cached;
  cached = PATHS.map((p) => `q ${p.gray} g\n${svgPathToPdf(p.d)}\nf* Q`).join("\n");
  return cached;
}

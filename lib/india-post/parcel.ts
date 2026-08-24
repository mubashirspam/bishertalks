import { parcelSize, type ParcelSize } from "@/lib/courier-sheet";

/**
 * What India Post calls the thing we are posting.
 *
 * Their rule is by weight alone: under 500 g is a document, 500 g and over is
 * a parcel. Their dimension bands do not agree with that for what we sell, and
 * the disagreement is exactly half a centimetre wide:
 *
 *                        weight        length      width      height
 *   SP_INLAND_DOC        1–500 g       1–42 cm     1–29 cm    1–2 cm
 *   SP_INLAND_PARCEL     1 g–35 kg     14–150 cm   9–150 cm   1–150 cm
 *
 * One book is 380 g and 25 × 15 × 2.5 cm. By weight it is a document; by
 * height it cannot be one. Two books or more is 760 g and comfortably a
 * parcel, so the conflict only ever affects a single-book order — which is
 * most of them.
 *
 * `articleTypeFor` returns what their rule says, because that is what their
 * tariff API will decide on its own regardless of what we send. `fitsBand`
 * reports whether the physical parcel actually satisfies that type, so a
 * booking can refuse locally with a sentence a person can act on rather than
 * being rejected by their validator with a field name.
 *
 * When the question is settled — see §2.1 of docs/india-post-integration-plan.md
 * — the fix is one of: pack to 2 cm and single books become honest documents;
 * or override to SP_INLAND_PARCEL here with their written agreement.
 */

export type ArticleType = "SP_INLAND_DOC" | "SP_INLAND_PARCEL";

/** Their threshold, in grams. Below is a document, at or above is a parcel. */
const DOCUMENT_MAX_GRAMS = 500;

interface Band {
  weight: [number, number];
  length: [number, number];
  breadth: [number, number];
  height: [number, number];
}

const BANDS: Record<ArticleType, Band> = {
  SP_INLAND_DOC: {
    weight: [1, 500],
    length: [1, 42],
    breadth: [1, 29],
    height: [1, 2],
  },
  SP_INLAND_PARCEL: {
    weight: [1, 35_000],
    length: [14, 150],
    breadth: [9, 150],
    height: [1, 150],
  },
};

/** What their rule makes this parcel, by weight. */
export function articleTypeFor(weightGrams: number): ArticleType {
  return weightGrams < DOCUMENT_MAX_GRAMS ? "SP_INLAND_DOC" : "SP_INLAND_PARCEL";
}

/**
 * Does the physical parcel satisfy the band for that type?
 *
 * Returns the failures in words. An empty array means it fits.
 */
export function bandFailures(type: ArticleType, size: ParcelSize): string[] {
  const band = BANDS[type];
  const out: string[] = [];

  const check = (
    label: string,
    value: number,
    [min, max]: [number, number],
    unit: string
  ) => {
    if (value < min) out.push(`${label} ${value}${unit} is below their minimum of ${min}${unit}`);
    if (value > max) out.push(`${label} ${value}${unit} is above their maximum of ${max}${unit}`);
  };

  check("weight", size.weightGrams, band.weight, " g");
  check("length", size.lengthCm, band.length, " cm");
  check("width", size.breadthCm, band.breadth, " cm");
  check("height", size.heightCm, band.height, " cm");

  return out;
}

/**
 * Everything a booking or a quote needs to know about the box.
 *
 * `shape` is their vocabulary: DOC for a document, NROL for a rectangular
 * parcel, ROL for a cylindrical one. A book is never cylindrical.
 */
export function postalParcel(
  quantity: number,
  isGift = false
): ParcelSize & {
  articleType: ArticleType;
  shape: "DOC" | "NROL" | "ROL";
  /** Empty when the parcel fits the band their weight rule assigns it. */
  problems: string[];
} {
  const size = parcelSize(quantity, isGift);
  const articleType = articleTypeFor(size.weightGrams);

  return {
    ...size,
    articleType,
    shape: articleType === "SP_INLAND_DOC" ? "DOC" : "NROL",
    problems: bandFailures(articleType, size),
  };
}

/**
 * One delivery address, composed once.
 *
 * Before this file, every consumer joined the address columns itself: the
 * shipping label did `[address_line1, address_line2].filter(Boolean)`, the
 * address sheet did the same with a different separator, the India Post sheet
 * had `receiverStreet`, and the Delhivery payload had a third spelling. Four
 * copies of one decision. Adding `house_name` (0064) to four places
 * independently is how three of them get it and the fourth quietly posts a
 * parcel without the one field this shop added to stop parcels coming back.
 *
 * So: the columns are read here and nowhere else, and every output asks this
 * module for the shape it needs.
 *
 * ── The order, and why ──────────────────────────────────────────────────
 *
 *   door no → house name → street/area → landmark
 *
 * Narrowest first, which is how an address is read aloud and how a postman
 * narrows down a delivery: the flat inside the building, the building on the
 * street, the street in the locality, and finally the thing you look for if
 * you still cannot find it. City, district, state and pincode are NOT here —
 * every output has its own columns for them, and repeating them in the street
 * spends India Post's fifty characters twice.
 */

export const ADDRESS_TYPES = ["home", "office"] as const;
export type AddressType = (typeof ADDRESS_TYPES)[number];

export const ADDRESS_TYPE_LABELS: Record<AddressType, string> = {
  home: "Home",
  office: "Office",
};

export function isAddressType(v: unknown): v is AddressType {
  return typeof v === "string" && (ADDRESS_TYPES as readonly string[]).includes(v);
}

/** What the database gave us, made safe. Anything unrecognised is a home. */
export function addressType(v: unknown): AddressType {
  return isAddressType(v) ? v : "home";
}

/**
 * The columns this module reads.
 *
 * Every field is optional because every consumer selects a different subset,
 * and a row read by a query written before 0064 simply has no `house_name` —
 * which must render as the address did before, not as "undefined".
 */
export interface AddressFields {
  house_name?: string | null;
  door_no?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  district?: string | null;
  state?: string | null;
  pincode?: string | null;
}

const clean = (v: unknown): string =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";

/**
 * The street part, narrowest first, with nothing repeated.
 *
 * Duplicates are dropped case-insensitively: people type "Nallalam" into both
 * the locality and the landmark, and printing it twice wastes a line that a
 * fifty-character limit cannot spare. The FIRST occurrence wins, so the more
 * specific field keeps it.
 */
export function streetParts(o: AddressFields): string[] {
  const parts: string[] = [];
  for (const raw of [o.door_no, o.house_name, o.address_line1, o.address_line2]) {
    const part = clean(raw);
    if (!part) continue;
    if (parts.some((seen) => seen.toLowerCase() === part.toLowerCase())) continue;
    parts.push(part);
  }
  return parts;
}

/**
 * The street on one line — the shape sheets and courier payloads want.
 *
 * An address with no house name comes back exactly as it did before 0064,
 * which is what keeps 5,598 existing parcels printing unchanged.
 */
export function street(o: AddressFields): string {
  return streetParts(o).join(", ");
}

/**
 * The whole address, for a label or a screen: street, then the columns every
 * output stores separately.
 *
 * `district` is skipped when it merely repeats the town, which across most of
 * Kerala it does — "Kozhikode, Kozhikode" on a label reads as a mistake and
 * costs a line.
 */
export function fullAddressLines(o: AddressFields): string[] {
  const lines = [...streetParts(o)];

  const city = clean(o.city);
  const district = clean(o.district);

  // The town is often already in the street, because the post office people
  // write ("P.O. Parappil") is the same place the pincode resolves to. Printing
  // "P.O. Parappil, Parappil" reads as a data-entry slip and costs a line.
  const inStreet = (v: string) =>
    !!v && lines.some((l) => l.toLowerCase().includes(v.toLowerCase()));

  const town = [
    inStreet(city) ? "" : city,
    district.toLowerCase() === city.toLowerCase() || inStreet(district) ? "" : district,
  ]
    .filter(Boolean)
    .join(", ");
  if (town) lines.push(town);

  const tail = [clean(o.state), clean(o.pincode)].filter(Boolean).join(" — ");
  if (tail) lines.push(tail);

  return lines;
}

/** The whole address as one string, for a CSV cell or a WhatsApp message. */
export function fullAddress(o: AddressFields): string {
  return fullAddressLines(o).join(", ");
}

/**
 * Is this address good enough to post?
 *
 * Deliberately not "are all the new fields filled in". 5,598 addresses
 * collected before 0064 have no house name and most of them delivered fine;
 * calling them incomplete would flag the entire back catalogue as broken.
 * This asks the older question — is there a street and a pincode — and the
 * FORMS ask for the house name, because a form can ask the person who knows.
 */
export function isPostable(o: AddressFields): boolean {
  return !!clean(o.address_line1) && /^\d{6}$/.test(clean(o.pincode));
}

/**
 * Split a pasted address into the fields.
 *
 * People paste a whole address out of WhatsApp into the first box. This takes
 * that blob and distributes it, so the operator corrects a nearly-right form
 * instead of cutting and pasting five times.
 *
 * Deliberately conservative. It only claims a field when the evidence is
 * unambiguous — a six-digit number is a pincode, a line containing "house",
 * "villa", "bhavan" or "mansion" is a house name — and everything it cannot
 * place lands in `address_line1` where a human will see it. A splitter that
 * guessed would put a street in the house box and be worse than no splitter,
 * because the operator would trust it.
 *
 * Returns only the fields it is confident about; the caller merges.
 */
export function splitPastedAddress(raw: string): Partial<AddressFields> & {
  /** What could not be placed. Never silently dropped. */
  rest: string;
} {
  const out: Partial<AddressFields> & { rest: string } = { rest: "" };

  // ── The pincode, from the whole blob rather than chunk by chunk ───────
  //
  // An Indian address ends with it, and it arrives written every way there is:
  // "673027", "Kozhikode - 673027", "PIN: 673027", "Kerala 673027". Looking
  // for it inside one comma-separated chunk missed every form but the bare
  // one, which is the least common.
  //
  // The LAST standalone six-digit run wins. Last because the pincode is at the
  // end; standalone (no digit either side) so a phone number cannot donate six
  // of its ten digits.
  let body = raw;
  const pins = [...raw.matchAll(/(?<!\d)(\d{6})(?!\d)/g)];
  const pin = pins[pins.length - 1];
  if (pin) {
    out.pincode = pin[1];
    // Cut it out by position, so an identical number elsewhere is untouched.
    body = raw.slice(0, pin.index) + " " + raw.slice(pin.index! + pin[1].length);
  }

  // Lines, then commas — people paste both shapes and a comma inside one line
  // is the same separator as a newline for this purpose.
  const chunks = body
    .split(/[\n,]+/)
    .map((c) => clean(c))
    // A chunk left as punctuation once the pincode was cut out of it.
    .filter((c) => c && /[a-z\d]/i.test(c))
    .map((c) => c.replace(/^[\s\-–—]+|[\s\-–—]+$/g, ""))
    .filter(Boolean);

  const kept: string[] = [];

  for (const chunk of chunks) {
    // A named building. These words are how Kerala addresses name a house, and
    // a line containing one is that line's whole purpose.
    if (
      !out.house_name &&
      /\b(house|villa|bhavan|bhavanam|mansion|nivas|nilayam|cottage|building|apartments?)\b/i.test(chunk)
    ) {
      out.house_name = chunk;
      continue;
    }

    // "2B", "Flat 3", "No. 12/A" — short, and mostly a number.
    if (!out.door_no && /^(?:flat|door|no\.?|#)?\s*[\d]+\s*[a-z]?(?:\/\s*[\da-z]+)?$/i.test(chunk)) {
      out.door_no = chunk;
      continue;
    }

    kept.push(chunk);
  }

  out.rest = kept.join(", ");
  return out;
}

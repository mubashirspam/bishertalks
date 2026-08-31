import type { XLSXSheet } from "@/lib/export";
import {
  parcelSize,
  phoneDigits,
  courierAddress,
  type CourierParcel,
} from "@/lib/courier-sheet";

/**
 * India Post's bulk domestic booking workbook.
 *
 * The counterpart to lib/courier-sheet.ts, which does the same job for
 * Delhivery. Both exist for the same reason — a batch of parcels handed over
 * as one file instead of typed into a web form one address at a time — and
 * both copy a layout the carrier has already accepted rather than inventing
 * one. This one is column-for-column from `bulkdomesticone_28042026.xlsx`,
 * the template downloaded from the Customer Selfservice Portal.
 *
 * ── Why this is not the API ───────────────────────────────────────────────
 *
 * `lib/india-post/booking.ts` does not exist, and until their UAT estate comes
 * back up it cannot be written and verified. This is the manual channel that
 * works today: the agent downloads this workbook, uploads it in the portal's
 * bulk booking screen, and India Post accepts the batch. When the API is
 * eventually written it books the identical parcels from the identical
 * numbers, so nothing here becomes wrong — it becomes optional.
 *
 * ── The rules from their own Information tab ──────────────────────────────
 *
 *   * Do not change the field names or their positions in the first row.
 *     Hence FIELD-for-FIELD constants below, trailing space in "LENGTH "
 *     included — it is in their header and a renamed column is a refused file.
 *   * Absolute values only. Weight, dimensions and amounts may not carry
 *     decimals, which is why a 2.0 cm parcel is written 2 and never 2.0.
 *   * If PICKUP ADDRESS FLAG is false, DROP OFF PINCODE is mandatory. We do
 *     not book pickups — the parcels are carried to the counter — so that flag
 *     is always 0 and AI always carries the booking office's pincode.
 *   * If ALT ADDRESS FLAG is false the AltAddress tab stays empty, but it
 *     still has to be in the workbook. Same for PickupAddress.
 */

// ── The workbook's four tabs ────────────────────────────────────────────────

/**
 * ArticleDetails, the tab the parcels go on.
 *
 * Copied verbatim, including `"LENGTH "`. Do not tidy it: their importer
 * matches on the string.
 */
export const ARTICLE_HEADERS = [
  "SERIAL NUMBER",          // A
  "BARCODE NO",             // B — the article number, from our allotted stock
  "PHYSICAL WEIGHT",        // C — grams, whole numbers only
  "SHAPE OF ARTICLE",       // D — ROLL | NROL | DOC
  "LENGTH ",                // E — their trailing space, not ours
  "BREADTH/DIAMETER",       // F
  "HEIGHT",                 // G
  "PRIORITY FLAG",          // H
  "DELIVERY INSTRUCTION",   // I — ND | (open delivery codes)
  "INSTRUCTION RTS",        // J
  "SENDER NAME",            // K
  "SENDER COMPANY",         // L
  "SENDER ADD LINE 1",      // M
  "SENDER ADD LINE 2",      // N
  "SENDER CITY",            // O
  "SENDER STATE",           // P
  "SENDER PINCODE",         // Q
  "SENDER EMAILID",         // R
  "SENDER ALT CONTACT",     // S
  "SENDER KYC",             // T
  "SENDER TAX REFERENCE",   // U
  "RECEIVER NAME",          // V
  "RECEIVER COMPANY",       // W
  "RECEIVER ADD LINE 1",    // X
  "RECEIVER ADD LINE 2",    // Y
  "RECEIVER CITY",          // Z
  "RECEIVER STATE",         // AA
  "RECEIVER PINCODE",       // AB
  "RECEIVER EMAILID",       // AC
  "RECEIVER ALT CONTACT",   // AD
  "RECEIVER KYC",           // AE
  "RECEIVER TAX REFERENCE", // AF
  "ALT ADDRESS FLAG",       // AG
  "PICKUP ADDRESS FLAG",    // AH
  "DROP OFF PINCODE",       // AI
  "DROPOFF/PICKUP OFFICE ID", // AJ
  "SENDER MOBILE NO",       // AK
  "RECEIVER MOBILE NO",     // AL
  "PREPAYMENT CODE",        // AM
  "VALUE OF PREPAYMENT",    // AN
  "CODR/COD",               // AO
  "VALUE FOR CODR/COD",     // AP
  "INSURANCE TYPE",         // AQ
  "VALUE OF INSURANCE",     // AR
  "ACK",                    // AS
  "REGISTRATION",           // AT
  "OTP BASED DELIVERY",     // AU
  "BULK REFERENCE",         // AV
] as const;

/** PickupAddress — empty for us, and required to be present anyway. */
export const PICKUP_HEADERS = [
  "serial_no",
  "addressee_name",
  "company_name",
  "address_line1",
  "address_line2",
  "address_line3",
  "city",
  "state",
  "pincode",
  "email_id",
  "alt_contact_no",
  "mobile_no",
  "pickup_schedule_slot",
  "pickup_schedule_date",
] as const;

/** AltAddress — empty for us, for the same reason. */
export const ALT_ADDRESS_HEADERS = [
  "SERIAL NO",
  "ADDRESSEE NAME",
  "COMPANY NAME",
  "ADDRESS LINE 1",
  "ADDRESS LINE 2",
  "ADDRESS LINE 3",
  "CITY",
  "STATE",
  "PINCODE",
  "EMAIL ID",
  "ALT CONTACT NO",
  "MOBILE NO",
] as const;

/**
 * The Information tab, reproduced cell for cell.
 *
 * Their template ships it as a reference card for whoever fills the sheet in
 * by hand. Ours is filled in by code, so it is here for one reason: the
 * workbook an agent downloads should be the workbook India Post published, so
 * that comparing the two is possible when a file is refused and nobody can
 * see why.
 *
 * Fourteen columns, with real gaps in them — the code/description pairs sit at
 * 0-1, 3-4, 6-7, 8-9 and 11-12, and the loose columns between them are the
 * single-value ones (PRIORITY FLAG at 2, INSURANCE TYPE at 10, PICKUP
 * SCHEDULE SLOT at 13). The gaps are load-bearing: the headings above are
 * merged across their pairs, so a version of this with the blanks squeezed out
 * puts every heading over the wrong column.
 *
 * This is also the tab that documents the codes the ArticleDetails rows must
 * use, and the reason POSTAL_SHEET_DEFAULTS below reads the way it does:
 * the flag columns are TRUE/FALSE and not 1/0, RTS/RTA rather than words, and
 * the only PREPAYMENT codes that exist are stamps and franking.
 */
export const INFORMATION_ROWS: unknown[][] = [
  // Code / Description headers under each merged group
  ["Code", "Description", "TRUE", "Code", "Description", "", "Code", "Description", "Code", "Description", "DOP", "Code", "Description", "10:00-13:00"],
  ["ROLL", "Roll form", "FALSE", "ND", "Normal Delivery", "", "RTS", "Returned to Sender", "codr", "Cash On Delivery Retail(VP)", "", "PS", "Postage Stamps", "13:00-16:00"],
  ["NROL", "Non Roll Form", "", "OD", "Open Delivery", "", "RTA", "Returned to Alternate Address", "cod", "Cash on Delivery", "", "FM", "Franking Machine"],
  ["DOC", "Document", "", "", "", "", "", "", "", "", "", "SS", "Service Stamps"],
  [],
  ["", "BOOLEAN(TRUE or FALSE)"],
  ["", "PRIORITY FLAG"],
  ["", "ALT ADDRESS FLAG"],
  ["", "PICKUP ADDRESS FLAG"],
  ["", "ACK"],
  ["", "OTP BASED DELIVERY"],
  ["", "REGISTRATION"],
  ["INSTRUCTIONS"],
  [1, "If ALT ADDRESS FLAG is True, provide the address details in the AltAddress tab"],
  [2, "If PICK UP ADDRESS FLAG is True, provide the pickup details in the PickupAddress tab"],
  [3, "IF PICK UP ADDRESS FLAG is False,DropOff Pincode is mandatory in ArticleDetails tab"],
  [3, "Do not change the field names or their positions in the first row"],
  [4, "Please provide absolute values for physical weight, insurance amount, cod amount etc. Decimal values are not permitted"],
  [5, "Date format should be in DD-MM-YYYY and format in date"],
  [6, "Please use the specified codes as mentioned"],
];

/**
 * The Information tab's own first row: eight headings over fourteen columns,
 * merged across their code/description pairs in the original.
 */
export const INFORMATION_HEADERS = [
  "SHAPE OF ARTICLE", "", "PRIORITY FLAG", "DELIVERY INSTRUCTION", "", "",
  "INSTRUCTION RTS", "", "CODR/COD", "", "INSURANCE TYPE", "PREPAYMENT", "",
  "PICKUP SCHEDULE SLOT",
];

/** The tab names, spelled as their importer expects to find them. */
export const SHEET_NAMES = {
  articles: "ArticleDetails",
  pickup: "PickupAddress",
  alt: "AltAddress",
  information: "Information",
} as const;

// ── The parts that are the same on every row ────────────────────────────────

/**
 * Who is posting, in the shape their sheet asks for.
 *
 * Structured rather than the one address string `senderFromEnv()` returns,
 * because this sheet wants city, state and pincode in their own columns and
 * their validator checks the pincode. Read from the environment so a moved
 * office is a Vercel setting rather than a deploy.
 */
export interface PostalSender {
  name: string;
  company: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  pincode: string;
  email: string;
  mobile: string;
}

/**
 * The booking office this batch is carried to.
 *
 * `officeId` is the eight-digit id their PIN Code Search returns and their
 * bulk upload asks for in AJ. It is blank until somebody looks it up — the
 * lookup endpoint is behind the same portal that is currently down — and a
 * blank AJ is what the template's own sample row carries, so the file is
 * still uploadable without it.
 */
export interface BookingOffice {
  pincode: string;
  officeId: string;
}

export function postalSenderFromEnv(): PostalSender {
  return {
    // A person, not the account. India Post's export of this account's own
    // bookings carries a staff member's name in `sender-name` on all 855 of
    // them, which is who the counter and any return will be dealing with.
    name: process.env.INDIA_POST_SENDER_NAME || "AJMEL AHMED",
    company: process.env.INDIA_POST_SENDER_COMPANY || "ELAVATE BOOKS",
    // Chevayoor, 673017 — deliberately NOT the 673001 of the booking office
    // below. The place a parcel comes from and the counter it is handed in at
    // are different, and their sheet asks for both.
    line1: process.env.INDIA_POST_SENDER_ADDRESS_1 || "2ND FLOOR KKK MIDTOWN",
    // Required, not optional — their validator refuses a file whose
    // SenderAddrline2 is empty, even though the receiver's second line may be.
    // CHEVAYOOR is the locality of 673017 and appears in this account's own
    // bookings ("ELAVATE BOOKS CHEVAYOOR KOZHIKODE - 673017"), so it is real
    // address and not filler put there to satisfy a check.
    line2: process.env.INDIA_POST_SENDER_ADDRESS_2 || "CHEVAYOOR",
    city: process.env.INDIA_POST_SENDER_CITY || "KOZHIKODE",
    state: process.env.INDIA_POST_SENDER_STATE || "Kerala",
    pincode: process.env.INDIA_POST_SENDER_PINCODE || "673017",
    email: process.env.INDIA_POST_SENDER_EMAIL || "",
    // Mandatory on their sheet — a blank is reported as
    // "SenderMobileNo is a required field" against every row in the file.
    mobile: phoneDigits(process.env.INDIA_POST_SENDER_PHONE || "9072346233"),
  };
}

export function bookingOfficeFromEnv(): BookingOffice {
  return {
    pincode: (process.env.INDIA_POST_BOOKING_PINCODE || "673001").replace(/\D/g, ""),
    // 22360035 is Calicut HO, where 596 of the 855 articles on this account
    // were booked — read off India Post's own export rather than looked up,
    // which is why this no longer waits on their PIN Code Search endpoint.
    // The other office in use is Chevayur SO, 22660997 at 673017.
    officeId: (process.env.INDIA_POST_BOOKING_OFFICE_ID || "22360035").trim(),
  };
}

/**
 * The choices that are the same for every parcel we post, and why each is
 * what it is.
 *
 * Every one of these is a value their validator will check, so they are named
 * and commented rather than left as literals down in the row builder.
 */
export const POSTAL_SHEET_DEFAULTS = {
  /**
   * The flag columns are TRUE/FALSE, not 1/0.
   *
   * The Information tab lists PRIORITY FLAG, ALT ADDRESS FLAG, PICKUP ADDRESS
   * FLAG, ACK, OTP BASED DELIVERY and REGISTRATION under the heading
   * "BOOLEAN(TRUE or FALSE)", and their sample row stores every one of them as
   * a real Excel boolean — `t="b"` over 1/0, which is what the writer in
   * lib/export.ts now emits for a JS boolean.
   *
   * Neither the digits nor the words will do. Sending the string "FALSE" for
   * PICKUP ADDRESS FLAG had their validator refuse the upload with
   * "Pickupaddress not provided" on every row: any non-empty string in that
   * column reads as truthy, so a batch with no pickup at all was treated as
   * one that had forgotten to describe it.
   */
  priorityFlag: false,
  /** ND normal, OD open delivery — the customer inspects before accepting. */
  deliveryInstruction: "ND",
  /**
   * RTS, back to us. RTA would send an undeliverable article to the address on
   * the AltAddress tab, which we do not fill in.
   */
  instructionRts: "RTS",
  /** Both false, so the AltAddress and PickupAddress tabs stay empty. */
  altAddressFlag: false,
  pickupAddressFlag: false,
  /**
   * Blank, because we do not prepay.
   *
   * The only codes this column takes are PS (postage stamps), FM (franking
   * machine) and SS (service stamps) — the ways a walk-in customer settles
   * postage at the window. Ours is billed to the contract: every one of the
   * 855 articles already booked on this account came back from their own
   * export as payment mode CO, Contract. A code here would claim we had stuck
   * stamps on the parcel.
   */
  prepaymentCode: "",
  /** No acknowledgement card. */
  ack: false,
  /**
   * Registered. Their export confirms it — every article on this account is
   * book type RBC, Registered Bulk Customer.
   */
  registration: true,
  /**
   * Off.
   *
   * OTP delivery means the customer reads a code off a phone at the door. For
   * a book that turns a routine handover into a failed delivery whenever the
   * number on the order is not the number in the customer's hand.
   */
  otpDelivery: false,
} as const;

/**
 * Their field lengths, as their validator enforces them.
 *
 * Fifty characters per address line, refused outright rather than trimmed:
 *
 *   ReceiverAddrline1 must be a maximum of 50 characters in length at row 2
 *
 * That is one row of eight rejecting an entire upload, so the limit is worked
 * to here rather than discovered there.
 */
const ADDRESS_LINE_MAX = 50;
/** Two lines on the ArticleDetails tab, so this much street in total. */
const ADDRESS_LINES = 2;

/**
 * Pack an address into their two fifty-character lines.
 *
 * Word boundaries, because breaking mid-word turns a road name into two
 * fragments that neither a sorter nor a postman can act on. A word longer than
 * the line by itself — a run-together address with no spaces — is hard-split,
 * since the alternative is dropping it entirely.
 *
 * Returns what did not fit as well as what did. The caller refuses the parcel
 * rather than sending a truncated address: 3% of this shop's addresses are
 * over the hundred characters these two lines hold, and every one of them is
 * long because it carries a landmark or a floor that the delivery actually
 * depends on. Silently cutting that off produces a parcel that is accepted,
 * posted, and then undeliverable.
 */
export function splitAddressLines(text: string): { lines: string[]; overflow: string } {
  const words = (text ?? "").trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  const flush = () => {
    if (current) lines.push(current);
    current = "";
  };

  for (let i = 0; i < words.length; i++) {
    let word = words[i];

    // Longer than a whole line on its own. Split it and push the remainder
    // back onto the queue rather than losing the tail.
    if (word.length > ADDRESS_LINE_MAX) {
      flush();
      lines.push(word.slice(0, ADDRESS_LINE_MAX));
      words[i] = word.slice(ADDRESS_LINE_MAX);
      i--;
      if (lines.length >= ADDRESS_LINES) break;
      continue;
    }

    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= ADDRESS_LINE_MAX) {
      current = candidate;
      continue;
    }

    flush();
    if (lines.length >= ADDRESS_LINES) {
      return { lines: lines.slice(0, ADDRESS_LINES), overflow: words.slice(i).join(" ") };
    }
    current = word;
  }

  flush();

  return {
    lines: lines.slice(0, ADDRESS_LINES),
    overflow: lines.length > ADDRESS_LINES ? lines.slice(ADDRESS_LINES).join(" ") : "",
  };
}

/**
 * The street part of a delivery address, without what has its own column.
 *
 * City, state and pincode are separate fields on their sheet, so repeating
 * them here spends the hundred characters twice — and the hundred characters
 * are the scarce thing.
 */
export function receiverStreet(p: PostalParcel): string {
  const parts: string[] = [];
  for (const raw of [p.address_line1, p.address_line2]) {
    const part = raw?.trim();
    if (!part) continue;
    if (parts.some((seen) => seen.toLowerCase() === part.toLowerCase())) continue;
    parts.push(part);
  }
  return parts.join(", ");
}

// ── Rows ────────────────────────────────────────────────────────────────────

/**
 * What their SHAPE OF ARTICLE column calls our parcel.
 *
 * NROL — a non-roll article — for everything we post, and the weight is not
 * consulted.
 *
 * This column is about the physical shape of the thing, not the product it is
 * booked as: ROLL for something rolled up, DOC for a document, NROL for
 * everything else. A book in a flat mailer is NROL at any weight.
 *
 * It used to switch to DOC under 500 g, carried over from Speed Post's
 * SP_INLAND_DOC rule, where weight really does decide the product. That rule
 * does not apply here. India Post's export of this account's own bookings
 * settles it: all 855 articles are `BUSINESS_PARCEL`, booked on contract with
 * CL-series numbers — the same series as the stickers we hold. Declaring a
 * parcel's shape as a document would have described the article wrongly on
 * every single-book order, which is most of them.
 *
 * Kept as a function rather than folded into a constant because the shape is
 * genuinely a property of the parcel, and a future product that posts
 * something rolled or a real document should change this and nothing else.
 */
export function shapeOfArticle(_weightGrams: number): "DOC" | "NROL" | "ROLL" {
  return "NROL";
}

/** A parcel plus the article number that has been allotted to it. */
export interface PostalParcel extends CourierParcel {
  /** From our allotted stock — see lib/db/postal-barcodes.ts. */
  postal_barcode: string;
  buyer_email?: string | null;
}

/**
 * One parcel, one ArticleDetails row, in the header order above.
 *
 * Dimensions are rounded **up** to a whole centimetre, not to the nearest one.
 * Their tab forbids decimals and the parcel is measured again at the counter:
 * rounding 2.5 down to 2 declares a document that is not one, and the article
 * is re-rated at the window with the difference billed back against an invoice
 * nobody can later explain. Up is the only direction that cannot do that.
 */
export function articleRow(
  p: PostalParcel,
  serialNumber: number,
  reference: string,
  sender: PostalSender,
  office: BookingOffice
): unknown[] {
  const d = POSTAL_SHEET_DEFAULTS;
  const books = Math.max(1, p.quantity || 1);
  const size = parcelSize(books, !!p.is_gift);
  const mobile = phoneDigits(p.buyer_phone);
  const pincode = (p.pincode ?? "").replace(/\D/g, "");

  // Their city column is one field and checkout collects town and district
  // separately — which for most of Kerala are the same word. The town if we
  // have it, the district if that is all there is.
  const city = (p.city?.trim() || p.district?.trim() || "").slice(0, 60);

  // Repacked across their two fifty-character lines rather than taken as
  // checkout stored them: 14% of this shop's `address_line1` values are longer
  // than 50 on their own, and their validator refuses the whole file for one.
  const { lines } = splitAddressLines(receiverStreet(p) || courierAddress(p));
  const [line1 = "", line2 = ""] = lines;

  return [
    serialNumber,                                  // A
    p.postal_barcode,                              // B
    Math.round(size.weightGrams),                  // C — grams, whole
    shapeOfArticle(size.weightGrams),              // D
    Math.ceil(size.lengthCm),                      // E
    Math.ceil(size.breadthCm),                     // F
    Math.ceil(size.heightCm),                      // G
    d.priorityFlag,                                // H
    d.deliveryInstruction,                         // I
    d.instructionRts,                              // J
    sender.name,                                   // K
    sender.company,                                // L
    sender.line1.slice(0, ADDRESS_LINE_MAX),       // M
    sender.line2.slice(0, ADDRESS_LINE_MAX),       // N
    sender.city,                                   // O
    sender.state,                                  // P
    sender.pincode ? Number(sender.pincode) : "",  // Q
    sender.email,                                  // R
    "",                                            // S — no alternate contact
    "",                                            // T — KYC, not collected
    "",                                            // U — tax reference, none
    (p.buyer_name ?? "").trim().slice(0, 60),      // V
    "",                                            // W — customers have no company
    line1,                                         // X
    line2,                                         // Y
    city,                                          // Z
    (p.state ?? "").trim(),                        // AA
    pincode ? Number(pincode) : "",                // AB
    (p.buyer_email ?? "").trim(),                  // AC
    "",                                            // AD
    "",                                            // AE
    "",                                            // AF
    d.altAddressFlag,                              // AG
    d.pickupAddressFlag,                           // AH
    office.pincode ? Number(office.pincode) : "",  // AI — mandatory, see above
    office.officeId,                               // AJ
    sender.mobile ? Number(sender.mobile) : "",    // AK
    mobile ? Number(mobile) : "",                  // AL
    d.prepaymentCode,                              // AM
    "",                                            // AN
    "",                                            // AO — prepaid, never COD
    "",                                            // AP
    "",                                            // AQ — no insurance
    "",                                            // AR
    d.ack,                                         // AS
    d.registration,                                // AT
    d.otpDelivery,                                 // AU
    reference,                                     // AV — ties their batch to ours
  ];
}

/**
 * Everything that would stop India Post accepting this row, in words a person
 * can act on.
 *
 * Checked here rather than left to their uploader because their refusal names
 * a column and a row number in a file of a hundred, and the parcel it belongs
 * to has already been packed by then.
 */
export function articleProblems(
  p: PostalParcel,
  sender: PostalSender = postalSenderFromEnv()
): string[] {
  const problems: string[] = [];
  const size = parcelSize(Math.max(1, p.quantity || 1), !!p.is_gift);

  if (!p.postal_barcode) problems.push("no article number");
  if (!(p.buyer_name ?? "").trim()) problems.push("no name");
  if (!/^\d{6}$/.test((p.pincode ?? "").replace(/\D/g, ""))) problems.push("pincode is not six digits");
  if (phoneDigits(p.buyer_phone).length !== 10) problems.push("mobile is not ten digits");

  const street = receiverStreet(p);
  if (!street) problems.push("no address");
  else if (splitAddressLines(street).overflow) {
    // Their two lines hold a hundred characters between them and there is no
    // third. Named rather than trimmed — the tail of a long address is the
    // landmark or the floor the delivery depends on.
    problems.push(
      `address is ${street.length} characters, and only 100 fit — shorten it`
    );
  }

  if (!(p.state ?? "").trim()) problems.push("no state");
  if (size.weightGrams < 1) problems.push("no weight");

  // Mandatory, and settings for the whole file rather than properties of the
  // parcel — so they report against every row, which is what makes it obvious
  // that the fix is one setting and not eight addresses.
  //
  // Each of these has already refused a real upload. Their validator takes one
  // pass per file and answers with the first thing it objects to, so checking
  // them here turns what would be a round trip per missing field into one
  // message before anything is downloaded.
  if (sender.mobile.length !== 10) {
    problems.push("no sender mobile — set INDIA_POST_SENDER_PHONE");
  }
  if (!sender.name.trim()) problems.push("no sender name — set INDIA_POST_SENDER_NAME");
  if (!sender.line1.trim()) {
    problems.push("no sender address line 1 — set INDIA_POST_SENDER_ADDRESS_1");
  }
  // Required by them, unlike the receiver's second line.
  if (!sender.line2.trim()) {
    problems.push("no sender address line 2 — set INDIA_POST_SENDER_ADDRESS_2");
  }
  if (!sender.city.trim()) problems.push("no sender city — set INDIA_POST_SENDER_CITY");
  if (!sender.state.trim()) problems.push("no sender state — set INDIA_POST_SENDER_STATE");
  if (!/^\d{6}$/.test(sender.pincode)) {
    problems.push("sender pincode is not six digits — set INDIA_POST_SENDER_PINCODE");
  }

  return problems;
}

/**
 * The whole workbook, four tabs, ready to upload.
 *
 * `references` comes in alongside the parcels rather than being derived here
 * because the route has already reserved them against the database — the file
 * and the orders table must agree on what each parcel is called, and deriving
 * the number twice is how they come to disagree.
 */
export function buildPostalWorkbook(
  parcels: PostalParcel[],
  references: Map<string, string>,
  sender: PostalSender = postalSenderFromEnv(),
  office: BookingOffice = bookingOfficeFromEnv()
): XLSXSheet[] {
  const rows = parcels.map((p, i) =>
    articleRow(p, i + 1, references.get(p.order_number) ?? p.order_number, sender, office)
  );

  return [
    { name: SHEET_NAMES.articles, headers: [...ARTICLE_HEADERS], rows },
    // Empty, and required to exist — see the note at the top of this file.
    { name: SHEET_NAMES.pickup, headers: [...PICKUP_HEADERS], rows: [] },
    { name: SHEET_NAMES.alt, headers: [...ALT_ADDRESS_HEADERS], rows: [] },
    { name: SHEET_NAMES.information, headers: INFORMATION_HEADERS, rows: INFORMATION_ROWS },
  ];
}

/**
 * The courier's bulk-upload sheet.
 *
 * Delhivery takes a batch of parcels as one .xlsx with a fixed column layout —
 * the same file an agent would otherwise produce by typing a hundred addresses
 * into the courier's web form, one at a time. The layout here is copied from a
 * sheet the courier has already accepted (DLVAU12.xlsx), column for column.
 *
 * Two rules from that file are worth stating, because both look like mistakes:
 *
 *   * City, State and Country are left empty and the whole address goes into
 *     the Address column, ending with the mobile number. That is what the
 *     accepted sheet does, and the courier's own parser reads it back out.
 *   * Every column is present even when nothing fills it. A sheet missing a
 *     column is rejected on upload, not silently accepted with a gap.
 */

/**
 * How many parcels go on one sheet.
 *
 * A hundred, which is a full page of the portal: "tick everything on screen,
 * download it" is the whole workflow, and a cap below the page size turned
 * that into two rounds for no reason. The courier's own limit is higher still.
 *
 * The size costs nothing on our side — the batch is confirmed in one statement
 * however long it is (mark_courier_entered, migration 0024), so this is one
 * round trip whether it carries fifty rows or a hundred.
 *
 * Lives here rather than in the db module so the button can show the number
 * without dragging the service-role client into the browser bundle.
 */
export const COURIER_SHEET_MAX = 100;

/** The header row, in the courier's order. Do not reorder or drop any. */
export const COURIER_SHEET_HEADERS = [
  "Waybill",              // A — always blank; the courier assigns it
  "Reference No",         // B — ours, see courierReference()
  "Consignee Name",
  "City",                 // D, E, F — deliberately blank, see above
  "State",
  "Country",
  "Address",
  "Pincode",
  "Phone",                // I — blank; the mobile is the number we have
  "Mobile",
  "Weight",
  "Shipment Length",
  "Shipment Breadth",
  "Shipment Height",
  "Packaging Type",
  "Payment Mode",
  "Package Amount",
  "Cod Amount",
  "Product to be Shipped",
  "Vendor Pickup Location",
  "Return Address",
  "Return Pin",
  "Shipping Mode",
  "fragile_shipment",
  "alternate_phone",      // Y onwards — blank in every accepted sheet so far
  "shipment_type",
  "master_id",
  "mps_children",
  "mps_amount",
  "Seller Name",
  "Seller Address",
] as const;

/**
 * The parts of the sheet that are the same for every parcel we send.
 *
 * Here rather than inline in the row builder so that when the pickup franchise
 * or the return address changes, it changes in one obvious place — getting one
 * of these wrong sends a week of returns to a building we left.
 */
export const COURIER_DEFAULTS = {
  /** Grams for one book. A parcel of three weighs three of these. */
  weightPerBookGrams: 250,
  lengthCm: 10,
  breadthCm: 10,
  heightCm: 10,
  packagingType: "flyer",
  /** Every order in the portal is paid before it gets here, so never COD. */
  paymentMode: "prepaid",
  product: "BOOK",
  pickupLocation: "KKR LOGISTICS FRANCHISE",
  returnAddress:
    "GROUND FLOOR, 63/2069/C2, HI DAWN TOWER, KUNIYIL KAVU ROAD, KOZHIKODE",
  returnPin: 673001,
  shippingMode: "surface",
  fragile: "true",
  sellerName: "BISHER",
  sellerAddress: "KOZHIKODE-6282680794",
} as const;

/** Delhivery truncates a long address field; do it here so we choose where. */
const ADDRESS_MAX = 400;

export interface CourierParcel {
  order_number: string;
  buyer_name: string | null;
  buyer_phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  district: string | null;
  state: string | null;
  pincode: string | null;
  amount_paise: number;
  quantity: number;
  /** Set once a parcel has been on a sheet before — reused, never regenerated. */
  courier_reference: string | null;
}

/** Just the digits, and without the country code a phone box may have kept. */
export function phoneDigits(phone: string | null | undefined): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits;
}

/**
 * The reference number the courier files this parcel under.
 *
 * BISH plus the last five digits of the customer's mobile: short enough to
 * read down a column, and it points at the customer when the courier calls
 * about a parcel. Five digits collide about once in a hundred thousand
 * parcels, which is rare enough to be worth the brevity and common enough that
 * it has to be handled — so a taken reference falls through to six digits,
 * then to the whole number, and finally to something that cannot collide at
 * all. The courier rejects a whole file for one repeated reference.
 *
 * `taken` is both the references already stored against other orders and the
 * ones handed out earlier in this same batch; the caller adds each result back
 * into it.
 */
export function courierReference(parcel: CourierParcel, taken: Set<string>): string {
  const candidates = referenceCandidates(parcel);

  // A parcel that has been on a sheet before keeps the number the courier
  // already has — that is the only candidate it has, taken or not.
  if (parcel.courier_reference) return parcel.courier_reference;

  for (const ref of candidates) if (!taken.has(ref)) return ref;

  // Every shape of the phone number is spoken for. The order number is unique,
  // so this always terminates — and it stays readable enough to trace back.
  return `BISH${phoneDigits(parcel.buyer_phone)}-${orderTail(parcel)}`;
}

/** The tail of the order number, for the references built out of it. */
const orderTail = (parcel: CourierParcel) =>
  parcel.order_number.replace(/\W/g, "").slice(-6);

/**
 * Every reference this parcel might be given, best first.
 *
 * The same list courierReference() walks — the route looks these up to find
 * out which are already spoken for, so the two must not drift apart.
 */
export function referenceCandidates(parcel: CourierParcel): string[] {
  if (parcel.courier_reference) return [parcel.courier_reference];

  const digits = phoneDigits(parcel.buyer_phone);

  // No mobile on the order — the order number is the only thing left that
  // identifies the parcel, and it is unique by itself.
  if (!digits) return [`BISH${orderTail(parcel)}`];

  return [`BISH${digits.slice(-5)}`, `BISH${digits.slice(-6)}`, `BISH${digits}`];
}

/**
 * The one address string the courier reads.
 *
 * Ends with the mobile number, as the accepted sheet does — couriers here work
 * off the number written into the address as often as the Mobile column, and a
 * delivery boy reading a printed slip only sees this field.
 */
export function courierAddress(p: CourierParcel): string {
  const parts: string[] = [];

  // Checkout asks for the town and the district separately, and for most of
  // Kerala the honest answer to both is the same word. "Kannur, Kannur" on a
  // parcel reads as a data-entry slip to the person delivering it.
  for (const raw of [p.address_line1, p.address_line2, p.city, p.district]) {
    const part = raw?.trim();
    if (!part) continue;
    if (parts.some((seen) => seen.toLowerCase() === part.toLowerCase())) continue;
    parts.push(part);
  }

  const phone = phoneDigits(p.buyer_phone);
  const line = parts.join(", ") + (phone ? `,${phone}` : "");
  return line.slice(0, ADDRESS_MAX);
}

/**
 * One parcel, one row, in the header order above.
 *
 * Numbers stay numbers (pincode, mobile, weight, amounts) because that is how
 * the accepted sheet stores them. Anything we don't have is an empty string,
 * which the writer leaves as a genuinely empty cell rather than "".
 */
export function courierSheetRow(p: CourierParcel, reference: string): unknown[] {
  const d = COURIER_DEFAULTS;
  const mobile = phoneDigits(p.buyer_phone);
  const pincode = (p.pincode ?? "").replace(/\D/g, "");
  const books = Math.max(1, p.quantity || 1);

  return [
    "",                                   // Waybill — the courier fills this in
    reference,
    (p.buyer_name ?? "").toUpperCase(),   // shouted, as the sheet expects
    "",                                   // City
    "",                                   // State
    "",                                   // Country
    courierAddress(p),
    pincode ? Number(pincode) : "",
    "",                                   // Phone
    mobile ? Number(mobile) : "",
    d.weightPerBookGrams * books,
    d.lengthCm,
    d.breadthCm,
    d.heightCm,
    d.packagingType,
    d.paymentMode,
    Math.round((p.amount_paise ?? 0) / 100),
    0,                                    // Cod Amount — prepaid, always
    d.product,
    d.pickupLocation,
    d.returnAddress,
    d.returnPin,
    d.shippingMode,
    d.fragile,
    "",                                   // alternate_phone
    "",                                   // shipment_type
    "",                                   // master_id
    "",                                   // mps_children
    "",                                   // mps_amount
    d.sellerName,
    d.sellerAddress,
  ];
}

/**
 * A whole batch: the sheet's rows, and the reference each parcel was given.
 *
 * The references come back out because they have to be written to the orders —
 * the file in the agent's hands and the row in the database have to agree on
 * what the courier was told, forever.
 */
export function buildCourierSheet(
  parcels: CourierParcel[],
  /** References already in use, from the database. */
  existing: Iterable<string> = []
): { rows: unknown[][]; references: string[] } {
  const taken = new Set(existing);
  const rows: unknown[][] = [];
  const references: string[] = [];

  for (const p of parcels) {
    const ref = courierReference(p, taken);
    taken.add(ref);
    references.push(ref);
    rows.push(courierSheetRow(p, ref));
  }

  return { rows, references };
}

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
  /** A weighed book, not an estimate. See parcelSize(). */
  weightPerBookGrams: 380,
  /** What the wrap adds to a gift parcel, however many books are in it. */
  giftWrapGrams: 20,
  /** The flat of the parcel. Constant however many books are stacked in it. */
  lengthCm: 25,
  breadthCm: 15,
  /**
   * One book thick. Books stack, so this is the part that grows.
   *
   * 2.0, not the 2.5 measured before: the old figure was the book plus a thick
   * flyer, and the packaging moved to a thinner mailer specifically to clear
   * India Post's document band. Their rule classifies anything under 500 g as
   * SP_INLAND_DOC by weight alone, and a document may not exceed 2 cm — so a
   * single 380 g book at 2.5 cm was a parcel their own validator would refuse
   * to call a parcel. At 2.0 it is an honest document.
   *
   * Shared with Delhivery, which is correct: it is the same physical parcel.
   * Nothing there depends on the old number — a book is dense enough that
   * actual weight always beats volumetric, so the declared freight does not
   * move.
   */
  heightPerBookCm: 2.0,
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

/** What a parcel physically is, once we know what is in it. */
export interface ParcelSize {
  weightGrams: number;
  lengthCm: number;
  breadthCm: number;
  heightCm: number;
}

/**
 * The weight and dimensions we declare for a parcel.
 *
 * Real measurements: one book is 380 g and 25 × 15 × 2.5 cm. Books stack, so
 * two books are the same flat and twice the height; the wrap on a gift parcel
 * adds 20 g and nothing to the shape.
 *
 * This used to be a flat 250 g in a 10 × 10 × 10 cm cube, which was neither
 * measured nor a shape any parcel of ours has ever been. It went to Delhivery
 * on every sheet and every API push, and under-declaring weight does not save
 * anything — the hub weighs the parcel and bills the difference back as a
 * discrepancy nobody can then explain against an invoice.
 *
 * Volumetric weight never bites at these numbers, which is worth knowing
 * before anyone tries to optimise the packaging: a book is dense. One book is
 * 937 cm³, about 190 g volumetric against 380 g actual, and stacking books
 * grows both in step. Every carrier here charges the higher of the two, so it
 * is always the real weight.
 */
export function parcelSize(quantity: number, isGift = false): ParcelSize {
  const d = COURIER_DEFAULTS;
  const books = Math.max(1, quantity || 1);

  return {
    weightGrams: d.weightPerBookGrams * books + (isGift ? d.giftWrapGrams : 0),
    lengthCm: d.lengthCm,
    breadthCm: d.breadthCm,
    // Rounded to a millimetre: 2.5 per book is exact, but a carrier's form
    // taking three decimals of a centimetre is a form we filled in wrong.
    heightCm: Math.round(d.heightPerBookCm * books * 10) / 10,
  };
}

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
  /** Whose parcel it is: the reference is coded per courier. */
  courier_id?: string | null;
  /** Gift wrap adds weight, so the declared parcel needs to know. */
  is_gift?: boolean | null;
}

/** Just the digits, and without the country code a phone box may have kept. */
export function phoneDigits(phone: string | null | undefined): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits;
}

/**
 * The reference number the courier files this parcel under.
 *
 * The courier's code, then the order number: `SP-YP97XR`, `BISH-4K2M9Q`. Both
 * halves are there for a reason, and the reason for each is a bug this has
 * already caused.
 *
 * The order number, because it is unique. References used to be `BISH` plus
 * the last five digits of the customer's mobile — short, and it pointed at the
 * customer when the courier rang about a parcel. Five digits collide about
 * once in a hundred thousand, which sounded rare and was not: two customers
 * sharing a phone tail is one thing, but a *courier* holding an old parcel
 * under that same string is another, and Delhivery's reference index is not
 * unique on their side. An order number cannot do that to us. It is what the
 * API push already sends as `order`, so the two ways a parcel reaches
 * Delhivery now agree on what it is called.
 *
 * The courier's code, because a reference has to say whose it is. ORD-YP97XR
 * went to India Post under `BISH40490`; Delhivery had a different customer's
 * shipment filed under `BISH40490`; the tracking sync matched them and gave an
 * unposted parcel somebody else's waybill and their "Delivered" scan. Nothing
 * about the number itself said it was not Delhivery's to answer for.
 *
 * `taken` is both the references already stored against other orders and the
 * ones handed out earlier in this same batch. A collision is now impossible by
 * construction — one order has one number — so this is a backstop against a
 * duplicated order number rather than the routine case it used to be.
 */
export function courierReference(
  parcel: CourierParcel,
  taken: Set<string>,
  /** The courier's prefix — `referenceCode()` in lib/couriers. */
  code: string
): string {
  // A parcel that has been on a sheet before keeps the number the courier
  // already has. Re-coding it would rename a parcel in somebody else's system.
  if (parcel.courier_reference) return parcel.courier_reference;

  const preferred = `${code}-${orderTail(parcel)}`;
  if (!taken.has(preferred)) return preferred;

  // Only reachable if two orders share a number tail. Kept short and still
  // traceable rather than clever: whatever this returns has to be readable
  // down a column of a hundred.
  for (let n = 2; n < 100; n++) {
    const candidate = `${preferred}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${preferred}-${Date.now().toString(36).toUpperCase()}`;
}

/** The tail of the order number — the part that makes it unique. */
const orderTail = (parcel: CourierParcel) =>
  parcel.order_number.replace(/\W/g, "").slice(-6).toUpperCase();

/**
 * Every reference this parcel might be given, best first.
 *
 * The same list courierReference() walks — the route looks these up to find
 * out which are already spoken for, so the two must not drift apart. One
 * candidate now, where the phone-derived scheme needed four.
 */
export function referenceCandidates(parcel: CourierParcel, code: string): string[] {
  if (parcel.courier_reference) return [parcel.courier_reference];
  return [`${code}-${orderTail(parcel)}`];
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
  const size = parcelSize(books, !!p.is_gift);

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
    size.weightGrams,
    size.lengthCm,
    size.breadthCm,
    size.heightCm,
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
  existing: Iterable<string> = [],
  /**
   * This parcel's courier code. A callback rather than one code for the sheet:
   * an owner can tick parcels routed to two different partners, and the code
   * has to follow the parcel rather than the file it happens to be in.
   */
  codeFor: (parcel: CourierParcel) => string = () => "BISH"
): { rows: unknown[][]; references: string[] } {
  const taken = new Set(existing);
  const rows: unknown[][] = [];
  const references: string[] = [];

  for (const p of parcels) {
    const ref = courierReference(p, taken, codeFor(p));
    taken.add(ref);
    references.push(ref);
    rows.push(courierSheetRow(p, ref));
  }

  return { rows, references };
}

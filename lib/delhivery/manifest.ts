import { delhiveryRequest, DelhiveryError } from "./client";
import { trackReferencesResilient } from "./track";
import { EWAYBILL_THRESHOLD_PAISE, type DelhiverySettings } from "./config";
import {
  COURIER_DEFAULTS,
  parcelSize,
  courierAddress,
  phoneDigits,
  type CourierParcel,
} from "@/lib/courier-sheet";

/**
 * Manifesting parcels — the call that hands a parcel to Delhivery.
 *
 * The payload is built from `courierAddress()` and `phoneDigits()`, the same
 * functions that build the Excel sheet, on purpose: that address format has
 * been accepted by this courier for a year, trailing mobile number and all.
 * Reformatting it for the API would mean testing a new format we have no
 * evidence for, at the exact moment we lose the human who would have noticed.
 *
 * `COURIER_DEFAULTS` supplies weight, dimensions, packaging and the return
 * address for the same reason — one definition, two channels.
 */

/**
 * Delhivery's own oddity: a body that reads like a form but is sent as JSON.
 *
 * Their Postman collection posts `format=json&data={…raw JSON…}` with
 * `Content-Type: application/json`, and the JSON is NOT url-encoded. An
 * earlier version of this file did encode it, which produces a body their
 * parser reads as one long meaningless string.
 *
 * Because the payload is spliced into something shaped like a form body, an
 * `&` inside an address can end the `data` field early wherever their parser
 * splits on it. `courierAddress()` is sanitised for that below rather than
 * here, so the sheet and the API keep producing the same string.
 */
function encodeCreateBody(payload: unknown): string {
  return `format=json&data=${JSON.stringify(payload)}`;
}

/**
 * The address, with the characters that could break the body above removed.
 *
 * "&" becomes "and" — which is what someone writing an address on a parcel
 * does anyway — and "#" goes, since it would start a fragment if any layer
 * treats this as a URL. Applied on top of `courierAddress()` rather than
 * inside it, so the Excel sheet is untouched.
 */
function safeAddress(parcel: CourierParcel): string {
  return courierAddress(parcel).replace(/&/g, " and ").replace(/#/g, " ").replace(/\s+/g, " ").trim();
}

export interface ManifestResult {
  order_number: string;
  ok: boolean;
  waybill: string | null;
  /** Their wording when they refuse one, for the admin screen. */
  error: string | null;
  /**
   * They told us they do not know either.
   *
   * Delhivery answers some failures with "Package creation API error. Package
   * might be saved." — which is not a refusal, it is an admission that the
   * shipment may exist. Treating it as a refusal releases the claim and invites
   * a second manifest for a parcel that already has one.
   */
  uncertain: boolean;
  /**
   * The shipment already existed and we adopted its waybill instead of making
   * a second one. Reported so the screen can say so rather than claiming a send
   * that never happened.
   */
  adopted?: boolean;
}

interface CreateResponse {
  success?: boolean;
  packages?: {
    status?: string;
    waybill?: string;
    refnum?: string;
    remarks?: string[] | string;
    client?: string;
    sort_code?: string;
  }[];
  rmk?: string;
  error?: unknown;
}

/** One shipment, in Delhivery's field names. */
function shipment(parcel: CourierParcel, settings: DelhiverySettings) {
  const d = COURIER_DEFAULTS;
  const books = Math.max(1, parcel.quantity || 1);
  const size = parcelSize(books, !!parcel.is_gift);
  const mobile = phoneDigits(parcel.buyer_phone);

  return {
    // Consignee
    name: (parcel.buyer_name ?? "").toUpperCase(),
    add: safeAddress(parcel),
    pin: (parcel.pincode ?? "").replace(/\D/g, ""),
    city: parcel.city ?? "",
    state: parcel.state ?? "",
    country: "India",
    phone: mobile,

    // The order. `order` is our order_number: unique by construction, already
    // the key on every screen, and it comes back in the tracking webhook as
    // ReferenceNo — so a scan maps to an order with no lookup table.
    order: parcel.order_number,

    // Left empty so Delhivery assigns one. We do not pre-allocate waybills;
    // if that changes (Phase 0 question 6) this is where they would go.
    waybill: "",

    // Money. Every order here is paid before it reaches the portal, so this is
    // never COD and cod_amount is always zero — sending a COD amount on a
    // prepaid parcel is how a customer gets asked to pay twice.
    payment_mode: "Prepaid",
    total_amount: Math.round((parcel.amount_paise ?? 0) / 100),
    cod_amount: 0,

    // The parcel itself
    products_desc: d.product,
    quantity: books,
    weight: size.weightGrams,
    shipment_length: size.lengthCm,
    shipment_width: size.breadthCm,
    shipment_height: size.heightCm,
    fragile_shipment: d.fragile,
    shipping_mode: settings.shippingMode,

    // Seller and returns
    seller_name: d.sellerName,
    seller_add: d.sellerAddress,
    return_add: d.returnAddress,
    return_pin: String(d.returnPin),
    return_name: d.sellerName,

    // Both optional per their collection. Omitted entirely when unset rather
    // than sent empty — an empty string is a value they may validate.
    ...(settings.clientName ? { client: settings.clientName } : {}),

    // e-waybill fields only. Below ₹50,000 Delhivery does not want them, and a
    // book order is never close — but a hundred-copy bulk order would be, and
    // a shipment rejected for a missing GST number at that point would be a
    // mystery. See EWAYBILL_THRESHOLD_PAISE.
    ...(needsEwaybill(parcel)
      ? {
          ...(settings.sellerGstTin ? { seller_gst_tin: settings.sellerGstTin } : {}),
          ...(settings.hsnCode ? { hsn_code: settings.hsnCode } : {}),
        }
      : {}),
  };
}

/** Is this shipment worth enough that Delhivery wants an e-waybill? */
const needsEwaybill = (parcel: CourierParcel) =>
  (parcel.amount_paise ?? 0) >= EWAYBILL_THRESHOLD_PAISE;

/**
 * Does Delhivery already have a shipment for this order?
 *
 * They index an API push under whatever we sent as `order`, which is our order
 * number — so this asks by the same name we would create it under. A waybill
 * coming back means the shipment exists and must not be created again.
 *
 * This is the answer to the only genuinely dangerous case in this file. A send
 * whose outcome we never learned, or one Delhivery reported as refused but had
 * in fact saved, leaves a parcel that looks unsent and is not. Creating it a
 * second time gives one customer two parcels, two waybills and one book.
 *
 * Costs one read per parcel. Their pull limit is 750 requests per five minutes,
 * so a day's parcels is nowhere near it, and the alternative is being wrong
 * about a thing that cannot be undone from here.
 */
export async function existingWaybill(
  orderNumber: string,
  settings: DelhiverySettings
): Promise<string | null> {
  try {
    const found = await trackReferencesResilient([orderNumber], settings);

    // Exact match first. Anything less is a guess, and the cost of guessing
    // wrong here is a customer receiving somebody else's tracking link.
    const exact = found.find((f) => f.reference === orderNumber);
    if (exact) return exact.waybill;

    // Delhivery sometimes answers without echoing ReferenceNo. One result to a
    // one-id query is unambiguous — but only when there is exactly one and it
    // carries no conflicting reference.
    if (found.length === 1 && !found[0].reference) return found[0].waybill;

    return null;
  } catch (e) {
    // A lookup we could not make is not evidence of absence. Returning null
    // lets the send proceed — which is the same risk this function existed
    // before, not a new one — and the claim still stops a concurrent second.
    console.warn("[Delhivery] existence check failed:", orderNumber, e);
    return null;
  }
}

/**
 * Hand parcels to Delhivery, one call each.
 *
 * Their create API takes an array, and this used to send the whole selection in
 * a single request. That is the efficient shape and the wrong one: a call
 * carrying fifty shipments that times out leaves all fifty in an unknown state,
 * every one of them possibly created, none of them safe to retry — which is
 * exactly how six parcels ended up sitting at Delhivery while our screens said
 * "Not with them".
 *
 * One parcel per call makes the blast radius one parcel. A timeout costs a
 * single order, we know precisely which, and the other forty-nine are unharmed.
 * The cost is fifty requests instead of one, which for a shop sending a few
 * dozen parcels a day is a trade worth making every time.
 *
 * Each parcel is checked for an existing shipment first, so this is safe to
 * run again over anything: a parcel Delhivery already has is adopted, never
 * duplicated.
 *
 * Never throws. A failure is one parcel's result, not the batch's — that is the
 * whole point of the shape.
 */
export async function manifestParcels(
  parcels: CourierParcel[],
  settings: DelhiverySettings
): Promise<ManifestResult[]> {
  const out: ManifestResult[] = [];
  for (const parcel of parcels) {
    out.push(await manifestOne(parcel, settings));
  }
  return out;
}

/** One parcel, start to finish: check, create, interpret. */
async function manifestOne(
  parcel: CourierParcel,
  settings: DelhiverySettings
): Promise<ManifestResult> {
  const already = await existingWaybill(parcel.order_number, settings);
  if (already) {
    return {
      order_number: parcel.order_number,
      ok: true,
      waybill: already,
      error: null,
      uncertain: false,
      adopted: true,
    };
  }

  const payload = {
    shipments: [shipment(parcel, settings)],
    // Only `name` is mandatory, but every working example in Delhivery's
    // collection sends the whole warehouse — and a payload they can resolve
    // without a lookup is one less thing to be rejected over.
    pickup_location: {
      name: settings.pickupLocation,
      ...(settings.pickupCity ? { city: settings.pickupCity } : {}),
      ...(settings.pickupPin ? { pin: settings.pickupPin } : {}),
      ...(settings.pickupPhone ? { phone: settings.pickupPhone } : {}),
      ...(settings.pickupAddress ? { add: settings.pickupAddress } : {}),
      country: "India",
    },
  };

  try {
    const response = await delhiveryRequest<CreateResponse>({
      settings,
      path: "/api/cmu/create.json",
      method: "POST",
      form: encodeCreateBody(payload),
      // Their collection sends this form-shaped body as application/json, not
      // as x-www-form-urlencoded. Matching it exactly.
      contentType: "application/json",
      // Never. A timeout here may still have created the shipment.
      retryOnNetworkError: false,
    });

    return matchResults([parcel], response)[0];
  } catch (e) {
    const err = e instanceof DelhiveryError ? e : null;

    // Unknown means unknown: hold it, and let the next Sync find out. Now that
    // Sync asks by order number, that is a question with an answer.
    if (!err || err.kind === "unknown") {
      return {
        order_number: parcel.order_number,
        ok: false,
        waybill: null,
        uncertain: true,
        error:
          err?.message ??
          "The send did not complete — Sync will find it if Delhivery has it.",
      };
    }

    return {
      order_number: parcel.order_number,
      ok: false,
      waybill: null,
      uncertain: false,
      error: err.message,
    };
  }
}

/**
 * Phrases in which Delhivery is telling us the outcome is unknown.
 *
 * Their wording, not ours. "Package might be saved" is the important one and
 * means exactly what it says.
 */
const UNCERTAIN_PHRASES = [
  "might be saved",
  "may be saved",
  "might have been created",
  "contact tech.admin",
];

const soundsUncertain = (text: string) =>
  UNCERTAIN_PHRASES.some((p) => text.toLowerCase().includes(p));

/**
 * Line their answer up with what we sent.
 *
 * Matched on `refnum` (our order number) rather than array position: their
 * docs do not promise the packages come back in the order they went out, and
 * pairing a waybill with the wrong order is the kind of bug that only surfaces
 * when a customer gets someone else's tracking link.
 */
function matchResults(
  parcels: CourierParcel[],
  response: CreateResponse
): ManifestResult[] {
  const byRef = new Map<string, NonNullable<CreateResponse["packages"]>[number]>();
  for (const pkg of response.packages ?? []) {
    if (pkg.refnum) byRef.set(String(pkg.refnum), pkg);
  }

  return parcels.map((p) => {
    const pkg = byRef.get(p.order_number);

    if (!pkg) {
      return {
        order_number: p.order_number,
        ok: false,
        waybill: null,
        // Delhivery said nothing about this parcel, which is not the same as
        // refusing it — so it is uncertain, and must be held.
        uncertain: true,
        error:
          response.rmk?.trim() ||
          "Delhivery's response did not mention this parcel — check their dashboard before sending it again.",
      };
    }

    const remarks = Array.isArray(pkg.remarks)
      ? pkg.remarks.filter(Boolean).join("; ")
      : (pkg.remarks ?? "");

    // Their success marker is the string "Success" on each package; anything
    // else is a refusal, whatever the HTTP status was.
    const ok = String(pkg.status ?? "").toLowerCase() === "success" && !!pkg.waybill;

    return {
      order_number: p.order_number,
      ok,
      waybill: ok ? String(pkg.waybill) : null,
      uncertain: !ok && soundsUncertain(remarks),
      error: ok ? null : remarks || "Delhivery refused this parcel without saying why.",
    };
  });
}

export { DelhiveryError };

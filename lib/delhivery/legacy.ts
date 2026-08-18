import { phoneDigits } from "@/lib/courier-sheet";

/**
 * Finding old parcels the courier already has.
 *
 * Orders placed before migration 0024 never got a `courier_reference`, but they
 * are in the courier's system under *something* — earlier sheets used earlier
 * schemes. These are the ones we know of, best first.
 *
 * The dangerous part is not generating candidates; it is accepting a match.
 * `BISH` + four digits of a mobile collides roughly once in ten thousand, and
 * `BISH` + a pincode collides constantly — hundreds of our parcels go to
 * 673001, so that candidate would match a shipment belonging to a different
 * customer almost every time. Writing that waybill onto this order would send
 * one customer another customer's tracking link, and the mistake would only
 * surface when they rang up about a parcel going to a town they have never
 * heard of.
 *
 * So a speculative match is never accepted on the key alone: `corroborates()`
 * makes the shipment prove it is the right one. Anything that matches the key
 * and fails the proof is ambiguous, and waits for a person.
 */

export interface LegacyOrder {
  order_number: string;
  buyer_phone: string | null;
  pincode: string | null;
  amount_paise: number | null;
}

/**
 * Every reference an old parcel might be filed under, best first.
 *
 * Ordered by how much they prove on their own: the full mobile is nearly
 * unique, four digits much less so, and a pincode proves almost nothing. The
 * corroboration below is what makes the weak ones safe to try at all.
 */
export function legacyCandidates(order: LegacyOrder): string[] {
  const digits = phoneDigits(order.buyer_phone);
  const pin = (order.pincode ?? "").replace(/\D/g, "");
  const out: string[] = [];

  if (digits) {
    out.push(`BISH${digits}`);          // the whole mobile
    out.push(`BISH${digits.slice(-6)}`);
    out.push(`BISH${digits.slice(-5)}`); // the current scheme
    out.push(`BISH${digits.slice(-4)}`); // an older one
  }
  if (/^\d{6}$/.test(pin)) out.push(`BISH${pin}`);
  out.push(order.order_number);

  return [...new Set(out)].filter(Boolean);
}

/** What the courier told us about a shipment we are considering claiming. */
export interface CandidateShipment {
  waybill: string;
  reference: string | null;
  /** Rupees, as they hold it. */
  invoiceAmount: number | null;
  destinationPin: string | null;
  consigneePhone: string | null;
}

export type MatchVerdict =
  | { ok: true; waybill: string; why: string }
  | { ok: false; why: string };

/**
 * Does this shipment actually describe this order?
 *
 * Two independent facts must agree — the money and the destination — because
 * either alone is weak: plenty of our orders are the same price, and plenty go
 * to the same pincode. Together they are strong enough to write a waybill on.
 * The mobile is accepted as a substitute for the pincode when the courier
 * gives us one, since it identifies a person rather than a town.
 *
 * A fact the courier does not return cannot agree or disagree, and is not
 * counted either way — but at least two must actively agree, so a shipment
 * that tells us nothing is never accepted.
 */
export function corroborates(
  order: LegacyOrder,
  shipment: CandidateShipment
): MatchVerdict {
  const agreed: string[] = [];
  const conflicted: string[] = [];

  const ourRupees = Math.round((order.amount_paise ?? 0) / 100);
  if (shipment.invoiceAmount != null && ourRupees > 0) {
    if (Math.round(shipment.invoiceAmount) === ourRupees) agreed.push("amount");
    else conflicted.push(`amount ${shipment.invoiceAmount} vs ${ourRupees}`);
  }

  const ourPin = (order.pincode ?? "").replace(/\D/g, "");
  const theirPin = (shipment.destinationPin ?? "").replace(/\D/g, "");
  if (ourPin && theirPin) {
    if (ourPin === theirPin) agreed.push("pincode");
    else conflicted.push(`pincode ${theirPin} vs ${ourPin}`);
  }

  const ourPhone = phoneDigits(order.buyer_phone);
  const theirPhone = phoneDigits(shipment.consigneePhone);
  if (ourPhone && theirPhone) {
    if (ourPhone === theirPhone) agreed.push("mobile");
    else conflicted.push(`mobile ${theirPhone} vs ${ourPhone}`);
  }

  // One disagreement is enough to refuse. A shipment that is right about the
  // money and wrong about the town is not this parcel.
  if (conflicted.length) {
    return { ok: false, why: `conflicts on ${conflicted.join(", ")}` };
  }
  if (agreed.length < 2) {
    return {
      ok: false,
      why: agreed.length
        ? `only ${agreed[0]} agrees — not enough to be sure`
        : "the courier returned nothing to check it against",
    };
  }

  return { ok: true, waybill: shipment.waybill, why: `${agreed.join(" and ")} agree` };
}

/**
 * Choose between every shipment the courier filed under one reference.
 *
 * A reference is not a key on their side. `BISH3317` really does return two
 * parcels — the old four-digit scheme collided, and both customers' shipments
 * live under it. An earlier version of this matcher kept a map keyed by
 * reference, so the second silently overwrote the first and the decision came
 * down to response order: the same order would have been matched to a
 * different customer's waybill depending on which arrived last.
 *
 * So all of them are considered, and a match is only taken when **exactly
 * one** corroborates. Two plausible answers is not a 50/50 worth taking when
 * the cost of being wrong is a customer tracking someone else's parcel.
 */
export function pickMatch(
  order: LegacyOrder,
  shipments: CandidateShipment[]
): MatchVerdict {
  if (!shipments.length) return { ok: false, why: "the courier has no such reference" };

  const passed = shipments
    .map((s) => ({ s, v: corroborates(order, s) }))
    .filter((r) => r.v.ok);

  if (passed.length === 1) {
    const only = passed[0];
    return {
      ok: true,
      waybill: only.s.waybill,
      why: only.v.ok ? only.v.why : "",
    };
  }

  if (passed.length > 1) {
    return {
      ok: false,
      why: `${passed.length} of the courier's shipments fit this order equally well`,
    };
  }

  // Nothing passed. Report the closest attempt, since "amount agrees, pincode
  // does not" tells whoever reads it far more than "no match".
  const first = shipments[0] && corroborates(order, shipments[0]);
  return { ok: false, why: first && !first.ok ? first.why : "nothing corroborated" };
}

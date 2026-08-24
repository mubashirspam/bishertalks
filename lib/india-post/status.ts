import type { OrderStatus } from "@/lib/types/order";

/**
 * Reading an India Post event.
 *
 * The counterpart of lib/delhivery/status.ts, and built on the same two rules,
 * because both exist to stop the same two mistakes. What differs is that India
 * Post's vocabulary is a small closed set of event codes rather than free text,
 * which makes this mapping exact — with one exception that is the whole reason
 * this file needs care.
 *
 *   **ITEM_DELIVERY means two opposite things.** "Item Delivered(Addressee)"
 *   is a delivery. "Item Delivered(Sender)" is a completed return: the parcel
 *   came back to us. The code is identical; only the description separates
 *   them. Matching on the code alone would mark every returned book as
 *   delivered and approve a referral commission on a parcel sitting on our own
 *   shelf.
 *
 *   **ITEM_RETURN is not `returned`.** It is the *start* of the return
 *   journey, exactly like Delhivery's RT, and the parcel is still in a postal
 *   van. Only the delivery-to-sender above closes it.
 *
 * Everything else either moves the parcel forward or is recorded as a scan and
 * changes nothing.
 */

export interface IndiaPostEvent {
  /** Their code, e.g. ITEM_BOOK. Upper case in every sample we have. */
  eventCode: string;
  /** Their wording, which is the only thing that separates the two deliveries. */
  eventDescription: string;
  /** ISO timestamp, assembled from their separate date and time fields. */
  at: string | null;
  /** The office the scan happened at. */
  office: string | null;
  /** Set on a failed delivery attempt. */
  nonDeliveryReason: string | null;
}

/**
 * The order status this event implies, or null to record the scan and leave
 * the status alone.
 */
export function statusFromEvent(event: IndiaPostEvent): OrderStatus | null {
  const code = (event.eventCode ?? "").trim().toUpperCase();
  const text = (event.eventDescription ?? "").trim().toLowerCase();

  switch (code) {
    // Accepted at the counter. From our side the parcel has left the building,
    // which is what `shipped` means everywhere else in this system.
    case "ITEM_BOOK":
      return "shipped";

    // Invoiced to the postman, or out on the beat. Either way it is on its way
    // to the door today.
    case "ITEM_INVOICE":
    case "ITEM_TOBO":
    case "BEAT_DISPATCH":
      return "out_for_delivery";

    case "ITEM_DELIVERY": {
      // The one case where the description decides. "(Sender)" means the
      // parcel came back to us — a completed RTS, not a delivery.
      if (text.includes("sender")) return "returned";
      if (text.includes("addressee")) return "delivered";

      // Neither word present. Their samples always carry one, so this is a
      // shape we have not seen — and guessing "delivered" would be the
      // expensive half of the guess. Record the scan, move nothing, and let a
      // human look.
      console.warn(
        `[India Post] ITEM_DELIVERY with neither Addressee nor Sender: "${event.eventDescription}"`
      );
      return null;
    }

    // The return journey has begun. The customer has not had the parcel and we
    // do not have it back yet, so nothing moves until the delivery-to-sender
    // above arrives.
    case "ITEM_RETURN":
      return null;

    // Transit, holds and redirections. All real information, none of it a
    // change of state: recorded as the latest scan and nothing more.
    case "BAG_CLOSE":
    case "BAG_DISPATCH":
    case "BAG_OPEN":
    case "ITEM_DISPATCH":
    case "ITEM_RECEIVE":
    case "ITEM_ONHOLD":
    case "ITEM_REDIRECT":
      return null;

    // Pickup-request events, for parcels a postman collects. We hand ours in
    // at the counter, so these should never arrive; they are listed rather
    // than falling through so that an unknown code stays genuinely unknown.
    case "UNASSIGNED":
    case "ASSIGNED":
    case "CANCELLED":
    case "PICKEDUP":
    case "INDUCTED":
      return null;

    default:
      console.warn(`[India Post] unmapped event ${code}: "${event.eventDescription}"`);
      return null;
  }
}

/** The line shown on the portal row, in their words plus where it happened. */
export function describeEvent(event: IndiaPostEvent): string {
  const parts = [(event.eventDescription || event.eventCode || "").trim()];
  if (event.nonDeliveryReason?.trim()) parts.push(event.nonDeliveryReason.trim());
  if (event.office?.trim()) parts.push(event.office.trim());
  return parts.filter(Boolean).join(" — ");
}

/**
 * Their date and time, which arrive as separate fields in two different shapes.
 *
 * The webhook sends `2025-11-09` and `08:37:52`; the event XML sends `01102021`
 * and `093000`. Both are handled because both are documented, and a timestamp
 * silently parsed as garbage would sort a parcel's history wrongly forever.
 *
 * Treated as IST, which is what they are — the Department of Posts does not
 * operate in another timezone.
 */
export function eventTimestamp(date: string, time: string): string | null {
  const d = (date ?? "").trim();
  const t = (time ?? "").trim();
  if (!d) return null;

  let iso: string | null = null;

  // 2025-11-09
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) iso = d;
  // 09112025 — DDMMYYYY
  else if (/^\d{8}$/.test(d)) iso = `${d.slice(4, 8)}-${d.slice(2, 4)}-${d.slice(0, 2)}`;
  else return null;

  let clock = "00:00:00";
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(t)) clock = t.length === 5 ? `${t}:00` : t;
  else if (/^\d{6}$/.test(t)) clock = `${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}`;

  const parsed = new Date(`${iso}T${clock}+05:30`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

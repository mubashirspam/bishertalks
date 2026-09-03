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
  /**
   * Their code, e.g. ITEM_BOOK.
   *
   * Present on the webhook push and **absent from bulk tracking**, which
   * returns only the wording. So this is allowed to be empty and the reader
   * falls back to the description — see `statusFromEvent`.
   */
  eventCode: string;
  /** Their wording. On bulk tracking it is all we get. */
  eventDescription: string;
  /** ISO timestamp, assembled from their separate date and time fields. */
  at: string | null;
  /** The office the scan happened at. */
  office: string | null;
  /** Set on a failed delivery attempt. */
  nonDeliveryReason: string | null;
  /**
   * Their own summary of where the article ended up — `del_status` on the bulk
   * tracking response, e.g. "delivered".
   *
   * The only thing that can tell a delivery from a completed return when the
   * event text is the bare "Item Delivered", which is exactly what bulk
   * tracking sends. Absent on the webhook, where the description carries the
   * qualifier instead.
   */
  deliverySummary?: string | null;
}

/**
 * The order status this event implies, or null to record the scan and leave
 * the status alone.
 */
export function statusFromEvent(event: IndiaPostEvent): OrderStatus | null {
  const kind = eventKind(event);

  switch (kind) {
    // Accepted at the counter. From our side the parcel has left the building,
    // which is what `shipped` means everywhere else in this system.
    case "booked":
      return "shipped";

    // Invoiced to the postman, or out on the beat. Either way it is on its way
    // to the door today.
    case "out_for_delivery":
      return "out_for_delivery";

    case "delivered_to_addressee":
      return "delivered";

    // A completed RTS: the parcel came back to us. Same event code as a
    // delivery, and on bulk tracking the same wording too — see eventKind().
    case "delivered_to_sender":
      return "returned";

    // The return journey has begun. The customer has not had the parcel and we
    // do not have it back yet, so nothing moves until the delivery-to-sender
    // above arrives.
    case "returning":
      return null;

    // Transit, holds and redirections. All real information, none of it a
    // change of state: recorded as the latest scan and nothing more.
    case "in_transit":
      return null;

    // A delivery whose direction we cannot establish. Guessing "delivered"
    // here is the expensive half of the guess — it would approve a referral
    // commission on a book that came back — so it is deliberately not guessed.
    case "delivered_unknown_direction":
      console.warn(
        `[India Post] a delivery with no direction: code "${event.eventCode}", ` +
          `text "${event.eventDescription}", summary "${event.deliverySummary ?? ""}"`
      );
      return null;

    default:
      console.warn(
        `[India Post] unmapped event: code "${event.eventCode}", text "${event.eventDescription}"`
      );
      return null;
  }
}

/**
 * What an event says happened, before any policy is applied to it.
 *
 * Exported because two callers want the same reading and disagree about what
 * to DO with it, which is a difference of policy rather than of vocabulary.
 * `statusFromEvent` below is the live path — a scan arriving about a parcel
 * whose journey we have been following, where "in transit" means "still where
 * I last said" and changes nothing.
 *
 * The delivery-report import is the other case. It reads a file about parcels
 * this system has heard nothing about since they crossed the counter, and
 * there "Item Dispatched" is not a non-event: it is proof the parcel is in the
 * postal network, which a parcel still sitting at `confirmed` here plainly
 * needs to be told. So that caller maps the same kinds to a *floor* — the
 * least this event proves — and lets `canMoveTo` refuse anything backwards.
 *
 * Keeping the reading here and the policy there is what stops the file import
 * needing a second copy of India Post's vocabulary, which is the one thing
 * guaranteed to drift.
 */
export type EventKind =
  | "booked"
  | "in_transit"
  | "out_for_delivery"
  | "delivered_to_addressee"
  | "delivered_to_sender"
  | "delivered_unknown_direction"
  | "returning"
  | "unknown";

/**
 * What happened, from whichever fields this particular endpoint filled in.
 *
 * Two endpoints report the same journey in different shapes, and neither is a
 * superset of the other:
 *
 *   webhook         event_code AND a qualified description
 *                   ("ITEM_DELIVERY", "Item Delivered(Addressee)")
 *   bulk tracking   description only, unqualified, plus a del_status summary
 *                   ("Item Delivered", del_status "delivered")
 *
 * So the code is used when it is there, the wording when it is not, and the
 * summary breaks the tie that the wording alone cannot. Reading only the code
 * would make bulk tracking a silent no-op — every parcel polled, nothing ever
 * moved.
 */
export function eventKind(event: IndiaPostEvent): EventKind {
  const code = (event.eventCode ?? "").trim().toUpperCase();
  const text = (event.eventDescription ?? "").trim().toLowerCase();
  const summary = (event.deliverySummary ?? "").trim().toLowerCase();

  /** Which end of the journey a delivery event belongs to. */
  const direction = (): EventKind => {
    if (text.includes("sender")) return "delivered_to_sender";
    if (text.includes("addressee")) return "delivered_to_addressee";

    // Bulk tracking's bare "Item Delivered". Their own summary is the only
    // thing left that knows which way the parcel went.
    if (/return|rts|sender/.test(summary)) return "delivered_to_sender";
    if (summary === "delivered") return "delivered_to_addressee";

    return "delivered_unknown_direction";
  };

  if (code) {
    switch (code) {
      case "ITEM_BOOK":
        return "booked";
      case "ITEM_INVOICE":
      case "ITEM_TOBO":
      case "BEAT_DISPATCH":
        return "out_for_delivery";
      case "ITEM_DELIVERY":
        return direction();
      case "ITEM_RETURN":
        return "returning";
      case "BAG_CLOSE":
      case "BAG_DISPATCH":
      case "BAG_OPEN":
      case "ITEM_DISPATCH":
      case "ITEM_RECEIVE":
      case "ITEM_ONHOLD":
      case "ITEM_REDIRECT":
        return "in_transit";
      // Pickup-request events, for parcels a postman collects. We hand ours in
      // at the counter, so these should never arrive; listed rather than left
      // to fall through so an unknown code stays genuinely unknown.
      case "UNASSIGNED":
      case "ASSIGNED":
      case "CANCELLED":
      case "PICKEDUP":
      case "INDUCTED":
        return "in_transit";
      default:
        return "unknown";
    }
  }

  // No code: bulk tracking. Match on their wording, which is a small closed
  // vocabulary — see the event lists attached to the approach document.
  if (!text) return "unknown";

  // Checked before the generic "returned to sender", because that phrase
  // contains "return" too and the two mean opposite things about where the
  // parcel is now.
  if (text.includes("delivered")) return direction();

  if (text.includes("returned to sender")) return "returning";
  if (text.includes("booked")) return "booked";
  if (text.includes("out for delivery") || text.includes("invoiced")) {
    return "out_for_delivery";
  }
  if (
    text.includes("bagged") ||
    text.includes("dispatch") ||
    text.includes("received") ||
    text.includes("receive") ||
    text.includes("hold") ||
    text.includes("redirect") ||
    // "Item inducted" — the article entering the postal network at the office
    // that took it in. The code path has had INDUCTED since this file was
    // written; the wording was missing, so 176 of the 2,110 rows in the first
    // real portal export came back unknown and moved nothing. Every one of
    // them is a parcel in transit that this system still had at Confirmed.
    text.includes("inducted")
  ) {
    return "in_transit";
  }

  return "unknown";
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

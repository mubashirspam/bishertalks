import type { OrderStatus } from "@/lib/types/order";

/**
 * Reading a Delhivery scan.
 *
 * The whole lifecycle is mapped, so a parcel moves through Packed → Shipped →
 * Out for delivery → Delivered on its own as their scans arrive. Two rules keep
 * that from doing damage:
 *
 *   1. Forward only. Delhivery replays scans and webhooks arrive out of order;
 *      without a rank a stale "Manifested" landing after "Delivered" would
 *      un-deliver a parcel and claw back a referral commission with it.
 *
 *   2. RTO is not "returned" until it is back. `RT` means the parcel is
 *      somewhere in the return journey — treating that as returned would void
 *      commissions for parcels still in a Delhivery van. Only the scan that
 *      says the return was *delivered* to us counts.
 *
 * Worth knowing what a status change costs: `shipped` and `delivered` each send
 * the customer a WhatsApp (NOTIFY_STATUSES), `delivered` approves the referral
 * commission, and `returned` voids it. Packed and Out for delivery are silent —
 * they only move the badge.
 */

export interface DelhiveryScan {
  /** Their own wording, shown as-is. */
  status: string;
  /** UD (in transit), DL (delivered), RT (RTO), PP (pending pickup), etc. */
  statusType: string;
  statusDateTime: string | null;
  location: string | null;
  instructions: string | null;
}

/**
 * How far along a status is. Only used to refuse a scan that would move a
 * parcel backwards — the numbers mean nothing else.
 *
 * `returned` and `cancelled` are absent on purpose: they are not further along
 * anything, they are exits, and they are handled separately below.
 */
const RANK: Record<string, number> = {
  confirmed: 0,
  processing: 1,
  shipped: 2,
  out_for_delivery: 3,
  delivered: 4,
};

/** Statuses nothing should move an order out of automatically. */
const TERMINAL = new Set(["delivered", "returned", "cancelled"]);

/**
 * The order status this scan implies, or null to leave the status alone.
 *
 * Matched on the wording as well as the type code, because the type alone is
 * far too coarse — `UD` covers everything from "we have created the label" to
 * "the customer was out".
 */
export function statusFromScan(scan: DelhiveryScan): OrderStatus | null {
  const type = scan.statusType.trim().toUpperCase();
  const text = scan.status.trim().toLowerCase();
  const isRto = text.includes("rto") || text.includes("dto") || type === "RT";

  // ── The return journey ────────────────────────────────────────────────────
  // Back in our hands. This is the only RTO scan that changes anything.
  if (isRto && (text.includes("delivered") || text.includes("received"))) {
    return "returned";
  }
  // In RTO transit — record the scan, leave the status. The parcel is still
  // out there, and the customer has not had it.
  if (isRto) return null;

  // ── The forward journey ───────────────────────────────────────────────────
  if (type === "DL" || text === "delivered") return "delivered";

  // "Dispatched" is Delhivery's word for out on the van today.
  if (text.includes("dispatched") || text.includes("out for delivery")) {
    return "out_for_delivery";
  }

  if (text.includes("in transit") || text.includes("intransit")) return "shipped";

  // Picked up from us but not yet moving through the network.
  if (text.includes("picked") && !text.includes("not picked")) return "shipped";

  // The label exists and the parcel is theirs to collect. Our "Packed".
  if (text.includes("manifested") || text.includes("not picked") || type === "PP") {
    return "processing";
  }

  // Lost, on hold, a failed delivery attempt, anything unrecognised: the scan
  // text is recorded and the status is left where it is. A human decides.
  return null;
}

/**
 * May this scan move an order from `current` to `next`?
 *
 * The guard that makes replayed and out-of-order scans harmless.
 */
export function canMoveTo(current: string, next: OrderStatus): boolean {
  if (current === next) return false;

  // A parcel that came back is the one exit that may be taken from anywhere
  // still in flight — a delivered parcel returning is a fresh order's problem,
  // not a scan's.
  if (next === "returned") return !TERMINAL.has(current);

  if (TERMINAL.has(current)) return false;

  const from = RANK[current];
  const to = RANK[next];
  if (from === undefined || to === undefined) return false;
  return to > from;
}

/**
 * A one-line summary for the portal and the order page.
 *
 * Their wording plus where it happened, because "In Transit" on its own answers
 * none of the questions a customer rings up to ask.
 */
export function describeScan(scan: DelhiveryScan): string {
  const parts = [scan.status.trim()];
  if (scan.location?.trim()) parts.push(scan.location.trim());
  return parts.filter(Boolean).join(" — ");
}

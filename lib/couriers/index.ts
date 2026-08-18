/**
 * Logistics partners — the public surface.
 *
 * Import from here rather than reaching into ./types, so that when a partner
 * gains an adapter (Phase 2) the screens don't each need repointing.
 */

export {
  COURIER_HANDOFFS,
  HANDOFF_LABELS,
  HANDOFF_HINTS,
  TRACKED_INTEGRATIONS,
  isCourierHandoff,
  canTrack,
  type Courier,
  type CourierConfig,
  type CourierHandoff,
} from "./types";

/**
 * How a parcel currently assigned to this partner gets to them, said in the
 * words an admin would use. The screens show this next to the partner's name,
 * because "Delhivery" alone does not tell anyone whether they still have to go
 * and upload something.
 */
export function handoffInstruction(handoff: string, integrated: boolean): string {
  switch (handoff) {
    case "api":
      return integrated
        ? "Press Send and they have it."
        : "No integration written yet — hand it over as usual.";
    case "sheet":
      return "Download the Excel sheet and upload it to them.";
    default:
      return "Hand it over or post it, then type the tracking number in.";
  }
}

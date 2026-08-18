/**
 * What is actually happening to a parcel.
 *
 * `status` answers "where is it in the customer's journey". It cannot answer
 * "is it stuck, and whose problem is it" — a parcel reading Confirmed might be
 * unassigned, waiting to be handed to KKR, sitting with KKR unmanifested, or
 * one KKR sent by another road entirely. Those need different people to do
 * different things.
 *
 * Derived in SQL (migration 0038, the `handover_state` column on
 * `portal_orders`) so it can be filtered, counted and paged. This module holds
 * only what each state is *called*; nothing here recomputes it, because a
 * second copy is a copy that drifts.
 *
 * The flow these describe, in order:
 *
 *   unassigned         nobody has decided anything yet
 *   to_hand_over       ours, going to KKR, not given to them yet
 *   awaiting_manifest  KKR has the data; they manifest at Delhivery
 *   with_courier       manifested — Delhivery's scans drive it from here
 *   not_manifested     we asked Delhivery and there is no shipment
 *   other_transport    KKR could not send it by Delhivery and used another road
 */

export const HANDOVER_STATES = [
  "unassigned",
  "to_hand_over",
  "awaiting_manifest",
  "with_courier",
  "not_manifested",
  "other_transport",
] as const;

export type HandoverState = (typeof HANDOVER_STATES)[number];

export const HANDOVER_LABELS: Record<HandoverState, string> = {
  unassigned: "Unassigned",
  to_hand_over: "To hand over",
  awaiting_manifest: "Awaiting manifest",
  with_courier: "With Delhivery",
  not_manifested: "Not manifested",
  other_transport: "Sent another way",
};

export const HANDOVER_HINTS: Record<HandoverState, string> = {
  unassigned: "No courier chosen. Tick it and assign it to KKR.",
  to_hand_over: "Assigned to KKR but not handed over yet — download the sheet for them.",
  awaiting_manifest: "KKR has the data. They manifest it at Delhivery; the waybill appears here when they do.",
  with_courier: "Manifested at Delhivery. Status comes from their scans.",
  not_manifested: "We asked Delhivery and there is no shipment. Either KKR has not manifested it, or they could not and have not reported it yet.",
  other_transport: "KKR could not send this by Delhivery and used another service. Tracking came from their spreadsheet.",
};

/** The ones where somebody has to do something. */
export const HANDOVER_NEEDS_ACTION: readonly HandoverState[] = [
  "unassigned",
  "to_hand_over",
  "not_manifested",
];

/** Chip colour by meaning: green settled, amber waiting, red stuck. */
export const HANDOVER_TONE: Record<HandoverState, string> = {
  unassigned: "border-neutral-500 bg-neutral-100 text-neutral-800",
  to_hand_over: "border-blue-500 bg-blue-50 text-blue-700",
  awaiting_manifest: "border-amber-500 bg-amber-50 text-amber-800",
  with_courier: "border-green-600 bg-green-50 text-green-700",
  not_manifested: "border-red-600 bg-red-50 text-red-700",
  other_transport: "border-purple-500 bg-purple-50 text-purple-700",
};

export function isHandoverState(v: unknown): v is HandoverState {
  return typeof v === "string" && (HANDOVER_STATES as readonly string[]).includes(v);
}

/** Every state, in the order the work happens — for chip rows and dropdowns. */
export const HANDOVER_CHIPS: readonly HandoverState[] = HANDOVER_STATES;

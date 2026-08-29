/**
 * The log's quick time windows.
 *
 * Its own module, with no "use client", because both halves need it: the
 * filter bar draws the chips and the server page turns the chosen key into a
 * timestamp. Exporting it from the client component instead looked fine — it
 * typechecked, it built, and every route answered 200 — and then failed at
 * render with `RANGES.find is not a function`, because what crosses that
 * boundary into a server component is a client reference, not the array.
 *
 * Same reason lib/crm/flow-table.ts exists: shared data belongs in a module
 * that has not declared which side of the wire it lives on.
 */
export const RANGES = [
  { key: "1h", label: "Last hour", hours: 1 },
  { key: "24h", label: "24 hours", hours: 24 },
  { key: "7d", label: "7 days", hours: 24 * 7 },
  { key: "30d", label: "30 days", hours: 24 * 30 },
  { key: "all", label: "All time", hours: 0 },
] as const;

export type RangeKey = (typeof RANGES)[number]["key"];

/** The window the log opens on. Not "all time" — see the page. */
export const DEFAULT_RANGE: RangeKey = "7d";

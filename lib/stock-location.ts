/**
 * Whose shelf a book is on — KKR, Ajmal, or Mubashir (0069).
 *
 * A closed, code-known list rather than a table like `couriers`: there are
 * three of these, they do not change often, and a new one is a code change
 * and a migration, not a form an owner fills in. Same reasoning as
 * `lib/delivery-mode.ts` and `lib/delivery-priority.ts`.
 *
 * Its own module, importing nothing, so a client form can read the labels
 * without dragging `supabaseAdmin` into the browser bundle — same rule as
 * `lib/inventory-movements.ts`.
 */

export const STOCK_LOCATIONS = ["kkr", "ajmal", "mubashir"] as const;

export type StockLocation = (typeof STOCK_LOCATIONS)[number];

export const STOCK_LOCATION_LABELS: Record<StockLocation, string> = {
  kkr: "KKR",
  ajmal: "Ajmal",
  mubashir: "Mubashir",
};

export function isStockLocation(v: unknown): v is StockLocation {
  return typeof v === "string" && (STOCK_LOCATIONS as readonly string[]).includes(v);
}

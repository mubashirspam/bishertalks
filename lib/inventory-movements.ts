/**
 * The vocabulary of stock movements — names, labels, and which way they go.
 *
 * Its own module, importing NOTHING, and that is a hard rule. The admin form
 * that offers these is a client component; `lib/db/inventory.ts` reaches for
 * `supabaseAdmin` and `next/cache`. One import of the DB layer from the form
 * pulls the service-role client into the browser bundle, which is both a build
 * error and, if it ever stopped being one, a much worse problem.
 *
 * Same arrangement and the same reason as `lib/crm/flow-table.ts`, which holds
 * the button table apart from the code that acts on it.
 */

export const MOVEMENT_KINDS = [
  "out_damaged",
  "out_author",
  "out_review",
  "out_lost",
  "in_returned",
  "in_correction",
  "out_correction",
] as const;

export type MovementKind = (typeof MOVEMENT_KINDS)[number];

/** What each kind is called on screen. The labels the admin form offers. */
export const MOVEMENT_LABELS: Record<MovementKind, string> = {
  out_damaged: "Damaged — written off",
  out_author: "Given to author / staff / office",
  out_review: "Review, press or giveaway copy",
  out_lost: "Missing — cannot be found",
  in_returned: "Came back and is sellable again",
  in_correction: "Stocktake found more",
  out_correction: "Stocktake found fewer",
};

/**
 * Does this kind add books to the shelf or take them off it?
 *
 * Read off the name rather than a second lookup table, because the prefix is
 * what the database CHECK constraint and the `book_stock` view both key on —
 * a separate map here could disagree with the SQL, and the screen would then
 * show a write-off as an addition.
 */
export function movementAdds(kind: MovementKind): boolean {
  return kind.startsWith("in_");
}

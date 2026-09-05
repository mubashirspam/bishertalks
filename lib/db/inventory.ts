import { unstable_cache } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { REVENUE_SCOPE } from "@/lib/db/sales-channel";
import { fetchAllRows } from "@/lib/db/paginate";
import {
  INVENTORY_TAG,
  INVENTORY_CACHE_SECONDS,
  revalidateInventory,
} from "@/lib/db/cache-tags";
import { MOVEMENT_KINDS, type MovementKind } from "@/lib/inventory-movements";

// The vocabulary lives in a module that imports nothing, so the admin form can
// read it without dragging this file — and `supabaseAdmin` with it — into the
// browser bundle. Re-exported so server callers still have one import.
export {
  MOVEMENT_KINDS,
  MOVEMENT_LABELS,
  movementAdds,
  type MovementKind,
} from "@/lib/inventory-movements";

/**
 * How many books there are.
 *
 * The shop had no answer to this. The only quantity anywhere was
 * `orders.quantity`, and the only cost was `business_costs.printing_paise` —
 * a per-book figure for the profit report that says nothing about how many
 * were printed. With books going out at a few hundred a day, "how many are
 * left" stopped being something anyone could hold in their head.
 *
 * Reads migration 0056. Every function here degrades rather than throws when
 * that migration has not been applied yet, because migrations in this project
 * are applied by hand and a deploy can land first — the admin page then says
 * "not set up" instead of showing a stack trace, the same contract
 * `getBusinessCosts()` has.
 */

export interface BookStock {
  /** Every copy ever printed, from `print_runs`. */
  printed: number;
  /** Shipped, out for delivery, or delivered — gone, whatever happens next. */
  shippedOut: number;
  /** Paid and waiting: on the shelf, but somebody has already bought it. */
  committed: number;
  /** Parcels that came back. NOT stock again until someone says so. */
  cameBack: number;
  /** Paid then cancelled. The book never left, so it needs no adjustment. */
  cancelled: number;
  /** Books added by hand — a stocktake surplus, or an RTO judged sellable. */
  adjustIn: number;
  /** Books written off — damaged, given away, lost, or a stocktake shortfall. */
  adjustOut: number;
  /** The `in_returned` share of adjustIn, for the "how many RTOs went back". */
  returnedToStock: number;
  /** Physically on the shelf. */
  onHand: number;
  /**
   * What is genuinely available to sell — on hand less what is already sold.
   *
   * **Can be negative, and is allowed to be.** Negative means more books are
   * sold than exist, which is a real state and the most urgent one this whole
   * module exists to surface. Clamping it to zero would hide it.
   */
  free: number;
}

/** The stock picture, or null when migration 0056 has not been applied. */
export async function getBookStock(): Promise<BookStock | null> {
  const { data, error } = await supabaseAdmin
    .from("book_stock")
    .select(
      "printed,shipped_out,committed,came_back,cancelled," +
        "adjust_in,adjust_out,returned_to_stock,on_hand,free"
    )
    .maybeSingle();

  if (error) {
    console.error("[Inventory] book_stock unreadable — is 0056 applied?", error.message);
    return null;
  }
  if (!data) return null;

  const n = (v: unknown) => Number(v ?? 0);
  const row = data as unknown as Record<string, unknown>;
  return {
    printed: n(row.printed),
    shippedOut: n(row.shipped_out),
    committed: n(row.committed),
    cameBack: n(row.came_back),
    cancelled: n(row.cancelled),
    adjustIn: n(row.adjust_in),
    adjustOut: n(row.adjust_out),
    returnedToStock: n(row.returned_to_stock),
    onHand: n(row.on_hand),
    free: n(row.free),
  };
}

export interface PrintRun {
  id: string;
  edition: number;
  copies: number;
  received_on: string;
  unit_cost_paise: number | null;
  printer: string | null;
  note: string | null;
  created_at: string;
}

/** Print runs, newest delivery first. Empty when 0056 is not applied. */
export async function listPrintRuns(): Promise<PrintRun[]> {
  const { data, error } = await supabaseAdmin
    .from("print_runs")
    .select("id,edition,copies,received_on,unit_cost_paise,printer,note,created_at")
    .order("received_on", { ascending: false });

  if (error) {
    console.error("[Inventory] print_runs unreadable:", error.message);
    return [];
  }
  return (data ?? []) as unknown as PrintRun[];
}

export interface StockMovement {
  id: string;
  kind: MovementKind;
  copies: number;
  reason: string;
  order_number: string | null;
  actor_email: string | null;
  created_at: string;
}

/** The movement log, newest first. Empty when 0056 is not applied. */
export async function listStockMovements(limit = 50): Promise<StockMovement[]> {
  const { data, error } = await supabaseAdmin
    .from("stock_movements")
    .select("id,kind,copies,reason,order_number,actor_email,created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[Inventory] stock_movements unreadable:", error.message);
    return [];
  }
  return (data ?? []) as unknown as StockMovement[];
}

export interface SalesRate {
  /** Books ordered per day, averaged over `days`. */
  perDay: number;
  /** How many days of orders that average came from. */
  days: number;
  /** Total books in the window, so the page can show the working. */
  books: number;
}

/**
 * How fast books are going out, from the orders themselves.
 *
 * Trailing average rather than all-time: this shop's first orders were a
 * fortnight of launch, and dividing every book ever sold by every day since
 * June describes a business that no longer exists. Seven days is short enough
 * to follow a real change in demand and long enough that one quiet Sunday does
 * not halve the forecast.
 *
 * Counted on `ordered_at` — when the money landed — not on dispatch. The
 * question this feeds is "how long until we run out", and a book is spoken for
 * the moment somebody pays for it, whatever date it eventually ships.
 */
export async function salesRate(days = 7): Promise<SalesRate> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  // Ordered, because an unordered paged read can repeat or skip rows between
  // pages — see fetchAllRows.
  const { rows } = await fetchAllRows<{ quantity: number | null }>(
    (from, to) =>
      supabaseAdmin
        .from("orders")
        .select("quantity")
        .eq("payment_status", "paid")
        // Direct sales move books but are held out of every book figure by
        // instruction (0061). Excluded here too, so the rate this feeds and
        // the `free` count it is divided into are measuring the same thing —
        // a rate over one population and a stock level over another would
        // produce a days-of-cover number that means nothing at all.
        .eq(REVENUE_SCOPE.column, REVENUE_SCOPE.value)
        .gte("ordered_at", since)
        .order("ordered_at", { ascending: true })
        .range(from, to),
    { label: "inventory sales rate" }
  );

  const books = rows.reduce(
    (sum: number, r: { quantity: number | null }) => sum + Math.max(1, r.quantity ?? 1),
    0
  );
  return { perDay: books / days, days, books };
}

/**
 * Days of stock left at the current rate, or null when it cannot be said.
 *
 * Null for a rate of zero — dividing by it gives Infinity, and "∞ days of
 * cover" on a screen about running out of books is worse than an honest blank.
 *
 * Deliberately computed against `free` rather than `onHand`. On-hand cover
 * counts books that are already sold to somebody who is waiting for them, and
 * a forecast built on stock you cannot sell twice is the optimistic kind that
 * gets a print run ordered a week late.
 */
export function daysOfCover(free: number, rate: SalesRate): number | null {
  if (rate.perDay <= 0) return null;
  return free / rate.perDay;
}

// ── Writing ─────────────────────────────────────────────────────────────────

export interface NewMovement {
  kind: MovementKind;
  copies: number;
  reason: string;
  orderNumber?: string | null;
  actorId?: string | null;
  actorEmail?: string | null;
}

/**
 * Record something that happened to the books which orders cannot explain.
 *
 * Validated here rather than only in the route, because the rules are about
 * the data and not about the request: a movement of zero copies is not a
 * movement, and one with no reason is a number nobody can account for six
 * weeks later. The database enforces both too — this exists so the person
 * typing gets a sentence instead of a constraint violation.
 *
 * There is deliberately no update and no delete. A stocktake that was entered
 * wrongly is corrected by recording the correction, which is how a physical
 * count actually works: the log is what happened, including the mistakes.
 */
export async function recordMovement(
  input: NewMovement
): Promise<{ ok: true } | { ok: false; error: string }> {
  const reason = input.reason?.trim() ?? "";
  const copies = Math.trunc(Number(input.copies));

  if (!MOVEMENT_KINDS.includes(input.kind)) {
    return { ok: false, error: "Pick what kind of movement this is." };
  }
  if (!Number.isFinite(copies) || copies < 1) {
    return { ok: false, error: "How many copies? It has to be at least one." };
  }
  // A cap, because the realistic mistake here is a typo in a number nobody
  // checks — and a stray digit on a write-off silently empties the shelf.
  if (copies > 100_000) {
    return { ok: false, error: "That is more books than have ever been printed." };
  }
  if (!reason) {
    return { ok: false, error: "Say why. A correction with no reason is one nobody can check." };
  }

  const { error } = await supabaseAdmin.from("stock_movements").insert({
    kind: input.kind,
    copies,
    reason,
    order_number: input.orderNumber?.trim() || null,
    actor_id: input.actorId ?? null,
    actor_email: input.actorEmail ?? null,
  });

  if (error) {
    console.error("[Inventory] movement write failed:", error.message);
    return { ok: false, error: "Could not save that. Has migration 0056 been applied?" };
  }

  revalidateInventory();
  return { ok: true };
}

export interface NewPrintRun {
  edition: number;
  copies: number;
  receivedOn: string;
  unitCostPaise?: number | null;
  printer?: string | null;
  note?: string | null;
  actorId?: string | null;
}

/**
 * Record a delivery from the printer.
 *
 * The moment books become stock, which is when they arrive rather than when
 * they were ordered — a run on the press is not something anyone can sell.
 */
export async function recordPrintRun(
  input: NewPrintRun
): Promise<{ ok: true } | { ok: false; error: string }> {
  const edition = Math.trunc(Number(input.edition));
  const copies = Math.trunc(Number(input.copies));

  if (!Number.isFinite(edition) || edition < 1) {
    return { ok: false, error: "Which edition is this?" };
  }
  if (!Number.isFinite(copies) || copies < 1) {
    return { ok: false, error: "How many copies arrived?" };
  }
  if (copies > 1_000_000) {
    return { ok: false, error: "That looks like a typo rather than a print run." };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.receivedOn ?? "")) {
    return { ok: false, error: "When did they arrive? Use a real date." };
  }

  const { error } = await supabaseAdmin.from("print_runs").insert({
    edition,
    copies,
    received_on: input.receivedOn,
    unit_cost_paise: input.unitCostPaise ?? null,
    printer: input.printer?.trim() || null,
    note: input.note?.trim() || null,
    created_by: input.actorId ?? null,
  });

  if (error) {
    console.error("[Inventory] print run write failed:", error.message);
    return { ok: false, error: "Could not save that. Has migration 0056 been applied?" };
  }

  revalidateInventory();
  return { ok: true };
}

// ── The warning, for screens that are not this one ──────────────────────────

export interface StockWarning {
  free: number;
  perDay: number;
  /** Days of cover, or null when it cannot be worked out. */
  days: number | null;
  /** Fewer days than this and the admin says so out loud. */
  low: boolean;
  /** More books sold than exist. */
  oversold: boolean;
}

/**
 * Below this many days of cover, the shop is told.
 *
 * Three weeks because that is roughly what a print run takes to arrive: a
 * warning that fires with less notice than the fix takes is not a warning, it
 * is a postmortem.
 */
export const LOW_STOCK_DAYS = 21;

/**
 * The one-line version, cached, for the sidebar and the dashboard.
 *
 * Cached rather than read per page because the view sums every paid order and
 * both of those surfaces render on every admin page view. Returns null when
 * 0056 has not been applied, and every caller renders nothing for null — an
 * admin panel must not grow a broken badge because a migration is pending.
 */
export const stockWarning = unstable_cache(
  async (): Promise<StockWarning | null> => {
    const [stock, rate] = await Promise.all([getBookStock(), salesRate(7)]);
    if (!stock) return null;

    const days = daysOfCover(stock.free, rate);
    return {
      free: stock.free,
      perDay: rate.perDay,
      days,
      low: days !== null && days < LOW_STOCK_DAYS,
      oversold: stock.free < 0,
    };
  },
  ["book-stock-warning"],
  { tags: [INVENTORY_TAG], revalidate: INVENTORY_CACHE_SECONDS }
);

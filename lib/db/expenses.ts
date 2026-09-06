import { supabaseAdmin } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/db/paginate";
import { istDayStartUTC, istDayEndUTC } from "@/lib/format-date";

/**
 * What the business spent, and who is owed for it.
 *
 * The counterpart to lib/db/economics.ts. That module models cost — one rate
 * per line, typed in, no dates, no payer — and every projection on
 * /admin/reports is built from it. This module records cost: an amount, a day,
 * a vendor, and the person whose money it actually was.
 *
 * Both are needed and neither replaces the other. A rate cannot tell you what
 * last month cost; a ledger cannot tell you what the next thousand books will
 * cost. The report holds them side by side, and the gap between them is the
 * most useful number on the page.
 *
 * ── The one definition ──
 *
 * `lib/db/sales-channel.ts` says of its own scope that it is "the only place
 * that decision is written down", and spend needs the same discipline. That
 * place is `EXPENSE_KINDS` and `countsAsOperatingCost` below. Three screens
 * will eventually total this data, and if each decides for itself whether a
 * printer purchase is part of last month's costs, they will disagree and the
 * report will stop being believed.
 */

// ── Kinds ────────────────────────────────────────────────────────────────────

export const EXPENSE_KINDS = ["variable", "fixed", "capital"] as const;
export type ExpenseKind = (typeof EXPENSE_KINDS)[number];

export function isExpenseKind(v: unknown): v is ExpenseKind {
  return typeof v === "string" && (EXPENSE_KINDS as readonly string[]).includes(v);
}

export const EXPENSE_KIND_LABELS: Record<ExpenseKind, string> = {
  variable: "Per book",
  fixed: "Monthly",
  capital: "One-off purchase",
};

export const EXPENSE_KIND_HINTS: Record<ExpenseKind, string> = {
  variable: "Scales with how many books go out — printing, packing, courier.",
  fixed: "Recurs whether or not a book sells — salary, servers, tools.",
  capital: "An asset bought once. Kept out of monthly cost on purpose.",
};

/**
 * Does this belong in "what did the month cost"?
 *
 * Capital does not, and this is the single place that is decided. A ₹60,000
 * printer bought in September is not a ₹60,000 September: counting it would
 * make that month read as a disaster and every later month read better than it
 * was, and the run rate derived from either would be wrong. It is reported on
 * its own line instead, which is the honest presentation of a one-off.
 */
export function countsAsOperatingCost(kind: string | null | undefined): boolean {
  return kind === "variable" || kind === "fixed";
}

// ── Shapes ───────────────────────────────────────────────────────────────────

export interface ExpenseCategory {
  id: string;
  name: string;
  kind: ExpenseKind;
  is_active: boolean;
  sort_order: number;
}

export interface Vendor {
  id: string;
  name: string;
  default_category_id: string | null;
  phone: string | null;
  is_active: boolean;
}

export interface Funder {
  id: string;
  name: string;
  is_company: boolean;
  upi_id: string | null;
  is_active: boolean;
  sort_order: number;
}

export interface FunderBalance extends Funder {
  funded_paise: number;
  settled_paise: number;
  /** What the company still owes. Always 0 for a company funder. */
  balance_paise: number;
  expense_count: number;
  last_spent_on: string | null;
}

export interface ExpenseRow {
  id: string;
  spent_on: string;
  category_id: string;
  vendor_id: string | null;
  funder_id: string;
  print_run_id: string | null;
  amount_paise: number;
  description: string;
  reference: string | null;
  receipt_url: string | null;
  units: number | null;
  notes: string | null;
  actor_email: string | null;
  created_at: string;
}

export interface ExpenseFilters {
  /** IST calendar dates, YYYY-MM-DD. `to` is inclusive. */
  from?: string;
  to?: string;
  category?: string;
  vendor?: string;
  funder?: string;
  kind?: string;
  q?: string;
}

/**
 * True when migration 0062 has not been applied.
 *
 * Migrations here are run by hand, so there is always a window where the code
 * is deployed and the tables are not. Every screen checks this and says so,
 * the way the inventory page names 0056 — an empty ledger and a missing table
 * look identical otherwise, and one of them is a five-second fix.
 */
function tableMissing(message: string | undefined): boolean {
  return !!message && /relation .* does not exist|schema cache/i.test(message);
}

export interface ExpenseSetup {
  ready: boolean;
  categories: ExpenseCategory[];
  vendors: Vendor[];
  funders: Funder[];
}

/** The three pickers every expense screen needs, in one trip. */
export async function getExpenseSetup(): Promise<ExpenseSetup> {
  const [cats, vends, funds] = await Promise.all([
    supabaseAdmin
      .from("expense_categories")
      .select("id,name,kind,is_active,sort_order")
      .order("sort_order", { ascending: true }),
    supabaseAdmin
      .from("vendors")
      .select("id,name,default_category_id,phone,is_active")
      .order("name", { ascending: true }),
    supabaseAdmin
      .from("funders")
      .select("id,name,is_company,upi_id,is_active,sort_order")
      .order("sort_order", { ascending: true }),
  ]);

  if (tableMissing(cats.error?.message)) {
    return { ready: false, categories: [], vendors: [], funders: [] };
  }

  return {
    ready: true,
    categories: (cats.data ?? []) as ExpenseCategory[],
    vendors: (vends.data ?? []) as Vendor[],
    funders: (funds.data ?? []) as Funder[],
  };
}

const COLUMNS =
  "id,spent_on,category_id,vendor_id,funder_id,print_run_id,amount_paise," +
  "description,reference,receipt_url,units,notes,actor_email,created_at";

/**
 * The ledger, filtered.
 *
 * `kind` is not a column on `expenses` — it lives on the category — so it is
 * resolved to a set of category ids first rather than through a join. One
 * extra round trip against a table of ten rows, in exchange for a query that
 * PostgREST can answer without an embedded resource.
 */
export async function listExpenses(
  f: ExpenseFilters = {}
): Promise<{ rows: ExpenseRow[]; ready: boolean }> {
  let categoryIds: string[] | null = null;

  if (f.kind && isExpenseKind(f.kind)) {
    const { data, error } = await supabaseAdmin
      .from("expense_categories")
      .select("id")
      .eq("kind", f.kind);
    if (tableMissing(error?.message)) return { rows: [], ready: false };
    categoryIds = ((data ?? []) as { id: string }[]).map((c) => c.id);
    // A kind with no categories matches nothing. Returning early avoids
    // sending `.in("category_id", [])`, which PostgREST treats as no filter at
    // all — the difference between "nothing" and "everything".
    if (!categoryIds.length) return { rows: [], ready: true };
  }

  const { rows, truncated } = await fetchAllRows<ExpenseRow>(
    (from, to) => {
      let q = supabaseAdmin.from("expenses").select(COLUMNS);

      if (f.from) q = q.gte("spent_on", f.from);
      if (f.to) q = q.lte("spent_on", f.to);
      if (f.category) q = q.eq("category_id", f.category);
      if (f.vendor) q = q.eq("vendor_id", f.vendor);
      if (f.funder) q = q.eq("funder_id", f.funder);
      if (categoryIds) q = q.in("category_id", categoryIds);
      if (f.q) {
        const needle = f.q.replace(/[%,()]/g, "");
        q = q.or(`description.ilike.%${needle}%,reference.ilike.%${needle}%`);
      }

      return q
        .order("spent_on", { ascending: false })
        .order("created_at", { ascending: false })
        .range(from, to) as never;
    },
    { label: "expenses" }
  );

  if (truncated) console.warn("[Expenses] the ledger read was truncated");
  return { rows, ready: true };
}

/** One row, for the edit screen. Null when it is gone or the table is missing. */
export async function getExpense(id: string): Promise<ExpenseRow | null> {
  const { data, error } = await supabaseAdmin
    .from("expenses")
    .select(COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    if (!tableMissing(error.message)) {
      console.error("[Expenses] read failed:", error.message);
    }
    return null;
  }
  return (data as unknown as ExpenseRow) ?? null;
}

export interface ExpenseTotals {
  /** Everything in range, capital included. */
  totalPaise: number;
  /** Only what belongs in a monthly cost — see countsAsOperatingCost. */
  operatingPaise: number;
  byKind: Record<ExpenseKind, number>;
  byCategory: { id: string; name: string; kind: ExpenseKind; paise: number }[];
  byFunder: { id: string; name: string; isCompany: boolean; paise: number }[];
  /** Books covered by variable spend that declared `units`. */
  unitsCovered: number;
  count: number;
}

/** Totals for a period, sliced every way the report needs. */
export async function expenseTotals(f: ExpenseFilters = {}): Promise<ExpenseTotals | null> {
  const setup = await getExpenseSetup();
  if (!setup.ready) return null;

  const { rows } = await listExpenses({ ...f, kind: undefined });

  const categoryById = new Map(setup.categories.map((c) => [c.id, c]));
  const funderById = new Map(setup.funders.map((x) => [x.id, x]));

  const byKind: Record<ExpenseKind, number> = { variable: 0, fixed: 0, capital: 0 };
  const catTotals = new Map<string, number>();
  const funderTotals = new Map<string, number>();
  let totalPaise = 0;
  let operatingPaise = 0;
  let unitsCovered = 0;

  for (const r of rows) {
    const cat = categoryById.get(r.category_id);
    const kind = (cat?.kind ?? "variable") as ExpenseKind;

    totalPaise += r.amount_paise;
    byKind[kind] += r.amount_paise;
    if (countsAsOperatingCost(kind)) operatingPaise += r.amount_paise;
    if (kind === "variable" && r.units) unitsCovered += r.units;

    catTotals.set(r.category_id, (catTotals.get(r.category_id) ?? 0) + r.amount_paise);
    funderTotals.set(r.funder_id, (funderTotals.get(r.funder_id) ?? 0) + r.amount_paise);
  }

  return {
    totalPaise,
    operatingPaise,
    byKind,
    byCategory: [...catTotals.entries()]
      .map(([id, paise]) => ({
        id,
        name: categoryById.get(id)?.name ?? "Unknown",
        kind: (categoryById.get(id)?.kind ?? "variable") as ExpenseKind,
        paise,
      }))
      .sort((a, b) => b.paise - a.paise),
    byFunder: [...funderTotals.entries()]
      .map(([id, paise]) => ({
        id,
        name: funderById.get(id)?.name ?? "Unknown",
        isCompany: !!funderById.get(id)?.is_company,
        paise,
      }))
      .sort((a, b) => b.paise - a.paise),
    unitsCovered,
    count: rows.length,
  };
}

/**
 * What the company owes each person.
 *
 * Read from the view rather than summed here, so the balance a screen shows
 * and the balance the settlement route checks against are the same expression
 * evaluated in the same place. Two implementations of "what do we owe Nizam"
 * is exactly one too many.
 */
export async function funderBalances(): Promise<FunderBalance[] | null> {
  const { data, error } = await supabaseAdmin
    .from("funder_balances")
    .select("*")
    .order("sort_order", { ascending: true });

  if (error) {
    if (tableMissing(error.message)) return null;
    console.error("[Expenses] balances failed:", error.message);
    return [];
  }
  return (data ?? []) as FunderBalance[];
}

export interface SettlementRow {
  id: string;
  funder_id: string;
  amount_paise: number;
  method: string | null;
  reference: string | null;
  receipt_url: string | null;
  note: string | null;
  paid_at: string;
}

export async function listSettlements(funderId?: string): Promise<SettlementRow[]> {
  let q = supabaseAdmin
    .from("funder_settlements")
    .select("id,funder_id,amount_paise,method,reference,receipt_url,note,paid_at")
    .order("paid_at", { ascending: false })
    .limit(200);
  if (funderId) q = q.eq("funder_id", funderId);

  const { data, error } = await q;
  if (error) {
    if (!tableMissing(error.message)) {
      console.error("[Expenses] settlements failed:", error.message);
    }
    return [];
  }
  return (data ?? []) as SettlementRow[];
}

// ── The join to profit ───────────────────────────────────────────────────────

export interface CostComparison {
  label: string;
  /** What business_costs predicts this should have cost over the period. */
  assumedPaise: number;
  /** What was actually spent. */
  actualPaise: number;
}

export interface ActualsVsAssumed {
  from: string;
  to: string;
  booksSold: number;
  /** Per-book lines: assumed rate × books sold, against real variable spend. */
  variable: CostComparison;
  /** Monthly lines: assumed monthly × months in range, against real fixed spend. */
  fixed: CostComparison;
  /** Never folded into either — see countsAsOperatingCost. */
  capitalPaise: number;
  /** Real spend that belongs in the period's cost. */
  operatingPaise: number;
  /**
   * A per-book printing cost derived from what was actually paid, or null when
   * no printing expense declared how many books it covered. Null rather than a
   * guess: a per-book figure computed over an unknown number of books is worse
   * than no figure.
   */
  actualPerBookPaise: number | null;
  months: number;
}

/**
 * Hold the assumptions against the ledger for one period.
 *
 * The assumed side has to be scaled to the period or the comparison is
 * meaningless — a per-book rate becomes a total by multiplying by books sold,
 * a monthly figure by multiplying by months elapsed. Both scalings are
 * approximations and are named as such on the screen.
 */
export async function actualsVsAssumed(
  from: string,
  to: string,
  assumed: {
    perBookVariablePaise: number;
    monthlyFixedPaise: number;
  },
  booksSold: number
): Promise<ActualsVsAssumed | null> {
  const totals = await expenseTotals({ from, to });
  if (!totals) return null;

  const days =
    (Date.parse(istDayEndUTC(to)) - Date.parse(istDayStartUTC(from))) / 864e5;
  // 30.44, matching DAYS_PER_MONTH in lib/db/economics.ts. A different divisor
  // here would make the two halves of the same comparison disagree.
  const months = Math.max(days / 30.44, 0.01);

  const printing = totals.byCategory.find((c) => c.name === "Printing");

  return {
    from,
    to,
    booksSold,
    variable: {
      label: "Per-book costs",
      assumedPaise: Math.round(assumed.perBookVariablePaise * booksSold),
      actualPaise: totals.byKind.variable,
    },
    fixed: {
      label: "Monthly costs",
      assumedPaise: Math.round(assumed.monthlyFixedPaise * months),
      actualPaise: totals.byKind.fixed,
    },
    capitalPaise: totals.byKind.capital,
    operatingPaise: totals.operatingPaise,
    actualPerBookPaise:
      printing && totals.unitsCovered > 0
        ? Math.round(printing.paise / totals.unitsCovered)
        : null,
    months,
  };
}

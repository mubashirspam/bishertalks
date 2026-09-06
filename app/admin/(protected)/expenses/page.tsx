import { Suspense } from "react";
import Link from "@/components/admin/AdminLink";
import { Receipt, Plus, Users, Paperclip, AlertCircle } from "lucide-react";
import { requirePageAccess } from "@/lib/admin-auth";
import { can } from "@/lib/permissions";
import { SkeletonStats, SkeletonTable } from "@/components/admin/Skeleton";
import { NavigationPending, StaleWhileRevalidating } from "@/components/admin/Revalidating";
import { formatISTDate, istToday } from "@/lib/format-date";
import {
  getExpenseSetup,
  listExpenses,
  expenseTotals,
  EXPENSE_KIND_LABELS,
  type ExpenseKind,
} from "@/lib/db/expenses";
import ExpenseFilters from "./ExpenseFilters";

export const dynamic = "force-dynamic";

const rupees = (paise: number) => Math.round(paise / 100).toLocaleString("en-IN");

/**
 * Everything the business has spent.
 *
 * The counterpart to /admin/reports, which models what a book *should* cost.
 * This is what was actually paid, to whom, and out of whose pocket.
 */
export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const staff = await requirePageAccess("expenses.view");
  const params = await searchParams;

  return (
    <NavigationPending>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-black">
            <Receipt className="h-5 w-5 text-primary-500" /> Expenses
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            What the business spent, and who fronted the money for it.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/admin/expenses/funders"
            className="inline-flex items-center gap-1.5 rounded-xl border border-neutral-200 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 hover:border-neutral-300"
          >
            <Users className="h-4 w-4" /> Who is owed
          </Link>
          {can(staff, "expenses.edit") && (
            <Link
              href="/admin/expenses/new"
              className="inline-flex items-center gap-1.5 rounded-xl bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800"
            >
              <Plus className="h-4 w-4" /> Add expense
            </Link>
          )}
        </div>
      </div>

      <Suspense fallback={<><SkeletonStats count={4} /><SkeletonTable rows={8} columns={6} /></>}>
        <Body params={params} canEdit={can(staff, "expenses.edit")} />
      </Suspense>
    </NavigationPending>
  );
}

async function Body({
  params,
  canEdit,
}: {
  params: Record<string, string | undefined>;
  canEdit: boolean;
}) {
  const setup = await getExpenseSetup();

  // Deployed before the migration was applied. Says so, rather than rendering
  // an empty ledger that looks like a shop which has never spent anything —
  // the same courtesy the inventory page pays for 0056.
  if (!setup.ready) {
    return (
      <div className="rounded-2xl border border-amber-300 bg-amber-50 px-5 py-4 text-sm text-amber-900">
        <p className="flex items-center gap-2 font-semibold">
          <AlertCircle className="h-4 w-4" /> Not set up yet
        </p>
        <p className="mt-1.5">
          Apply <span className="font-mono">supabase/migrations/0062_expenses.sql</span> in
          the Supabase SQL editor, then reload. Migrations here are run by hand.
        </p>
      </div>
    );
  }

  const filters = {
    from: params.from,
    to: params.to,
    category: params.category,
    vendor: params.vendor,
    funder: params.funder,
    kind: params.kind,
    q: params.q,
  };

  const [{ rows }, totals] = await Promise.all([
    listExpenses(filters),
    expenseTotals(filters),
  ]);

  const categoryById = new Map(setup.categories.map((c) => [c.id, c]));
  const vendorById = new Map(setup.vendors.map((v) => [v.id, v]));
  const funderById = new Map(setup.funders.map((f) => [f.id, f]));

  const kindTone: Record<ExpenseKind, string> = {
    variable: "bg-blue-50 text-blue-700 border-blue-200",
    fixed: "bg-purple-50 text-purple-700 border-purple-200",
    capital: "bg-amber-50 text-amber-800 border-amber-200",
  };

  return (
    <>
      <ExpenseFilters
        categories={setup.categories.map((c) => ({ id: c.id, name: c.name }))}
        vendors={setup.vendors.map((v) => ({ id: v.id, name: v.name }))}
        funders={setup.funders.map((f) => ({ id: f.id, name: f.name }))}
        today={istToday()}
        totalSlot={
          totals ? (
            <span>
              <strong className="tabular-nums text-neutral-900">{totals.count}</strong>{" "}
              {totals.count === 1 ? "expense" : "expenses"} ·{" "}
              <strong className="tabular-nums text-neutral-900">
                ₹{rupees(totals.totalPaise)}
              </strong>
            </span>
          ) : null
        }
      />

      <StaleWhileRevalidating>
        {totals && (
          <div className="mb-5 grid gap-3 sm:grid-cols-4">
            <Tile
              label="Total in range" value={`₹${rupees(totals.totalPaise)}`}
              sub={`${totals.count} ${totals.count === 1 ? "entry" : "entries"}`}
              strong
            />
            <Tile
              label="Per book" value={`₹${rupees(totals.byKind.variable)}`}
              sub={
                totals.unitsCovered > 0
                  ? `covers ${totals.unitsCovered.toLocaleString("en-IN")} books`
                  : "printing, packing, courier"
              }
            />
            <Tile
              label="Monthly" value={`₹${rupees(totals.byKind.fixed)}`}
              sub="salary, servers, tools"
            />
            <Tile
              label="One-off purchases" value={`₹${rupees(totals.byKind.capital)}`}
              sub="kept out of monthly cost"
            />
          </div>
        )}

        <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Date</th>
                  <th className="px-4 py-3 font-semibold">What</th>
                  <th className="px-4 py-3 font-semibold">Category</th>
                  <th className="hidden px-4 py-3 font-semibold md:table-cell">Vendor</th>
                  <th className="px-4 py-3 font-semibold">Paid by</th>
                  <th className="px-4 py-3 text-right font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {!rows.length ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-neutral-400">
                      Nothing recorded for these filters.
                      {canEdit && (
                        <>
                          {" "}
                          <Link href="/admin/expenses/new" className="underline">
                            Add the first one
                          </Link>
                          .
                        </>
                      )}
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => {
                    const cat = categoryById.get(r.category_id);
                    const kind = (cat?.kind ?? "variable") as ExpenseKind;
                    const funder = funderById.get(r.funder_id);
                    return (
                      <tr key={r.id} className="hover:bg-neutral-50">
                        <td className="whitespace-nowrap px-4 py-3 tabular-nums text-neutral-600">
                          {formatISTDate(r.spent_on)}
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-neutral-900">{r.description}</p>
                          <p className="mt-0.5 flex items-center gap-2 text-xs text-neutral-400">
                            {r.reference && <span className="font-mono">{r.reference}</span>}
                            {r.units ? <span>{r.units.toLocaleString("en-IN")} books</span> : null}
                            {r.receipt_url && (
                              <a
                                href={r.receipt_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-primary-600 hover:underline"
                              >
                                <Paperclip className="h-3 w-3" /> receipt
                              </a>
                            )}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-neutral-700">{cat?.name ?? "—"}</span>
                          <span
                            className={`ml-1.5 inline-flex rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${kindTone[kind]}`}
                          >
                            {EXPENSE_KIND_LABELS[kind]}
                          </span>
                        </td>
                        <td className="hidden px-4 py-3 text-neutral-600 md:table-cell">
                          {r.vendor_id ? vendorById.get(r.vendor_id)?.name ?? "—" : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-neutral-700">{funder?.name ?? "—"}</span>
                          {funder && !funder.is_company && (
                            <span className="ml-1.5 inline-flex rounded-full border border-orange-200 bg-orange-50 px-1.5 py-0.5 text-[10px] font-semibold text-orange-700">
                              owed
                            </span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-neutral-900">
                          ₹{rupees(r.amount_paise)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {totals && totals.byCategory.length > 0 && (
          <div className="mt-5 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-bold text-neutral-800">By category</h2>
            <div className="space-y-2">
              {totals.byCategory.map((c) => (
                <div key={c.id} className="flex items-center gap-3">
                  <span className="w-44 shrink-0 truncate text-sm text-neutral-700">
                    {c.name}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-100">
                    <div
                      className="h-full rounded-full bg-primary-500"
                      style={{ width: `${(c.paise / totals.totalPaise) * 100}%` }}
                    />
                  </div>
                  <span className="w-24 shrink-0 text-right text-sm font-semibold tabular-nums text-neutral-900">
                    ₹{rupees(c.paise)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </StaleWhileRevalidating>
    </>
  );
}

function Tile({
  label, value, sub, strong,
}: {
  label: string; value: string; sub: string; strong?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 shadow-sm ${
        strong ? "border-neutral-300 bg-neutral-900 text-white" : "border-neutral-200 bg-white"
      }`}
    >
      <p className={`text-xs font-medium ${strong ? "text-neutral-300" : "text-neutral-500"}`}>
        {label}
      </p>
      <p className={`mt-1 text-xl font-black tabular-nums ${strong ? "text-white" : "text-neutral-900"}`}>
        {value}
      </p>
      <p className={`mt-0.5 text-xs ${strong ? "text-neutral-400" : "text-neutral-400"}`}>{sub}</p>
    </div>
  );
}

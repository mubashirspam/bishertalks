import Link from "@/components/admin/AdminLink";
import { ArrowLeft, AlertCircle } from "lucide-react";
import { requirePageAccess } from "@/lib/admin-auth";
import { can } from "@/lib/permissions";
import { formatISTDate } from "@/lib/format-date";
import { funderBalances, listSettlements } from "@/lib/db/expenses";
import FunderCards, { type FunderCard } from "./FunderCards";

export const dynamic = "force-dynamic";

const rupees = (paise: number) => Math.round(paise / 100).toLocaleString("en-IN");

/**
 * Who put money in, and what is still owed back.
 *
 * The screen this whole feature exists for. Everything else records spending;
 * this answers the question that otherwise lives in somebody's memory.
 */
export default async function FundersPage() {
  const staff = await requirePageAccess("expenses.view");
  const [balances, settlements] = await Promise.all([
    funderBalances(),
    listSettlements(),
  ]);

  if (balances === null) {
    return (
      <div className="max-w-3xl rounded-2xl border border-amber-300 bg-amber-50 px-5 py-4 text-sm text-amber-900">
        <p className="flex items-center gap-2 font-semibold">
          <AlertCircle className="h-4 w-4" /> Not set up yet
        </p>
        <p className="mt-1.5">
          Apply <span className="font-mono">supabase/migrations/0062_expenses.sql</span> first.
        </p>
      </div>
    );
  }

  const cards: FunderCard[] = balances.map((f) => ({
    id: f.id,
    name: f.name,
    isCompany: f.is_company,
    fundedPaise: f.funded_paise,
    settledPaise: f.settled_paise,
    balancePaise: f.balance_paise,
    expenseCount: f.expense_count,
    lastSpentOn: f.last_spent_on ? formatISTDate(f.last_spent_on) : null,
    upiId: f.upi_id,
  }));

  const nameById = new Map(balances.map((f) => [f.id, f.name]));

  return (
    <div className="max-w-5xl">
      <Link
        href="/admin/expenses"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-900"
      >
        <ArrowLeft className="h-4 w-4" /> Expenses
      </Link>

      <div className="mb-6">
        <h1 className="text-2xl font-black">Who is owed</h1>
        <p className="mt-1.5 max-w-prose text-sm text-neutral-500">
          Every expense records whose money paid for it. What somebody funded and
          has not been repaid is what the company owes them — worked out from the
          ledger each time this page loads, never stored.
        </p>
      </div>

      <FunderCards funders={cards} canEdit={can(staff, "expenses.edit")} />

      {settlements.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 text-sm font-bold text-neutral-800">Repayments made</h2>
          <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
                  <tr>
                    <th className="px-4 py-3 font-semibold">When</th>
                    <th className="px-4 py-3 font-semibold">To</th>
                    <th className="px-4 py-3 font-semibold">How</th>
                    <th className="hidden px-4 py-3 font-semibold md:table-cell">Reference</th>
                    <th className="px-4 py-3 text-right font-semibold">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {settlements.map((s) => (
                    <tr key={s.id} className="hover:bg-neutral-50">
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums text-neutral-600">
                        {formatISTDate(s.paid_at)}
                      </td>
                      <td className="px-4 py-3 font-medium text-neutral-900">
                        {nameById.get(s.funder_id) ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-neutral-600">{s.method ?? "—"}</td>
                      <td className="hidden px-4 py-3 font-mono text-xs text-neutral-500 md:table-cell">
                        {s.reference ?? "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-neutral-900">
                        ₹{rupees(s.amount_paise)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

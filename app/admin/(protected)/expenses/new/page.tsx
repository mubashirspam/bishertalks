import Link from "@/components/admin/AdminLink";
import { ArrowLeft, AlertCircle } from "lucide-react";
import { requirePageAccess } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { istToday } from "@/lib/format-date";
import { getExpenseSetup } from "@/lib/db/expenses";
import ExpenseForm, { type PrintRunOption } from "./ExpenseForm";

export const dynamic = "force-dynamic";

/**
 * Record one payment.
 *
 * `expenses.edit`, not `expenses.view`: this writes a row that decides what the
 * company owes a named person, which is a long way from being allowed to read
 * the ledger.
 */
export default async function NewExpensePage() {
  await requirePageAccess("expenses.edit");

  const setup = await getExpenseSetup();

  if (!setup.ready) {
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

  // Offered only on a printing expense, so an invoice can be tied to the run it
  // paid for rather than becoming a second, disagreeing record of it.
  const { data: runs } = await supabaseAdmin
    .from("print_runs")
    .select("id,edition,copies,received_on")
    .order("received_on", { ascending: false })
    .limit(20);

  const printRuns: PrintRunOption[] = (
    (runs ?? []) as { id: string; edition: number; copies: number; received_on: string }[]
  ).map((r) => ({
    id: r.id,
    label: `Edition ${r.edition} · ${r.copies.toLocaleString("en-IN")} copies · ${r.received_on}`,
  }));

  return (
    <div className="max-w-3xl">
      <Link
        href="/admin/expenses"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-900"
      >
        <ArrowLeft className="h-4 w-4" /> Expenses
      </Link>

      <div className="mb-6">
        <h1 className="text-2xl font-black">Add an expense</h1>
        <p className="mt-1.5 max-w-prose text-sm text-neutral-500">
          One payment: what it was for, what it cost, and whose money it was. If
          somebody other than the company paid, this is what creates the balance
          owed back to them.
        </p>
      </div>

      <ExpenseForm
        categories={setup.categories
          .filter((c) => c.is_active)
          .map((c) => ({ id: c.id, name: c.name, kind: c.kind }))}
        vendors={setup.vendors
          .filter((v) => v.is_active)
          .map((v) => ({ id: v.id, name: v.name }))}
        funders={setup.funders
          .filter((f) => f.is_active)
          .map((f) => ({ id: f.id, name: f.name, isCompany: f.is_company }))}
        printRuns={printRuns}
        today={istToday()}
      />
    </div>
  );
}

import { notFound } from "next/navigation";
import Link from "@/components/admin/AdminLink";
import { ArrowLeft, AlertCircle } from "lucide-react";
import { requirePageAccess } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { istToday, formatISTDate } from "@/lib/format-date";
import { getExpenseSetup, getExpense } from "@/lib/db/expenses";
import ExpenseForm, { type PrintRunOption } from "../../ExpenseForm";
import DeleteExpense from "./DeleteExpense";

export const dynamic = "force-dynamic";

/**
 * Correcting one expense.
 *
 * The field this exists for is "who paid". It is three names in a dropdown
 * with one of them selected by default, which makes it the easiest thing on
 * the form to get wrong and the most expensive to leave wrong — a misfiled
 * expense overstates one person's balance and understates another's, and the
 * company settles real money against those numbers.
 *
 * Nothing needs repairing afterwards. `funder_balances` derives from the
 * ledger on every read, so saving a corrected payer moves both balances at
 * once.
 */
export default async function EditExpensePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePageAccess("expenses.edit");
  const { id } = await params;

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

  const expense = await getExpense(id);
  if (!expense) notFound();

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
        <h1 className="text-2xl font-black">Edit expense</h1>
        <p className="mt-1.5 text-sm text-neutral-500">
          Recorded {formatISTDate(expense.created_at)}
          {expense.actor_email ? ` by ${expense.actor_email}` : ""}. Changing who
          paid moves both balances as soon as you save.
        </p>
      </div>

      <ExpenseForm
        categories={setup.categories
          .filter((c) => c.is_active || c.id === expense.category_id)
          .map((c) => ({ id: c.id, name: c.name, kind: c.kind }))}
        vendors={setup.vendors
          .filter((v) => v.is_active || v.id === expense.vendor_id)
          .map((v) => ({ id: v.id, name: v.name }))}
        funders={setup.funders
          // A funder switched off since this was recorded still has to appear,
          // or saving anything else on the row would silently reassign it.
          .filter((f) => f.is_active || f.id === expense.funder_id)
          .map((f) => ({ id: f.id, name: f.name, isCompany: f.is_company }))}
        printRuns={printRuns}
        today={istToday()}
        initial={expense}
      />

      <div className="mt-8 border-t border-neutral-200 pt-5">
        <DeleteExpense id={expense.id} />
      </div>
    </div>
  );
}

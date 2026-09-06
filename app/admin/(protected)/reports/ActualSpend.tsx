import Link from "@/components/admin/AdminLink";
import { ArrowRight, Receipt } from "lucide-react";
import type { ActualsVsAssumed } from "@/lib/db/expenses";

/**
 * What the month was assumed to cost, against what was actually paid.
 *
 * Everything else on this page is a model built from figures somebody typed
 * into the editor below. This is the only block on it made of real
 * transactions, and its whole job is to show where the model is wrong.
 *
 * The two sides are not directly comparable until the assumed side is scaled
 * to the period, and both scalings are approximations that the reader has to
 * be able to see:
 *
 *   per-book   the assumed rate × books sold in the range
 *   monthly    the assumed monthly figure × months in the range
 *
 * Said out loud under each row, because a comparison whose arithmetic is
 * hidden invites the reader to trust a gap that might just be a short month.
 */

const rupees = (paise: number) => Math.round(paise / 100).toLocaleString("en-IN");

function Gap({ assumed, actual }: { assumed: number; actual: number }) {
  const diff = actual - assumed;
  if (assumed === 0 && actual === 0) {
    return <span className="text-neutral-400">—</span>;
  }
  if (assumed === 0) {
    return <span className="text-neutral-500">no assumption set</span>;
  }
  const pct = Math.round((diff / assumed) * 100);
  const over = diff > 0;
  return (
    <span className={over ? "text-red-700" : "text-green-700"}>
      {over ? "+" : "−"}₹{rupees(Math.abs(diff))}
      <span className="ml-1 text-xs opacity-70">
        ({over ? "+" : ""}{pct}%)
      </span>
    </span>
  );
}

export default function ActualSpend({
  actuals,
  revenuePaise,
  directSalesPaise,
}: {
  /** Null when migration 0062 has not been applied. */
  actuals: ActualsVsAssumed | null;
  /** Online revenue for the same range, net of refunds. */
  revenuePaise: number;
  /** Direct sales in the range, reported apart — see lib/db/sales-channel.ts. */
  directSalesPaise: number;
}) {
  if (!actuals) {
    return (
      <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
        <h2 className="flex items-center gap-2 text-sm font-bold text-neutral-800">
          <Receipt className="h-4 w-4 text-primary-500" /> Actual spend
        </h2>
        <p className="mt-2 max-w-prose text-sm text-neutral-500">
          Every figure on this page is a model. To see what the business really
          spent — and who is owed for it — apply{" "}
          <span className="font-mono text-xs">
            supabase/migrations/0062_expenses.sql
          </span>{" "}
          and start recording expenses.
        </p>
      </section>
    );
  }

  const profitPaise = revenuePaise - actuals.operatingPaise;

  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-bold text-neutral-800">
          <Receipt className="h-4 w-4 text-primary-500" /> Actual spend
        </h2>
        <Link
          href="/admin/expenses"
          className="group inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-900"
        >
          Open the ledger
          <ArrowRight className="h-3 w-3 transition group-hover:translate-x-0.5" />
        </Link>
      </div>
      <p className="mb-4 text-xs text-neutral-500">
        {actuals.from} to {actuals.to} · {actuals.booksSold.toLocaleString("en-IN")} books
        sold · {actuals.months.toFixed(1)} months
      </p>

      {/* ── The real P&L ──────────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3.5">
          <p className="text-[11px] font-medium text-neutral-500">Revenue</p>
          <p className="mt-1 text-lg font-black tabular-nums text-neutral-900">
            ₹{rupees(revenuePaise)}
          </p>
          <p className="mt-0.5 text-[11px] text-neutral-400">online, net of refunds</p>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3.5">
          <p className="text-[11px] font-medium text-neutral-500">Spent</p>
          <p className="mt-1 text-lg font-black tabular-nums text-neutral-900">
            ₹{rupees(actuals.operatingPaise)}
          </p>
          <p className="mt-0.5 text-[11px] text-neutral-400">
            excludes ₹{rupees(actuals.capitalPaise)} one-off
          </p>
        </div>
        <div
          className={`rounded-xl border p-3.5 ${
            profitPaise >= 0
              ? "border-green-200 bg-green-50"
              : "border-red-200 bg-red-50"
          }`}
        >
          <p className="text-[11px] font-medium text-neutral-600">Real profit</p>
          <p
            className={`mt-1 text-lg font-black tabular-nums ${
              profitPaise >= 0 ? "text-green-800" : "text-red-800"
            }`}
          >
            ₹{rupees(profitPaise)}
          </p>
          <p className="mt-0.5 text-[11px] text-neutral-500">revenue − spend</p>
        </div>
      </div>

      {/* ── Where the model is wrong ──────────────────────────────────── */}
      <div className="mt-5 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="py-2 font-semibold">Cost line</th>
              <th className="py-2 text-right font-semibold">Assumed</th>
              <th className="py-2 text-right font-semibold">Actual</th>
              <th className="py-2 text-right font-semibold">Difference</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {[actuals.variable, actuals.fixed].map((row, i) => (
              <tr key={row.label}>
                <td className="py-2.5">
                  <p className="font-medium text-neutral-900">{row.label}</p>
                  <p className="text-[11px] text-neutral-400">
                    {i === 0
                      ? "assumed rate × books sold"
                      : "assumed monthly × months in range"}
                  </p>
                </td>
                <td className="py-2.5 text-right tabular-nums text-neutral-600">
                  ₹{rupees(row.assumedPaise)}
                </td>
                <td className="py-2.5 text-right font-semibold tabular-nums text-neutral-900">
                  ₹{rupees(row.actualPaise)}
                </td>
                <td className="py-2.5 text-right font-semibold tabular-nums">
                  <Gap assumed={row.assumedPaise} actual={row.actualPaise} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 space-y-1.5 border-t border-neutral-100 pt-3 text-xs text-neutral-500">
        {actuals.actualPerBookPaise !== null && (
          <p>
            Printing worked out at{" "}
            <strong className="text-neutral-900">
              ₹{rupees(actuals.actualPerBookPaise)}
            </strong>{" "}
            a book across the invoices that said how many books they covered.
          </p>
        )}
        {actuals.capitalPaise > 0 && (
          <p>
            ₹{rupees(actuals.capitalPaise)} of one-off purchases is deliberately
            outside the figures above — a printer bought once is not a monthly cost.
          </p>
        )}
        {directSalesPaise > 0 && (
          <p>
            Direct sales added ₹{rupees(directSalesPaise)} in this range. Kept out of
            the revenue figure above, as everywhere else, because that number is
            reconciled against Razorpay.
          </p>
        )}
      </div>
    </section>
  );
}

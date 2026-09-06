"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, AlertCircle, Building2, Check } from "lucide-react";

/**
 * What the company owes each person, and the box that pays them back.
 *
 * The balance shown here is never stored — it is
 * `funded - settled`, computed by the `funder_balances` view every time it is
 * read. A stored balance is a number that can quietly disagree with the rows
 * underneath it, and the first time it does, a conversation about who is owed
 * what becomes unresolvable.
 *
 * The repayment amount is typed rather than derived, because a partial
 * repayment is an ordinary thing and no server-side figure means "what was
 * paid today". The route refuses anything above the outstanding balance, which
 * is the one direction that would invent money the company never owed.
 */

export interface FunderCard {
  id: string;
  name: string;
  isCompany: boolean;
  fundedPaise: number;
  settledPaise: number;
  balancePaise: number;
  expenseCount: number;
  lastSpentOn: string | null;
  upiId: string | null;
}

const rupees = (paise: number) => Math.round(paise / 100).toLocaleString("en-IN");

export default function FunderCards({
  funders,
  canEdit,
}: {
  funders: FunderCard[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [method, setMethod] = useState("upi");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function repay(funderId: string) {
    setBusy(true);
    setError(null);

    try {
      const res = await fetch("/api/admin/expenses/settlement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          funder_id: funderId,
          amount_rupees: amount,
          method,
          reference,
        }),
      });
      const json = await res.json();

      if (!res.ok) {
        setError(json.error ?? "That did not work.");
        setBusy(false);
        return;
      }
      setDone(funderId);
      setOpenFor(null);
      setAmount("");
      setReference("");
      setBusy(false);
      router.refresh();
    } catch {
      setError("Could not reach the server.");
      setBusy(false);
    }
  }

  const owed = funders.filter((f) => !f.isCompany);
  const totalOwed = owed.reduce((n, f) => n + f.balancePaise, 0);

  return (
    <>
      <div className="mb-5 rounded-2xl border border-neutral-200 bg-neutral-900 p-5 text-white shadow-sm">
        <p className="text-xs font-medium text-neutral-300">Owed right now</p>
        <p className="mt-1 text-3xl font-black tabular-nums">₹{rupees(totalOwed)}</p>
        <p className="mt-1 text-xs text-neutral-400">
          Across {owed.length} {owed.length === 1 ? "person" : "people"} who have funded
          purchases and not yet been repaid in full.
        </p>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2.5 rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {funders.map((f) => (
          <div
            key={f.id}
            className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 font-semibold text-neutral-900">
                  {f.name}
                  {f.isCompany && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-neutral-50 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-500">
                      <Building2 className="h-2.5 w-2.5" /> company
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-xs text-neutral-400">
                  {f.expenseCount} {f.expenseCount === 1 ? "expense" : "expenses"}
                  {f.lastSpentOn ? ` · last ${f.lastSpentOn}` : ""}
                </p>
              </div>
              {done === f.id && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-semibold text-green-700">
                  <Check className="h-3 w-3" /> recorded
                </span>
              )}
            </div>

            <div className="mt-4 grid grid-cols-3 gap-3 border-t border-neutral-100 pt-4 text-center">
              <div>
                <p className="text-[11px] text-neutral-400">Funded</p>
                <p className="mt-0.5 text-sm font-semibold tabular-nums text-neutral-900">
                  ₹{rupees(f.fundedPaise)}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-neutral-400">Repaid</p>
                <p className="mt-0.5 text-sm font-semibold tabular-nums text-neutral-600">
                  ₹{rupees(f.settledPaise)}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-neutral-400">Still owed</p>
                <p
                  className={`mt-0.5 text-sm font-black tabular-nums ${
                    f.balancePaise > 0 ? "text-orange-700" : "text-neutral-400"
                  }`}
                >
                  {f.isCompany ? "—" : `₹${rupees(f.balancePaise)}`}
                </p>
              </div>
            </div>

            {/* The company is not repaid, so it is not offered a repayment box. */}
            {canEdit && !f.isCompany && f.balancePaise > 0 && (
              <div className="mt-4 border-t border-neutral-100 pt-4">
                {openFor === f.id ? (
                  <div className="space-y-2.5">
                    <div className="flex gap-2">
                      <input
                        type="number" min="1" step="1" value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder={`Up to ${Math.round(f.balancePaise / 100)}`}
                        className="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm focus:border-primary-400 focus:outline-none"
                      />
                      <select
                        value={method}
                        onChange={(e) => setMethod(e.target.value)}
                        className="rounded-xl border border-neutral-200 px-2 py-2 text-sm"
                      >
                        <option value="upi">UPI</option>
                        <option value="bank">Bank</option>
                        <option value="cash">Cash</option>
                      </select>
                    </div>
                    <input
                      value={reference}
                      onChange={(e) => setReference(e.target.value)}
                      placeholder="Transfer reference (worth recording)"
                      className="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm focus:border-primary-400 focus:outline-none"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => repay(f.id)}
                        disabled={busy || !amount}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-neutral-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                      >
                        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        Record repayment
                      </button>
                      <button
                        onClick={() => { setOpenFor(null); setError(null); }}
                        className="rounded-xl px-3 py-2 text-sm text-neutral-500 hover:text-neutral-900"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => { setOpenFor(f.id); setDone(null); setError(null); }}
                    className="text-sm font-semibold text-primary-600 hover:underline"
                  >
                    Record a repayment to {f.name}
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

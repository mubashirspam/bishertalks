"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, AlertCircle } from "lucide-react";
import MediaUpload from "@/components/admin/MediaUpload";
import { IMAGEKIT_FOLDERS } from "@/lib/imagekit";
import { EXPENSE_KIND_HINTS, type ExpenseKind } from "@/lib/db/expenses";

/**
 * Recording one payment.
 *
 * The form changes shape with the category, and that is the point rather than
 * a flourish: "how many books does this cover" is a real question about a
 * printing invoice and a meaningless one about a server bill. Asking it always
 * would train people to ignore it, and a field people ignore is a field that
 * eventually gets filled in wrongly.
 *
 * Amounts are typed in RUPEES. Every money column in this database is paise
 * and the route converts — but a person copying ₹40,000 off an invoice into a
 * box labelled paise is a hundredfold error waiting to happen, in the one
 * table that decides what the company owes somebody.
 *
 * ── Editing ──
 *
 * The same form, given `initial`, becomes an edit. It has to exist: the field
 * most worth correcting is who paid, and that is also the easiest to pick
 * wrongly — three names in a dropdown, one of them selected by default. An
 * expense filed against the wrong person overstates one balance and understates
 * another, and the company settles real money against those numbers.
 *
 * Correcting it needs no repair pass, because balances are derived rather than
 * stored: `funder_balances` recomputes from the ledger on every read, so
 * changing the payer here moves both balances the moment it saves.
 */

const LABEL = "text-xs font-medium text-neutral-500 mb-1.5 block";
const INPUT =
  "w-full text-sm border border-neutral-200 rounded-xl px-3 py-2 bg-white " +
  "focus:outline-none focus:ring-2 focus:ring-primary-500/40 focus:border-primary-400";

export interface Option { id: string; name: string }
export interface CategoryOption extends Option { kind: ExpenseKind }
export interface FunderOption extends Option { isCompany: boolean }
export interface PrintRunOption { id: string; label: string }

/** An existing row, when this form is editing rather than creating. */
export interface InitialExpense {
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
}

export default function ExpenseForm({
  categories,
  vendors,
  funders,
  printRuns,
  today,
  initial,
}: {
  categories: CategoryOption[];
  vendors: Option[];
  funders: FunderOption[];
  printRuns: PrintRunOption[];
  /** Today in IST, from the server — the shop's date, not the browser's. */
  today: string;
  /** Present when correcting an existing row. */
  initial?: InitialExpense;
}) {
  const router = useRouter();
  const editing = !!initial;

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receiptUrl, setReceiptUrl] = useState<string | null>(
    initial?.receipt_url ?? null
  );

  const [categoryId, setCategoryId] = useState(
    initial?.category_id ?? categories[0]?.id ?? ""
  );
  const [funderId, setFunderId] = useState(
    initial?.funder_id ?? funders[0]?.id ?? ""
  );

  const category = useMemo(
    () => categories.find((c) => c.id === categoryId),
    [categories, categoryId]
  );
  const funder = useMemo(
    () => funders.find((f) => f.id === funderId),
    [funders, funderId]
  );

  const isVariable = category?.kind === "variable";
  const isPrinting = category?.name === "Printing";

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const fd = new FormData(e.currentTarget);
    const body = Object.fromEntries(fd.entries());

    try {
      const res = await fetch("/api/admin/expenses", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...body,
          id: initial?.id,
          receipt_url: receiptUrl,
        }),
      });
      const json = await res.json();

      if (!res.ok) {
        setError(json.error ?? "Could not save it.");
        setSaving(false);
        return;
      }
      router.push("/admin/expenses");
      router.refresh();
    } catch {
      setError("Could not reach the server. Nothing was saved.");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      {error && (
        <div className="flex items-start gap-2.5 rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold">What was bought</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={LABEL}>Date spent</label>
            <input
              name="spent_on" type="date" required
              defaultValue={initial?.spent_on ?? today} className={INPUT}
            />
          </div>
          <div>
            <label className={LABEL}>Amount (₹)</label>
            <input
              name="amount_rupees" type="number" min="1" step="1" required
              defaultValue={initial ? Math.round(initial.amount_paise) / 100 : undefined}
              className={INPUT} placeholder="40000"
            />
          </div>

          <div className="sm:col-span-2">
            <label className={LABEL}>Description</label>
            <input
              name="description" required defaultValue={initial?.description}
              className={INPUT} placeholder="What this payment was for"
            />
          </div>

          <div>
            <label className={LABEL}>Category</label>
            <select
              name="category_id" required value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className={INPUT}
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {category && (
              <p className="mt-1 text-[11px] text-neutral-400">
                {EXPENSE_KIND_HINTS[category.kind]}
              </p>
            )}
          </div>

          <div>
            <label className={LABEL}>Vendor (optional)</label>
            <select name="vendor_id" defaultValue={initial?.vendor_id ?? ""} className={INPUT}>
              <option value="">Not recorded</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
          </div>

          {/* Only where the cost actually scales with books. */}
          {isVariable && (
            <div>
              <label className={LABEL}>Books this covers (optional)</label>
              <input
                name="units" type="number" min="1" step="1"
                defaultValue={initial?.units ?? undefined}
                className={INPUT} placeholder="2000"
              />
              <p className="mt-1 text-[11px] text-neutral-400">
                Lets the report work out a real per-book cost.
              </p>
            </div>
          )}

          {isPrinting && printRuns.length > 0 && (
            <div>
              <label className={LABEL}>Print run (optional)</label>
              <select name="print_run_id" defaultValue={initial?.print_run_id ?? ""} className={INPUT}>
                <option value="">Not linked</option>
                {printRuns.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-neutral-400">
                Ties this invoice to the run it paid for.
              </p>
            </div>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
        <h2 className="mb-1 text-sm font-semibold">Who paid</h2>
        <p className="mb-4 text-xs text-neutral-500">
          If somebody other than the company paid, this is what the company owes them.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={LABEL}>Paid by</label>
            <select
              name="funder_id" required value={funderId}
              onChange={(e) => setFunderId(e.target.value)}
              className={INPUT}
            >
              {funders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}{f.isCompany ? " (company)" : ""}
                </option>
              ))}
            </select>
            {funder && (
              <p className="mt-1 text-[11px] text-neutral-400">
                {funder.isCompany
                  ? "The company's own money. Creates no debt."
                  : editing
                    ? `Counts towards what the company owes ${funder.name}.`
                    : `Adds to what the company owes ${funder.name}.`}
              </p>
            )}
            {/* Only when it has actually been changed, so it reads as a
                consequence rather than a warning nobody asked for. */}
            {editing && initial && funderId !== initial.funder_id && (
              <p className="mt-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-900">
                Moving this expense to {funder?.name}. Both balances change as
                soon as you save — they are worked out from the ledger, so
                nothing else needs correcting.
              </p>
            )}
          </div>
          <div>
            <label className={LABEL}>Bill / UPI reference (optional)</label>
            <input
              name="reference" defaultValue={initial?.reference ?? ""}
              className={INPUT} placeholder="Invoice or txn id"
            />
          </div>
          <div className="sm:col-span-2">
            <label className={LABEL}>Note (optional)</label>
            <input name="notes" defaultValue={initial?.notes ?? ""} className={INPUT} />
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
        <h2 className="mb-1 text-sm font-semibold">Receipt</h2>
        <p className="mb-4 text-xs text-neutral-500">
          A photo of the bill or a PDF. Worth attaching on anything the company is
          repaying — it is the answer to a question asked months later.
        </p>
        <MediaUpload
          kind="document"
          folder={IMAGEKIT_FOLDERS.receipt}
          value={receiptUrl}
          onChange={setReceiptUrl}
          label="Bill or receipt"
        />
      </section>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-xl bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {saving ? "Saving…" : editing ? "Save changes" : "Save expense"}
        </button>
      </div>
    </form>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Check, AlertCircle } from "lucide-react";
import {
  MANUAL_PAYMENT_METHODS,
  MANUAL_PAYMENT_LABELS,
} from "@/lib/db/sales-channel";
import { TRAFFIC_SOURCES, SOURCE_LABELS } from "@/lib/attribution";

/**
 * The form for a book sold off the platform.
 *
 * Everything here is a field the delivery pipeline needs, plus the two facts
 * only a direct sale has — how the money arrived and its reference. Nothing on
 * this form is optional decoration: an order that cannot be addressed cannot
 * be posted, so the required set is exactly what a courier will ask for.
 *
 * The amount is entered in RUPEES. Every money column in the database is
 * paise, and the route converts — but a person typing 749 into a box labelled
 * paise is a data-entry error waiting to happen, and it would land in a figure
 * nobody reconciles.
 *
 * It arrives pre-filled at the book's live selling price times the number of
 * copies, because that is what almost every direct sale actually is, and
 * retyping the same number all day is how a wrong one eventually gets typed.
 * The price comes from `getProductPricing()` — the same resolver the checkout
 * charges from, offer price and scheduled price change included — so it cannot
 * drift from what the shop is really selling at.
 *
 * It stays editable, and the moment it is edited by hand the quantity stops
 * driving it. Somebody entering a discounted sale, a bundle or an amount that
 * included postage should not have their figure silently recomputed under
 * them when they go back and fix the copies.
 */

const LABEL = "text-xs font-medium text-neutral-500 mb-1.5 block";
const INPUT =
  "w-full text-sm border border-neutral-200 rounded-xl px-3 py-2 bg-white " +
  "focus:outline-none focus:ring-2 focus:ring-primary-500/40 focus:border-primary-400";

export default function DirectSaleForm({ unitPrice }: { unitPrice: number }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const [quantity, setQuantity] = useState(1);
  const [amount, setAmount] = useState(String(unitPrice));
  /** Set once the operator types their own figure — see the note above. */
  const [amountEdited, setAmountEdited] = useState(false);

  const expected = unitPrice * quantity;
  const differs = amountEdited && Number(amount) !== expected;

  function changeQuantity(next: number) {
    const q = Math.max(1, Math.floor(next || 1));
    setQuantity(q);
    if (!amountEdited) setAmount(String(unitPrice * q));
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const fd = new FormData(e.currentTarget);
    const body = Object.fromEntries(fd.entries());

    try {
      const res = await fetch("/api/admin/orders/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, is_signed: fd.get("is_signed") === "on" }),
      });
      const json = await res.json();

      if (!res.ok) {
        setError(json.error ?? "Could not save the order.");
        setSaving(false);
        return;
      }
      setDone(json.order_number);
      // Straight to the order, which is where the next thing to do — routing it
      // to a courier — actually happens.
      router.push(`/admin/orders/${json.order_number}`);
    } catch {
      setError("Could not reach the server. Nothing was saved.");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      {error && (
        <div className="flex items-start gap-2.5 rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      <section className="bg-white border border-neutral-200 rounded-2xl p-5 shadow-sm">
        <h2 className="font-semibold text-sm mb-4">Who bought it</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className={LABEL}>Name</label>
            <input name="buyer_name" required className={INPUT} placeholder="As it goes on the label" />
          </div>
          <div>
            <label className={LABEL}>Phone</label>
            <input
              name="buyer_phone" required inputMode="numeric" className={INPUT}
              placeholder="10 digits" pattern="[0-9\s+\-]{10,15}"
            />
          </div>
          <div className="sm:col-span-2">
            <label className={LABEL}>Email (optional)</label>
            <input name="buyer_email" type="email" className={INPUT} placeholder="For the receipt, if they gave one" />
          </div>
        </div>
      </section>

      <section className="bg-white border border-neutral-200 rounded-2xl p-5 shadow-sm">
        <h2 className="font-semibold text-sm mb-1">Where it goes</h2>
        <p className="text-xs text-neutral-500 mb-4">
          Copy this from their WhatsApp message. The courier will refuse anything incomplete.
        </p>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className={LABEL}>Address</label>
            <input name="address_line1" required className={INPUT} placeholder="House, street" />
          </div>
          <div className="sm:col-span-2">
            <label className={LABEL}>Landmark / area (optional)</label>
            <input name="address_line2" className={INPUT} />
          </div>
          <div>
            <label className={LABEL}>City / town</label>
            <input name="city" required className={INPUT} />
          </div>
          <div>
            <label className={LABEL}>District (optional)</label>
            <input name="district" className={INPUT} />
          </div>
          <div>
            <label className={LABEL}>State</label>
            <input name="state" required className={INPUT} defaultValue="Kerala" />
          </div>
          <div>
            <label className={LABEL}>Pincode</label>
            <input
              name="pincode" required inputMode="numeric" pattern="\d{6}"
              className={INPUT} placeholder="6 digits"
            />
          </div>
        </div>
      </section>

      <section className="bg-white border border-neutral-200 rounded-2xl p-5 shadow-sm">
        <h2 className="font-semibold text-sm mb-1">The money</h2>
        <p className="text-xs text-neutral-500 mb-4">
          Recorded against this order, and reported on its own. It is never added to
          Total revenue, Today, This week or This month — those are checked against
          Razorpay, and this never went through Razorpay.
        </p>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className={LABEL}>Amount paid (₹)</label>
            <input
              name="amount_rupees" required type="number" min="0" step="1"
              className={INPUT}
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setAmountEdited(true);
              }}
            />
            <p className="text-[11px] text-neutral-400 mt-1">
              {quantity === 1
                ? `Selling price ₹${unitPrice.toLocaleString("en-IN")}`
                : `₹${unitPrice.toLocaleString("en-IN")} × ${quantity} = ₹${expected.toLocaleString("en-IN")}`}
              {differs && (
                <button
                  type="button"
                  onClick={() => {
                    setAmount(String(expected));
                    setAmountEdited(false);
                  }}
                  className="ml-1.5 underline hover:text-neutral-600"
                >
                  reset
                </button>
              )}
            </p>
          </div>
          <div>
            <label className={LABEL}>Books</label>
            <input
              name="quantity" type="number" min="1" step="1" className={INPUT}
              value={quantity}
              onChange={(e) => changeQuantity(Number(e.target.value))}
            />
          </div>
          <div>
            <label className={LABEL}>How they paid</label>
            <select name="manual_payment_method" defaultValue="upi" className={INPUT}>
              {MANUAL_PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>{MANUAL_PAYMENT_LABELS[m]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL}>Reference (optional)</label>
            <input
              name="manual_payment_ref" className={INPUT}
              placeholder="UPI txn id, or a note"
            />
          </div>
          <div>
            <label className={LABEL}>Came from</label>
            <select name="source" defaultValue="direct" className={INPUT}>
              {TRAFFIC_SOURCES.map((s) => (
                <option key={s} value={s}>{SOURCE_LABELS[s]}</option>
              ))}
            </select>
          </div>
          <div className="flex items-end pb-2">
            <label className="flex items-center gap-2 text-sm text-neutral-700">
              <input type="checkbox" name="is_signed" className="rounded border-neutral-300" />
              Signed copy
            </label>
          </div>
          <div className="sm:col-span-2">
            <label className={LABEL}>Note (optional)</label>
            <input name="notes" className={INPUT} placeholder="Anything worth remembering about this sale" />
          </div>
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving || !!done}
          className="inline-flex items-center gap-2 rounded-xl bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
        >
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          {done && <Check className="w-4 h-4" />}
          {done ? `Saved ${done}` : saving ? "Saving…" : "Save direct sale"}
        </button>
        <p className="text-xs text-neutral-500">
          Saves as paid and confirmed, ready to route to a courier. The customer gets the
          same confirmation message an online buyer does.
        </p>
      </div>
    </form>
  );
}

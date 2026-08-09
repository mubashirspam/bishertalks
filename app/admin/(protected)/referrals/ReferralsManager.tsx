"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  UserPlus, Settings, IndianRupee, Copy, Check, X, AlertCircle, Power,
} from "lucide-react";
import type { Referrer, ReferralSettings, ReferrerStats } from "@/lib/db/referrals";
import { formatISTShort } from "@/lib/format-date";

type Row = Referrer & { stats: ReferrerStats };

const rupees = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;

export default function ReferralsManager({
  rows,
  settings,
  totals,
  canPayout,
  bookPriceRupees,
}: {
  rows: Row[];
  settings: ReferralSettings;
  totals: { owed: number; paid: number; pending: number };
  canPayout: boolean;
  /** The book's normal price, for the margin figure below. */
  bookPriceRupees: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: "", code: "", phone: "", upi_id: "",
    type: "customer" as "customer" | "affiliate",
    commission_type: "flat" as "percent" | "flat",
    commission_value: String(settings.customer_commission_rupees),
  });

  /** Picking a type sets the rate that type normally gets; still editable. */
  const setType = (type: "customer" | "affiliate") =>
    setForm((f) => ({
      ...f,
      type,
      commission_type: type === "customer" ? "flat" : "percent",
      commission_value: String(
        type === "customer"
          ? settings.customer_commission_rupees
          : settings.affiliate_commission_percent
      ),
    }));
  const [draftSettings, setDraftSettings] = useState(settings);

  const call = async (method: string, body: unknown) => {
    setBusy(true);
    setError("");
    setOk("");
    try {
      const res = await fetch("/api/admin/referrals", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Something went wrong");
        return null;
      }
      router.refresh();
      return json;
    } catch {
      setError("Network error — try again");
      return null;
    } finally {
      setBusy(false);
    }
  };

  const addReferrer = async () => {
    const res = await call("POST", form);
    if (res) {
      setOk(`Referrer created with code ${res.referrer.code}`);
      setShowAdd(false);
      setForm({ ...form, name: "", code: "", phone: "", upi_id: "" });
    }
  };

  const saveSettings = async () => {
    const res = await call("PATCH", { scope: "settings", ...draftSettings });
    if (res) {
      setOk("Settings saved");
      setShowSettings(false);
    }
  };

  const payout = async (r: Row) => {
    const reference = prompt(
      `Pay ${rupees(r.stats.approvedPaise)} to ${r.name}` +
        (r.upi_id ? ` (${r.upi_id})` : "") +
        `.\n\nSend the money first, then paste the UPI reference here to record it:`
    );
    if (reference === null) return;
    const res = await call("PUT", { referrer_id: r.id, reference });
    if (res) setOk(`Recorded ${rupees(res.amountPaise)} paid across ${res.paid} orders`);
  };

  const copyCode = async (code: string) => {
    await navigator.clipboard?.writeText(code);
    setCopied(code);
    setTimeout(() => setCopied(null), 1500);
  };

  const field =
    "bg-white border border-neutral-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-primary-500 transition-colors";

  const fixedMode = draftSettings.referee_pricing_mode === "fixed";

  // What a referred sale actually nets, worked out live while the numbers are
  // being changed rather than discovered a month later.
  const netHint = (() => {
    const commission = draftSettings.customer_commission_rupees;
    const price = fixedMode
      ? (draftSettings.referral_price_rupees ?? bookPriceRupees)
      : Math.max(0, bookPriceRupees - draftSettings.referee_discount_rupees);
    return { commission, price, net: price - commission };
  })();

  return (
    <div>
      {/* Money summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        {[
          { label: "Owed now", value: rupees(totals.owed), tone: "text-orange-600" },
          { label: "In transit", value: rupees(totals.pending), tone: "text-neutral-400" },
          { label: "Paid out", value: rupees(totals.paid), tone: "text-neutral-900" },
          { label: "Referrers", value: String(rows.length), tone: "text-neutral-900" },
        ].map((s) => (
          <div key={s.label} className="bg-white border border-neutral-200 rounded-2xl p-4 shadow-sm">
            <p className="text-xs text-neutral-500">{s.label}</p>
            <p className={`text-2xl font-black mt-1 ${s.tone}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {(error || ok) && (
        <div
          className={`flex items-start gap-2 rounded-xl px-4 py-2.5 mb-4 text-sm border ${
            error ? "bg-red-50 border-red-200 text-red-800" : "bg-green-50 border-green-200 text-green-800"
          }`}
        >
          {error ? <AlertCircle className="w-4 h-4 mt-0.5" /> : <Check className="w-4 h-4 mt-0.5" />}
          <p>{error || ok}</p>
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-5">
        <button
          onClick={() => { setShowAdd(!showAdd); setShowSettings(false); }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary-500 hover:bg-primary-600 text-white text-sm font-bold transition-colors"
        >
          <UserPlus className="w-4 h-4" /> Add referrer
        </button>
        <button
          onClick={() => { setShowSettings(!showSettings); setShowAdd(false); }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-neutral-200 text-sm text-neutral-600 hover:border-neutral-400 transition-colors"
        >
          <Settings className="w-4 h-4" /> Program settings
        </button>
        {!settings.is_enabled && (
          <span className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-medium">
            <AlertCircle className="w-3.5 h-3.5" /> Program is switched off — no new codes or discounts
          </span>
        )}
      </div>

      {/* Settings */}
      {showSettings && (
        <div className="bg-white border border-neutral-200 rounded-2xl p-5 shadow-sm mb-5">
          <h2 className="font-semibold text-sm text-neutral-700 mb-4">Program settings</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1.5 block">
                Customer earns (₹ per delivered order)
              </label>
              <input
                type="number"
                value={draftSettings.customer_commission_rupees}
                onChange={(e) =>
                  setDraftSettings({ ...draftSettings, customer_commission_rupees: Number(e.target.value) })
                }
                className={`${field} w-full`}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1.5 block">
                Default affiliate rate (%)
              </label>
              <input
                type="number"
                value={draftSettings.affiliate_commission_percent}
                onChange={(e) =>
                  setDraftSettings({ ...draftSettings, affiliate_commission_percent: Number(e.target.value) })
                }
                className={`${field} w-full`}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1.5 block">
                Referred buyers pay
              </label>
              <select
                value={draftSettings.referee_pricing_mode}
                onChange={(e) =>
                  setDraftSettings({
                    ...draftSettings,
                    referee_pricing_mode: e.target.value as "discount" | "fixed",
                  })
                }
                className={`${field} w-full cursor-pointer`}
              >
                <option value="discount">A discount off the normal price</option>
                <option value="fixed">A fixed price I set</option>
              </select>
            </div>

            {fixedMode ? (
              <div>
                <label className="text-xs font-medium text-neutral-500 mb-1.5 block">
                  Referral price (₹)
                </label>
                <input
                  type="number"
                  value={draftSettings.referral_price_rupees ?? ""}
                  placeholder={String(bookPriceRupees)}
                  onChange={(e) =>
                    setDraftSettings({
                      ...draftSettings,
                      referral_price_rupees:
                        e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                  className={`${field} w-full`}
                />
              </div>
            ) : (
              <div>
                <label className="text-xs font-medium text-neutral-500 mb-1.5 block">
                  Buyer saves (₹)
                </label>
                <input
                  type="number"
                  value={draftSettings.referee_discount_rupees}
                  onChange={(e) =>
                    setDraftSettings({ ...draftSettings, referee_discount_rupees: Number(e.target.value) })
                  }
                  className={`${field} w-full`}
                />
              </div>
            )}
          </div>

          {/* The number that actually matters when tuning these. */}
          <p className="text-xs text-neutral-500 mt-3 bg-neutral-50 border border-neutral-200 rounded-xl px-3 py-2.5">
            Normal price <strong className="text-neutral-900">₹{bookPriceRupees}</strong> ·
            a referred buyer pays <strong className="text-neutral-900">₹{netHint.price}</strong> ·
            you keep <strong className="text-neutral-900">₹{netHint.net}</strong> after the
            ₹{netHint.commission} commission, before print, shipping and payment fees.
            {netHint.net < netHint.price * 0.5 && (
              <span className="text-amber-700"> That&apos;s under half the sale price — worth a second look.</span>
            )}
          </p>

          <label className="flex items-center gap-2 mt-3 cursor-pointer">
            <input
              type="checkbox"
              checked={draftSettings.is_enabled}
              onChange={(e) => setDraftSettings({ ...draftSettings, is_enabled: e.target.checked })}
              className="w-4 h-4 rounded border-neutral-300 accent-primary-500"
            />
            <span className="text-sm text-neutral-700">Program active</span>
          </label>

          <div className="flex gap-2 mt-4 pt-4 border-t border-neutral-100">
            <button
              onClick={saveSettings}
              disabled={busy}
              className="px-4 py-2 rounded-xl bg-primary-500 hover:bg-primary-600 text-white text-sm font-bold disabled:opacity-60"
            >
              {busy ? "Saving…" : "Save settings"}
            </button>
            <button
              onClick={() => setShowSettings(false)}
              className="px-4 py-2 rounded-xl border border-neutral-200 text-sm text-neutral-600 hover:border-neutral-400"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Add affiliate */}
      {showAdd && (
        <div className="bg-white border border-neutral-200 rounded-2xl p-5 shadow-sm mb-5">
          <h2 className="font-semibold text-sm text-neutral-700 mb-1">Add a referrer</h2>
          <p className="text-xs text-neutral-500 mb-4">
            Codes are only created here. Pick <strong>Customer</strong> for a
            reader sharing with friends (flat ₹ per sale), or
            <strong> Affiliate</strong> for an influencer on a percentage.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1.5 block">Type</label>
              <select
                value={form.type}
                onChange={(e) => setType(e.target.value as "customer" | "affiliate")}
                className={`${field} w-full cursor-pointer`}
              >
                <option value="customer">Customer — flat ₹ per sale</option>
                <option value="affiliate">Affiliate — % of sale</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1.5 block">Name</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={`${field} w-full`} />
            </div>
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1.5 block">
                Code <span className="text-neutral-400 font-normal">(optional)</span>
              </label>
              <input
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                placeholder="Auto-generated"
                className={`${field} w-full font-mono`}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1.5 block">Phone</label>
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={`${field} w-full`} />
            </div>
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1.5 block">UPI ID</label>
              <input
                value={form.upi_id}
                onChange={(e) => setForm({ ...form, upi_id: e.target.value })}
                placeholder="name@bank"
                className={`${field} w-full`}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1.5 block">Commission</label>
              <select
                value={form.commission_type}
                onChange={(e) => setForm({ ...form, commission_type: e.target.value as "percent" | "flat" })}
                className={`${field} w-full cursor-pointer`}
              >
                <option value="percent">Percentage of sale</option>
                <option value="flat">Flat ₹ per sale</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1.5 block">
                {form.commission_type === "percent" ? "Percent" : "Rupees"}
              </label>
              <input
                type="number"
                value={form.commission_value}
                onChange={(e) => setForm({ ...form, commission_value: e.target.value })}
                className={`${field} w-full`}
              />
            </div>
          </div>
          <div className="flex gap-2 mt-4 pt-4 border-t border-neutral-100">
            <button
              onClick={addReferrer}
              disabled={busy}
              className="px-4 py-2 rounded-xl bg-primary-500 hover:bg-primary-600 text-white text-sm font-bold disabled:opacity-60"
            >
              {busy ? "Creating…" : "Create referrer"}
            </button>
            <button onClick={() => setShowAdd(false)} className="px-4 py-2 rounded-xl border border-neutral-200 text-sm text-neutral-600 hover:border-neutral-400">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Referrers */}
      {!rows.length ? (
        <div className="bg-white border border-neutral-200 rounded-2xl p-12 text-center text-neutral-500 shadow-sm">
          No referrers yet. Use “Add referrer” above to give someone a code.
        </div>
      ) : (
        <div className="bg-white border border-neutral-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left bg-neutral-50">
                  {["Referrer", "Code", "Rate", "Clicks", "Orders", "Owed", "Paid", ""].map((h) => (
                    <th key={h} className="px-4 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className={`border-b border-neutral-100 last:border-0 ${r.is_active ? "" : "opacity-60"}`}
                  >
                    <td className="px-4 py-3">
                      <p className="text-neutral-900 font-medium">{r.name}</p>
                      <p className="text-neutral-500 text-xs">
                        {r.type === "affiliate" ? "Affiliate" : "Customer"}
                        {r.phone ? ` · ${r.phone}` : ""}
                      </p>
                      {r.upi_id && <p className="text-neutral-400 text-[11px]">{r.upi_id}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => copyCode(r.code)}
                        title="Copy code"
                        className="inline-flex items-center gap-1.5 font-mono text-xs font-bold text-primary-600 hover:text-primary-700"
                      >
                        {r.code}
                        {copied === r.code ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3 opacity-50" />}
                      </button>
                      <p className="text-neutral-400 text-[11px] mt-0.5">{formatISTShort(r.created_at)}</p>
                    </td>
                    <td className="px-4 py-3 text-neutral-700 text-xs whitespace-nowrap">
                      {r.commission_type === "percent" ? `${r.commission_value}%` : `₹${r.commission_value}`}
                    </td>
                    <td className="px-4 py-3 text-neutral-500">{r.clicks}</td>
                    <td className="px-4 py-3">
                      <span className="text-neutral-900 font-medium">{r.stats.paidOrders}</span>
                      {r.stats.pendingPaise > 0 && (
                        <p className="text-neutral-400 text-[11px]">
                          {rupees(r.stats.pendingPaise)} in transit
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={r.stats.approvedPaise > 0 ? "text-orange-600 font-bold" : "text-neutral-400"}>
                        {rupees(r.stats.approvedPaise)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-neutral-500">{rupees(r.stats.paidPaise)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        {canPayout && r.stats.approvedPaise > 0 && (
                          <button
                            onClick={() => payout(r)}
                            disabled={busy}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-neutral-900 text-white text-xs font-medium hover:bg-neutral-700 disabled:opacity-50"
                          >
                            <IndianRupee className="w-3 h-3" /> Mark paid
                          </button>
                        )}
                        <button
                          onClick={() => call("PATCH", { id: r.id, is_active: !r.is_active })}
                          disabled={busy}
                          title={r.is_active ? "Disable this code" : "Re-enable this code"}
                          className={`p-1.5 rounded-lg border transition-colors ${
                            r.is_active
                              ? "border-neutral-200 text-neutral-500 hover:border-neutral-400"
                              : "border-green-200 text-green-600 hover:border-green-400"
                          }`}
                        >
                          <Power className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

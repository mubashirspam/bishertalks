"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Gift, Loader2, Check } from "lucide-react";
import { MAX_GIFT_CHARGE_PAISE, type GiftSettings } from "@/lib/gift";

/**
 * Gift wrapping: on or off, and what it costs.
 *
 * Two fields, so there is no edit mode to open — the form is the card. Saving
 * is explicit rather than on-change, because the fee is a number people type a
 * digit at a time and an auto-save would briefly sell wrapping at ₹7 on the way
 * to ₹79.
 *
 * The fee box stays editable while wrapping is switched off. Turning it off for
 * a week and setting next month's price are two things someone may well do in
 * the same visit, and disabling the box would make the second impossible.
 */
export default function GiftSettingsCard({ settings }: { settings: GiftSettings }) {
  const router = useRouter();

  const [enabled, setEnabled] = useState(settings.isEnabled);
  const [rupees, setRupees] = useState(String(Math.round(settings.chargePaise / 100)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const dirty =
    enabled !== settings.isEnabled ||
    Math.round(Number(rupees) || 0) !== Math.round(settings.chargePaise / 100);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    setSaved(false);

    try {
      const res = await fetch("/api/admin/gift", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_enabled: enabled, charge_rupees: rupees }),
      });
      const data = await res.json();

      if (!res.ok || data.error) {
        setError(data.error || "Could not save.");
        return;
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      // The checkout reads this fresh on every visit, so this is only to bring
      // the server-rendered card below back in step with what was just saved.
      router.refresh();
    } catch {
      setError("Something went wrong.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={save}
      className="bg-white border border-neutral-200 rounded-2xl p-5 shadow-sm mb-6"
    >
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-semibold text-neutral-900 flex items-center gap-2">
            <Gift className="w-4 h-4 text-primary-500" /> Gift wrapping
          </h2>
          <p className="text-neutral-500 text-sm mt-1">
            An add-on at checkout: the parcel is wrapped and your message is
            written on a card inside.
          </p>
        </div>

        <span
          className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold ${
            settings.isEnabled
              ? "bg-green-50 text-green-700 border border-green-200"
              : "bg-neutral-100 text-neutral-500 border border-neutral-200"
          }`}
        >
          {settings.isEnabled ? "Offered at checkout" : "Not offered"}
        </span>
      </div>

      <div className="flex flex-wrap items-end gap-5 mt-5">
        <label className="flex items-center gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="w-4 h-4 accent-primary-500 cursor-pointer"
          />
          <span className="text-sm text-neutral-700">Offer gift wrapping</span>
        </label>

        <div>
          <label
            htmlFor="gift-charge"
            className="text-xs font-medium text-neutral-500 mb-1.5 block"
          >
            Wrapping fee
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-neutral-400">
              ₹
            </span>
            <input
              id="gift-charge"
              type="number"
              min={0}
              max={MAX_GIFT_CHARGE_PAISE / 100}
              step={1}
              value={rupees}
              onChange={(e) => setRupees(e.target.value)}
              className="w-32 bg-white border border-neutral-300 rounded-xl pl-7 pr-3 py-2 text-sm text-neutral-900 focus:outline-none focus:border-primary-500 transition-colors"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={saving || !dirty}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary-500 hover:bg-primary-600 text-white text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {saving ? "Saving…" : "Save"}
        </button>

        {saved && !dirty && (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-green-700">
            <Check className="w-3.5 h-3.5" /> Saved
          </span>
        )}
      </div>

      {error && <p className="text-xs text-red-600 mt-3">{error}</p>}

      {/* Said plainly, because "will this change what I already sold?" is the
          first thing anyone wonders before touching a price. */}
      <p className="text-[11px] text-neutral-400 mt-4 leading-relaxed">
        Applies to new orders only — an order already placed keeps the fee it was
        charged, and still needs wrapping. Turning it off hides the option at
        checkout; it does not cancel anything already paid for.
      </p>
    </form>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Tag, Loader2, Check } from "lucide-react";
import type { CheckoutSettings } from "@/lib/checkout-settings";

/**
 * The promo code field: shown at checkout, or not.
 *
 * One switch, so it saves on toggle rather than behind a button — there is no
 * half-typed state to protect here, unlike the wrapping fee above, where an
 * auto-save would briefly sell wrapping at ₹7 on the way to ₹79.
 *
 * Sits directly above the codes table on purpose. "These codes exist but
 * nobody can enter them" is the single most confusing state this screen can be
 * in, and the switch that causes it should be the thing you read first.
 */
export default function PromoFieldCard({
  settings,
}: {
  settings: CheckoutSettings;
}) {
  const router = useRouter();

  const [enabled, setEnabled] = useState(settings.promoFieldIsEnabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const toggle = async (next: boolean) => {
    // Optimistic, and rolled back below if the save fails. A switch that waits
    // for a round trip before moving feels broken.
    setEnabled(next);
    setError("");
    setSaving(true);
    setSaved(false);

    try {
      const res = await fetch("/api/admin/checkout", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promo_field_is_enabled: next }),
      });
      const data = await res.json();

      if (!res.ok || data.error) {
        setEnabled(!next);
        setError(data.error || "Could not save.");
        return;
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      // The checkout reads this fresh on every visit, so this is only to bring
      // the server-rendered badge back in step with what was just saved.
      router.refresh();
    } catch {
      setEnabled(!next);
      setError("Something went wrong.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white border border-neutral-200 rounded-2xl p-5 shadow-sm mb-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h2 className="font-semibold text-neutral-900 flex items-center gap-2">
            <Tag className="w-4 h-4 text-primary-500" /> Promo code field
          </h2>
          <p className="text-neutral-500 text-sm mt-1 max-w-xl">
            The &ldquo;Enter code&rdquo; box at checkout. Hiding it stops
            customers asking what it is, and stops the ones without a code
            wondering what they are missing.
          </p>
        </div>

        <span
          className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold ${
            settings.promoFieldIsEnabled
              ? "bg-green-50 text-green-700 border border-green-200"
              : "bg-neutral-100 text-neutral-500 border border-neutral-200"
          }`}
        >
          {settings.promoFieldIsEnabled ? "Shown at checkout" : "Hidden"}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-4 mt-5">
        <label className="flex items-center gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            disabled={saving}
            onChange={(e) => void toggle(e.target.checked)}
            className="w-4 h-4 accent-primary-500 cursor-pointer disabled:cursor-not-allowed"
          />
          <span className="text-sm text-neutral-700">
            Show the promo code field
          </span>
        </label>

        {saving && (
          <span className="inline-flex items-center gap-1.5 text-xs text-neutral-500">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…
          </span>
        )}
        {saved && !saving && (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-green-700">
            <Check className="w-3.5 h-3.5" /> Saved
          </span>
        )}
      </div>

      {error && <p className="text-xs text-red-600 mt-3">{error}</p>}

      {/* The two things people assume this breaks, answered before they ask. */}
      <p className="text-[11px] text-neutral-400 mt-4 leading-relaxed">
        Referral links are not affected — a referral discount comes from the
        link someone clicked, not from this box, and keeps working while it is
        hidden. The codes below are not deleted either: while the field is
        hidden nobody can type one, and they all work again the moment it is
        switched back on.
      </p>
    </div>
  );
}

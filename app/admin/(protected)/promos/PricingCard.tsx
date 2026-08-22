"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { IndianRupee, Loader2, Check, CalendarClock, Trash2 } from "lucide-react";
import { useCountdown } from "@/app/neuro-code/Countdown";

/**
 * What the book costs, and what it is about to cost.
 *
 * This is the biggest number on the site, so it sits above the wrapping fee and
 * the promo switch. It used to live under **Courses → NLP → Offer price** — the
 * price of the product was a field on the free course that comes with it, which
 * is nobody's first guess and the reason this card exists.
 *
 * THE SCHEDULE DOES NOT FIRE. Nothing runs at the appointed hour; there is no
 * scheduler in this deployment. Every read of the price asks the clock instead
 * (`resolvePricing` in lib/db/courses.ts), which is exact to the second and
 * cannot be missed. A time in the past therefore applies immediately, and the
 * form says so rather than refusing it.
 */

/** Whole rupees from a text box — digits only, empty means unset. */
const digits = (v: string) => v.replace(/\D/g, "");

export default function PricingCard({
  price,
  offerPrice,
  next,
}: {
  /** The struck-through compare-at, in rupees. */
  price: number;
  /** What is charged now, or null when there is no offer on. */
  offerPrice: number | null;
  /**
   * The pending change, measured on the server.
   *
   * `remainingMs` comes from the server rather than being worked out here, so
   * the countdown's first paint matches the HTML — the same reason the landing
   * page passes one down. See app/neuro-code/Countdown.tsx.
   */
  next: {
    price: number;
    offerPrice: number | null;
    effectiveAtISO: string;
    /** For the datetime-local input: "YYYY-MM-DDTHH:mm" in IST. */
    effectiveAtLocal: string;
    remainingMs: number;
    applied: boolean;
  } | null;
}) {
  const router = useRouter();

  const [form, setForm] = useState({
    price: String(price),
    offer: offerPrice == null ? "" : String(offerPrice),
    nextPrice: next ? String(next.price) : "",
    nextOffer: next?.offerPrice == null ? "" : String(next.offerPrice),
    at: next?.effectiveAtLocal ?? "",
  });

  const [busy, setBusy] = useState<null | "save" | "clear" | "apply">(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const left = useCountdown(
    next ? new Date(next.effectiveAtISO).getTime() : 0,
    next?.remainingMs ?? 0
  );

  const set = (k: keyof typeof form, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  const send = async (body: unknown, which: "save" | "clear" | "apply") => {
    setBusy(which);
    setError("");
    setSaved(false);
    try {
      const res = await fetch("/api/admin/checkout/pricing", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setError(data.error || "Could not save.");
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      router.refresh();
    } catch {
      setError("Something went wrong.");
    } finally {
      setBusy(null);
    }
  };

  const save = () =>
    send(
      {
        price: Number(form.price),
        offer_price: form.offer ? Number(form.offer) : null,
        next: form.at
          ? {
              price: Number(form.nextPrice),
              offer_price: form.nextOffer ? Number(form.nextOffer) : null,
              // Sent as a local IST wall-clock string; the server turns it into
              // an instant. Doing that conversion here would depend on the
              // admin's own timezone, and somebody setting tonight's price from
              // a laptop still on GMT would move it by five and a half hours.
              effective_at_local: form.at,
            }
          : null,
      },
      "save"
    );

  const nowCharged = form.offer || form.price;
  const willCharge = form.nextOffer || form.nextPrice;

  const card = "bg-white border border-neutral-200 rounded-2xl p-5 shadow-sm mb-6";
  const field =
    "w-full bg-white border border-neutral-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-primary-500 transition-colors";
  const label = "text-xs font-medium text-neutral-500 mb-1.5 block";

  return (
    <div className={card}>
      <div className="flex items-center gap-2 mb-1">
        <IndianRupee className="w-4 h-4 text-primary-500" />
        <h2 className="text-sm font-semibold text-neutral-900">Book price</h2>
      </div>
      <p className="text-xs text-neutral-500 mb-4">
        What the customer is charged, and what shows struck through beside it.
        This is the price the checkout and Razorpay use.
      </p>

      {/* ── Now ──────────────────────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={label}>Charged now (₹)</label>
          <input
            inputMode="numeric"
            value={form.offer}
            onChange={(e) => set("offer", digits(e.target.value))}
            placeholder={`No offer — charges ₹${form.price || price}`}
            className={field}
          />
        </div>
        <div>
          <label className={label}>Struck through (₹)</label>
          <input
            inputMode="numeric"
            value={form.price}
            onChange={(e) => set("price", digits(e.target.value))}
            className={field}
          />
        </div>
      </div>

      <p className="mt-2 text-xs text-neutral-500">
        Customer sees{" "}
        <span className="font-semibold text-neutral-900">₹{nowCharged || "—"}</span>
        {form.offer && form.price && Number(form.offer) < Number(form.price) && (
          <>
            {" "}
            with <span className="line-through">₹{form.price}</span> beside it
          </>
        )}
        . Leave the first box empty to charge the full price with nothing struck
        through.
      </p>

      {/* ── Scheduled ────────────────────────────────────────────────────── */}
      <div className="mt-5 pt-4 border-t border-neutral-100">
        <div className="flex items-center gap-2 mb-1">
          <CalendarClock className="w-4 h-4 text-amber-500" />
          <h3 className="text-sm font-semibold text-neutral-900">
            Change it automatically
          </h3>
        </div>
        <p className="text-xs text-neutral-500 mb-3">
          Set a new price and the moment it takes over. Nobody has to be awake —
          the change applies on the first page load after that time, to the
          second. The countdown on the landing page follows this too.
        </p>

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className={label}>New charged (₹)</label>
            <input
              inputMode="numeric"
              value={form.nextOffer}
              onChange={(e) => set("nextOffer", digits(e.target.value))}
              placeholder="No offer"
              className={field}
            />
          </div>
          <div>
            <label className={label}>New struck through (₹)</label>
            <input
              inputMode="numeric"
              value={form.nextPrice}
              onChange={(e) => set("nextPrice", digits(e.target.value))}
              className={field}
            />
          </div>
          <div>
            <label className={label}>From (IST)</label>
            <input
              type="datetime-local"
              value={form.at}
              onChange={(e) => set("at", e.target.value)}
              className={field}
            />
          </div>
        </div>

        {next && !next.applied && (
          <p className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
            ₹{offerPrice ?? price} → ₹{next.offerPrice ?? next.price} in{" "}
            <span className="tabular-nums font-bold">
              {left.totalHours}h {String(left.minutes).padStart(2, "0")}m{" "}
              {String(left.seconds).padStart(2, "0")}s
            </span>
          </p>
        )}

        {next?.applied && (
          <div className="mt-3 rounded-xl border border-green-300 bg-green-50 px-3 py-2">
            <p className="text-xs font-medium text-green-900">
              This change has already taken effect — customers are being charged
              ₹{next.offerPrice ?? next.price} now.
            </p>
            <button
              onClick={() => send({ apply: true }, "apply")}
              disabled={!!busy}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-green-600 bg-white px-3 py-1.5 text-xs font-semibold text-green-800 transition-colors hover:bg-green-100 disabled:opacity-40"
            >
              {busy === "apply" ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Check className="w-3.5 h-3.5" />
              )}
              Make it the normal price and clear this
            </button>
          </div>
        )}

        {next && (
          <button
            onClick={() => {
              setForm((f) => ({ ...f, nextPrice: "", nextOffer: "", at: "" }));
              send(
                {
                  price: Number(form.price),
                  offer_price: form.offer ? Number(form.offer) : null,
                  next: null,
                },
                "clear"
              );
            }}
            disabled={!!busy}
            className="mt-2 inline-flex items-center gap-1.5 text-xs text-neutral-500 underline underline-offset-2 transition-colors hover:text-neutral-900 disabled:opacity-40"
          >
            <Trash2 className="w-3 h-3" />
            Cancel the scheduled change
          </button>
        )}
      </div>

      {/* ── Save ─────────────────────────────────────────────────────────── */}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          onClick={save}
          disabled={!!busy || !form.price}
          className="inline-flex items-center gap-2 rounded-xl bg-primary-500 px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-primary-600 disabled:opacity-40"
        >
          {busy === "save" ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Check className="w-4 h-4" />
          )}
          Save pricing
        </button>

        {form.at && willCharge && (
          <span className="text-xs text-neutral-500">
            Will charge ₹{willCharge} from {form.at.replace("T", " ")} IST
          </span>
        )}

        {saved && <span className="text-xs font-medium text-green-700">Saved.</span>}
        {error && <span className="text-xs font-medium text-red-600">{error}</span>}
      </div>
    </div>
  );
}

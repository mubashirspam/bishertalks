"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus, X, Check, AlertCircle, Loader2, Power, Trash2, Info,
} from "lucide-react";
import {
  COURIER_HANDOFFS,
  HANDOFF_LABELS,
  HANDOFF_HINTS,
  canSendAutomatically,
  canTrack,
  isMisconfigured,
  type Courier,
  type CourierHandoff,
} from "@/lib/couriers";

/**
 * Add, rename, switch off and configure the couriers.
 *
 * The handoff picker carries the whole design: `manual` is the default and the
 * one that always works, because a courier we hand parcels to needs no code at
 * all. `api` is offered but honest about itself — choosing it for a partner
 * with no integration written produces a warning here rather than a dead button
 * on the delivery screen.
 */
export default function CourierManager({
  couriers,
  delhivery,
}: {
  couriers: Courier[];
  /** Whether the one integrated partner can actually be used yet. */
  delhivery: { configured: boolean; missing: string[]; env: string };
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; bad?: boolean } | null>(null);

  const [name, setName] = useState("");
  const [handoff, setHandoff] = useState<CourierHandoff>("manual");

  const call = async (method: string, body?: unknown, query = "") => {
    setBusy(method + query);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/couriers${query}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setMessage({ text: data.error ?? "That didn't work.", bad: true });
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setMessage({ text: "Could not reach the server.", bad: true });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const ok = await call("POST", { name, handoff });
    if (ok) {
      setMessage({ text: `${name} added.` });
      setName("");
      setHandoff("manual");
      setAdding(false);
    }
  };

  const card = "bg-white border border-neutral-200 rounded-2xl shadow-sm";

  return (
    <div className="space-y-4">
      {/* The one integration, and whether it is usable. Above the list because
          "why is Send greyed out" is the question this page mostly answers. */}
      {!delhivery.configured && couriers.some((c) => c.slug === "delhivery") && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900 flex items-center gap-2">
            <AlertCircle className="w-4 h-4" /> Delhivery can&apos;t send yet
          </p>
          <p className="text-xs text-amber-800 mt-1">
            You can put parcels on Delhivery and they will show as theirs, but
            nothing is sent to Delhivery until these are known:
          </p>
          <ul className="mt-2 space-y-1">
            {delhivery.missing.map((m) => (
              <li key={m} className="text-xs text-amber-900 flex gap-2">
                <span aria-hidden>•</span>
                <span>{m}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {delhivery.configured && delhivery.env !== "production" && (
        <p className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-900 flex items-center gap-2">
          <Info className="w-4 h-4 flex-shrink-0" />
          Delhivery is pointed at <strong>staging</strong>. Parcels sent from here
          are test shipments — no van will come. Set DELHIVERY_ENV to production
          when you&apos;re ready.
        </p>
      )}

      {message && (
        <div
          className={`flex items-start gap-2 rounded-xl px-4 py-2.5 text-sm border ${
            message.bad
              ? "bg-red-50 border-red-200 text-red-800"
              : "bg-green-50 border-green-200 text-green-800"
          }`}
        >
          {message.bad ? (
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          ) : (
            <Check className="w-4 h-4 mt-0.5 flex-shrink-0" />
          )}
          <p>{message.text}</p>
        </div>
      )}

      {/* ── Add ────────────────────────────────────────────────────────────── */}
      {adding ? (
        <form onSubmit={add} className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-sm text-neutral-900">New courier</h2>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="text-neutral-400 hover:text-neutral-900"
              aria-label="Cancel"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <label className="text-xs font-medium text-neutral-500 mb-1.5 block">
            Name
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="India Post — Speed Post"
            autoFocus
            className="w-full bg-white border border-neutral-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-primary-500 transition-colors"
          />

          <fieldset className="mt-4">
            <legend className="text-xs font-medium text-neutral-500 mb-2">
              How do parcels get to them?
            </legend>
            <div className="space-y-2">
              {COURIER_HANDOFFS.map((h) => (
                <label
                  key={h}
                  className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                    handoff === h
                      ? "border-primary-400 bg-primary-50/60"
                      : "border-neutral-200 hover:border-neutral-300"
                  }`}
                >
                  <input
                    type="radio"
                    name="handoff"
                    checked={handoff === h}
                    onChange={() => setHandoff(h)}
                    className="mt-0.5 accent-primary-500"
                  />
                  <span>
                    <span className="block text-sm font-medium text-neutral-900">
                      {HANDOFF_LABELS[h]}
                    </span>
                    <span className="block text-xs text-neutral-500 mt-0.5 leading-relaxed">
                      {HANDOFF_HINTS[h]}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <button
            type="submit"
            disabled={!name.trim() || !!busy}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary-500 hover:bg-primary-600 text-white text-sm font-semibold transition-all disabled:opacity-40"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Add courier
          </button>
        </form>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary-500 hover:bg-primary-600 text-white text-sm font-semibold transition-all"
        >
          <Plus className="w-4 h-4" /> Add a courier
        </button>
      )}

      {/* ── The list ───────────────────────────────────────────────────────── */}
      <div className={card}>
        {couriers.length === 0 ? (
          <p className="p-10 text-center text-neutral-500 text-sm">
            No couriers yet. Add one to start assigning parcels.
          </p>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {couriers.map((c) => (
              <li key={c.id} className="p-4 flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-sm text-neutral-900 flex items-center gap-2 flex-wrap">
                    {c.name}
                    {!c.is_active && (
                      <span className="px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-500 text-[11px] font-medium">
                        Off
                      </span>
                    )}
                    {canSendAutomatically(c) && (
                      <span className="px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200 text-[11px] font-semibold">
                        Sending on
                      </span>
                    )}
                    {/* Separate from sending on purpose: a courier we hand a
                        spreadsheet to can still report its own scans, which is
                        exactly what the Excel channel does. */}
                    {canTrack(c) && (
                      <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 text-[11px] font-semibold">
                        Live tracking
                      </span>
                    )}
                    {isMisconfigured(c) && (
                      <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200 text-[11px] font-semibold">
                        Sending off
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    {HANDOFF_LABELS[c.handoff]}
                    {canTrack(c) && " · status comes back automatically"}
                    {c.config.pickup_location && ` · picks up from ${c.config.pickup_location}`}
                  </p>
                  {isMisconfigured(c) && (
                    <p className="text-xs text-amber-700 mt-1">
                      Sending is switched off while we test. You can put parcels
                      on {c.name} and they show up as theirs — but {c.name}
                      won&apos;t know about a parcel until someone hands it over,
                      or until sending is turned on.
                    </p>
                  )}
                </div>

                <button
                  onClick={() => call("PATCH", { id: c.id, is_active: !c.is_active })}
                  disabled={!!busy}
                  title={c.is_active ? "Stop offering this courier" : "Offer it again"}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-200 text-xs text-neutral-600 hover:border-neutral-400 transition-colors disabled:opacity-40"
                >
                  <Power className="w-3.5 h-3.5" />
                  {c.is_active ? "Switch off" : "Switch on"}
                </button>

                <button
                  onClick={() => call("DELETE", undefined, `?id=${c.id}`)}
                  disabled={!!busy}
                  title="Delete — only possible if it has never carried a parcel"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-200 text-xs text-neutral-500 hover:border-red-300 hover:text-red-700 transition-colors disabled:opacity-40"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

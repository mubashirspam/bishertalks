"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus, X, Check, AlertCircle, Loader2, Power, Trash2, Info, MapPin,
} from "lucide-react";
import {
  COURIER_HANDOFFS,
  HANDOFF_LABELS,
  HANDOFF_HINTS,
  canSendAutomatically,
  canTrack,
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

  /** Which courier's address sheet is open for editing, if any. */
  const [editing, setEditing] = useState<string | null>(null);
  const [from, setFrom] = useState({ name: "", address: "", phone: "" });
  /** The masthead: what prints above the address, and the account it books to. */
  const [head, setHead] = useState({ title: "", customer: "", contract: "" });

  const openSheet = (c: Courier) => {
    setEditing(c.id);
    setFrom({
      name: c.config.from_name ?? "",
      address: c.config.from_address ?? "",
      phone: c.config.from_phone ?? "",
    });
    setHead({
      title: c.config.sheet_title ?? "",
      customer: c.config.customer_id ?? "",
      contract: c.config.contract_id ?? "",
    });
  };

  const saveSheet = async (c: Courier) => {
    // Spread the existing config, don't replace it. The PATCH stores whatever
    // `config` it is given, so sending only the fields below would drop
    // pickup_location and tracking — and dropping `tracking` silently switches
    // off live status for every parcel with that courier.
    const ok = await call("PATCH", {
      id: c.id,
      config: {
        ...c.config,
        from_name: from.name,
        from_address: from.address,
        from_phone: from.phone,
        sheet_title: head.title,
        customer_id: head.customer,
        contract_id: head.contract,
      },
    });
    if (ok) {
      setMessage({ text: `Address sheet saved for ${c.name}.` });
      setEditing(null);
    }
  };

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
              <li key={c.id} className="p-4">
              <div className="flex flex-wrap items-center gap-3">
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
                  </p>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    {HANDOFF_LABELS[c.handoff]}
                    {canTrack(c) && " · status comes back automatically"}
                    {c.config.pickup_location && ` · picks up from ${c.config.pickup_location}`}
                    {c.config.from_address && " · own return address"}
                    {c.config.contract_id && ` · contract ${c.config.contract_id}`}
                  </p>
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
                  onClick={() => (editing === c.id ? setEditing(null) : openSheet(c))}
                  disabled={!!busy}
                  title="What prints on this courier's address sheets — heading, contract numbers, and the address a failed parcel comes back to"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-200 text-xs text-neutral-600 hover:border-neutral-400 transition-colors disabled:opacity-40"
                >
                  <MapPin className="w-3.5 h-3.5" />
                  Address sheet
                </button>

                <button
                  onClick={() => call("DELETE", undefined, `?id=${c.id}`)}
                  disabled={!!busy}
                  title="Delete — only possible if it has never carried a parcel"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-200 text-xs text-neutral-500 hover:border-red-300 hover:text-red-700 transition-colors disabled:opacity-40"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Everything printed on this courier's address sheets, in the
                  order it prints. Per courier because it genuinely differs: a
                  Speed Post parcel is booked against a contract and comes back
                  to the branch it was posted at, a KKR one has no contract and
                  comes back to KKR's counter. Leaving a field empty is not an
                  error — it falls back to the site-wide default, and an empty
                  contract number simply prints no contract band. */}
              {editing === c.id && (
                <div className="mt-4 rounded-xl border border-neutral-200 bg-neutral-50/70 p-4">
                  <p className="text-xs font-medium text-neutral-700 mb-1">
                    Printed above every address on {c.name}&apos;s sheets
                  </p>
                  <p className="text-[11px] text-neutral-500 mb-3">
                    Fifteen addresses to an A4 page, and each one carries this
                    heading and these numbers — a cell gets cut out and travels
                    with the parcel on its own.
                  </p>

                  <label className="text-[11px] font-medium text-neutral-500 mb-1 block">
                    Heading
                  </label>
                  <input
                    value={head.title}
                    onChange={(e) => setHead({ ...head, title: e.target.value })}
                    placeholder="INDIA POST PARCEL CONTRACTUAL"
                    className="w-full bg-white border border-neutral-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary-500 transition-colors"
                  />
                  <p className="text-[11px] text-neutral-500 mt-1.5">
                    Prints in capitals, centred, on one line — keep it short
                    enough to read at that size.
                  </p>

                  <div className="grid gap-3 sm:grid-cols-2 mt-3">
                    <div>
                      <label className="text-[11px] font-medium text-neutral-500 mb-1 block">
                        Customer ID
                      </label>
                      <input
                        value={head.customer}
                        onChange={(e) => setHead({ ...head, customer: e.target.value })}
                        placeholder="Leave empty if there is none"
                        className="w-full bg-white border border-neutral-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary-500 transition-colors"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-neutral-500 mb-1 block">
                        Contract ID
                      </label>
                      <input
                        value={head.contract}
                        onChange={(e) => setHead({ ...head, contract: e.target.value })}
                        placeholder="Leave empty if there is none"
                        className="w-full bg-white border border-neutral-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary-500 transition-colors"
                      />
                    </div>
                  </div>
                  <p className="text-[11px] text-neutral-500 mt-1.5">
                    The account the booking is charged to. Both empty and that
                    line doesn&apos;t print at all.
                  </p>

                  <p className="text-xs font-medium text-neutral-700 mb-3 mt-5 pt-4 border-t border-neutral-200">
                    Return address printed at the foot
                  </p>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="text-[11px] font-medium text-neutral-500 mb-1 block">
                        Name
                      </label>
                      <input
                        value={from.name}
                        onChange={(e) => setFrom({ ...from, name: e.target.value })}
                        placeholder="Leave empty for the default"
                        className="w-full bg-white border border-neutral-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary-500 transition-colors"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-neutral-500 mb-1 block">
                        Phone
                      </label>
                      <input
                        value={from.phone}
                        onChange={(e) => setFrom({ ...from, phone: e.target.value })}
                        placeholder="Leave empty for the default"
                        className="w-full bg-white border border-neutral-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary-500 transition-colors"
                      />
                    </div>
                  </div>

                  <label className="text-[11px] font-medium text-neutral-500 mb-1 mt-3 block">
                    Address
                  </label>
                  <input
                    value={from.address}
                    onChange={(e) => setFrom({ ...from, address: e.target.value })}
                    placeholder="Street, town, district, pincode"
                    className="w-full bg-white border border-neutral-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary-500 transition-colors"
                  />
                  <p className="text-[11px] text-neutral-500 mt-1.5">
                    One line — it prints small, under the delivery address.
                  </p>

                  <div className="flex items-center gap-2 mt-4">
                    <button
                      onClick={() => saveSheet(c)}
                      disabled={!!busy}
                      className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-primary-500 hover:bg-primary-600 text-white text-xs font-semibold transition-all disabled:opacity-40"
                    >
                      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                      Save
                    </button>
                    <button
                      onClick={() => setEditing(null)}
                      className="px-3.5 py-2 rounded-lg border border-neutral-200 text-xs text-neutral-600 hover:border-neutral-400 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { Check, Copy, Undo2 } from "lucide-react";
import {
  PORTAL_STATUS_STEPS,
  PORTAL_STEP_LABELS,
  ENTERED_LABEL,
  ENTERED_HINT,
  type PortalRow,
  type PortalStatusStep,
} from "@/lib/db/delivery-portal";
import type { OrderStatus } from "@/lib/types/order";
import { formatISTShort } from "@/lib/format-date";

/**
 * The portal grid.
 *
 * Two halves: the details an agent copies into a courier's system, and the
 * ticks recording what they've done. Ticking writes immediately — there is no
 * save button, because a save button is a thing to forget.
 *
 * Updates are optimistic and held in an overrides map rather than by mirroring
 * the whole row array in state: the server sends fresh rows on every filter
 * change, and a mirrored copy would have to be resynced on each one.
 */
export default function PortalGrid({
  rows,
  startIndex,
}: {
  rows: PortalRow[];
  startIndex: number;
}) {
  const [overrides, setOverrides] = useState<Record<string, OrderStatus>>({});
  const [entered, setEntered] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const statusOf = (row: PortalRow): OrderStatus => overrides[row.order_number] ?? row.status;

  /**
   * Has the address been keyed into the courier's system?
   *
   * Ticking any later stage implies it — you cannot pack and ship a parcel you
   * never entered — so a row at Packed or beyond reads as entered even if the
   * agent skipped the first box.
   */
  const enteredOf = (row: PortalRow): boolean => {
    const local = entered[row.order_number];
    if (local !== undefined) return local;
    if (row.courier_entered_at) return true;
    const status = statusOf(row);
    return (PORTAL_STATUS_STEPS as readonly OrderStatus[]).includes(status);
  };

  async function setStatus(row: PortalRow, status: OrderStatus) {
    const previous = statusOf(row);
    if (previous === status) return;

    setOverrides((o) => ({ ...o, [row.order_number]: status }));
    setSaving((s) => ({ ...s, [row.order_number]: true }));
    setError(null);

    try {
      const res = await fetch("/api/admin/delivery/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_number: row.order_number, status }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Update failed (${res.status})`);
      }
    } catch (e) {
      // Put it back — a tick that silently didn't save is worse than no tick.
      setOverrides((o) => ({ ...o, [row.order_number]: previous }));
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setSaving((s) => ({ ...s, [row.order_number]: false }));
    }
  }

  async function toggleEntered(row: PortalRow) {
    const next = !enteredOf(row);

    setEntered((e) => ({ ...e, [row.order_number]: next }));
    setSaving((s) => ({ ...s, [row.order_number]: true }));
    setError(null);

    try {
      const res = await fetch("/api/admin/delivery/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_number: row.order_number, entered: next }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Update failed (${res.status})`);
      }
    } catch (e) {
      setEntered((en) => ({ ...en, [row.order_number]: !next }));
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setSaving((s) => ({ ...s, [row.order_number]: false }));
    }
  }

  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1200);
    } catch {
      setError("Could not copy — the browser blocked clipboard access.");
    }
  }

  const addressText = (r: PortalRow) =>
    [
      r.address_line1,
      r.address_line2,
      [r.city, r.district].filter(Boolean).join(", "),
      [r.state, r.pincode].filter(Boolean).join(" - "),
    ]
      .filter(Boolean)
      .join("\n");

  const wholeRowText = (r: PortalRow) =>
    [r.buyer_name, r.buyer_phone, addressText(r)].filter(Boolean).join("\n");

  /** A step is ticked once the parcel has reached it — so Delivered shows the
   *  whole row filled in, which is what "where is this parcel" looks like at a
   *  glance down the column. */
  const reached = (status: OrderStatus, step: PortalStatusStep) => {
    // A returned parcel really was packed and shipped; the history stands, and
    // the Return tick is what says how it ended.
    const effective: OrderStatus = status === "returned" ? "shipped" : status;
    const current = (PORTAL_STATUS_STEPS as readonly OrderStatus[]).indexOf(effective);
    return current >= 0 && PORTAL_STATUS_STEPS.indexOf(step) <= current;
  };

  const STEP_TONE: Record<PortalStatusStep, string> = {
    processing: "bg-amber-500 border-amber-500",
    shipped: "bg-purple-500 border-purple-500",
    delivered: "bg-green-600 border-green-600",
  };

  const cell = "px-3 py-2 align-top";

  return (
    <div className="bg-white border border-neutral-200 rounded-2xl shadow-sm">
      {error && (
        <p className="text-xs text-red-600 bg-red-50 border-b border-red-100 px-4 py-2 rounded-t-2xl">
          {error}
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-neutral-50 border-b border-neutral-200 text-left">
              {["#", "Ordered", "Name", "Mobile", "Address", "Pincode"].map((h) => (
                <th
                  key={h}
                  className="px-3 py-2.5 font-semibold text-neutral-500 uppercase tracking-wider whitespace-nowrap border-r border-neutral-100"
                >
                  {h}
                </th>
              ))}
              <th
                title={ENTERED_HINT}
                className="px-2 py-2.5 font-semibold text-neutral-500 uppercase tracking-wider text-center whitespace-nowrap border-r border-neutral-100"
              >
                {ENTERED_LABEL}
              </th>
              {PORTAL_STATUS_STEPS.map((s) => (
                <th
                  key={s}
                  className="px-2 py-2.5 font-semibold text-neutral-500 uppercase tracking-wider text-center whitespace-nowrap border-r border-neutral-100"
                >
                  {PORTAL_STEP_LABELS[s]}
                </th>
              ))}
              <th className="px-2 py-2.5 font-semibold text-neutral-500 uppercase tracking-wider text-center whitespace-nowrap">
                Return
              </th>
            </tr>
          </thead>

          <tbody>
            {rows.map((r, i) => {
              const status = statusOf(r);
              const busy = saving[r.order_number];

              return (
                <tr
                  key={r.id}
                  className={`border-b border-neutral-100 last:border-0 hover:bg-neutral-50/70 transition-colors ${
                    busy ? "opacity-60" : ""
                  }`}
                >
                  <td className={`${cell} text-neutral-400 border-r border-neutral-100`}>
                    {startIndex + i + 1}
                  </td>

                  <td className={`${cell} text-neutral-500 whitespace-nowrap border-r border-neutral-100`}>
                    {formatISTShort(r.created_at)}
                  </td>

                  {/* Name — the copy button on this one takes the whole block,
                      since that is what gets pasted into a courier form. */}
                  <td className={`${cell} border-r border-neutral-100`}>
                    <div className="flex items-start gap-1.5">
                      <span className="font-medium text-neutral-900">{r.buyer_name ?? "—"}</span>
                      <CopyButton
                        title="Copy name, mobile and address"
                        active={copied === `${r.order_number}:all`}
                        onClick={() => copy(`${r.order_number}:all`, wholeRowText(r))}
                      />
                    </div>
                    <span className="text-neutral-400">{r.order_number}</span>
                  </td>

                  <td className={`${cell} whitespace-nowrap border-r border-neutral-100`}>
                    <div className="flex items-center gap-1.5">
                      <span className="text-neutral-700">{r.buyer_phone ?? "—"}</span>
                      {r.buyer_phone && (
                        <CopyButton
                          title="Copy mobile"
                          active={copied === `${r.order_number}:phone`}
                          onClick={() => copy(`${r.order_number}:phone`, r.buyer_phone!)}
                        />
                      )}
                    </div>
                  </td>

                  <td className={`${cell} border-r border-neutral-100 min-w-[220px]`}>
                    <div className="flex items-start gap-1.5">
                      <span className="text-neutral-700 whitespace-pre-line leading-snug">
                        {addressText(r) || "—"}
                      </span>
                      <CopyButton
                        title="Copy address"
                        active={copied === `${r.order_number}:addr`}
                        onClick={() => copy(`${r.order_number}:addr`, addressText(r))}
                      />
                    </div>
                  </td>

                  <td className={`${cell} whitespace-nowrap border-r border-neutral-100`}>
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-neutral-700">{r.pincode ?? "—"}</span>
                      {r.pincode && (
                        <CopyButton
                          title="Copy pincode"
                          active={copied === `${r.order_number}:pin`}
                          onClick={() => copy(`${r.order_number}:pin`, r.pincode!)}
                        />
                      )}
                    </div>
                  </td>

                  <td className="px-2 py-2 text-center border-r border-neutral-100">
                    <Tick
                      on={enteredOf(r)}
                      tone="bg-blue-500 border-blue-500"
                      disabled={!!busy}
                      title={ENTERED_HINT}
                      onClick={() => toggleEntered(r)}
                    />
                  </td>

                  {PORTAL_STATUS_STEPS.map((step) => (
                    <td key={step} className="px-2 py-2 text-center border-r border-neutral-100">
                      <Tick
                        on={reached(status, step)}
                        muted={status === "returned"}
                        tone={STEP_TONE[step]}
                        disabled={!!busy}
                        title={`Mark ${PORTAL_STEP_LABELS[step].toLowerCase()}`}
                        onClick={() => setStatus(r, step)}
                      />
                    </td>
                  ))}

                  <td className="px-2 py-2 text-center">
                    {status === "returned" ? (
                      <button
                        onClick={() => setStatus(r, "shipped")}
                        title="Undo — put it back to Shipped"
                        className="inline-flex items-center gap-1 text-[11px] text-rose-700 font-semibold hover:text-rose-900 transition-colors"
                      >
                        <span className="w-4 h-4 rounded border bg-rose-500 border-rose-500 inline-flex items-center justify-center">
                          <Check className="w-3 h-3 text-white" strokeWidth={3} />
                        </span>
                        <Undo2 className="w-3 h-3" />
                      </button>
                    ) : (
                      <Tick
                        on={false}
                        tone="bg-rose-500 border-rose-500"
                        disabled={!!busy}
                        title="Mark returned to us"
                        onClick={() => setStatus(r, "returned")}
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-neutral-400 px-4 py-2.5 border-t border-neutral-100">
        Click a box to mark that stage — it saves straight away. Clicking an
        earlier stage moves the parcel back.
      </p>
    </div>
  );
}

function Tick({
  on,
  muted,
  tone,
  disabled,
  title,
  onClick,
}: {
  on: boolean;
  muted?: boolean;
  tone: string;
  disabled?: boolean;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={on}
      className={`w-5 h-5 rounded border inline-flex items-center justify-center transition-all ${
        on
          ? muted
            ? "bg-neutral-300 border-neutral-300"
            : tone
          : "bg-white border-neutral-300 hover:border-neutral-500"
      } ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
    >
      {on && <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
    </button>
  );
}

function CopyButton({
  title,
  active,
  onClick,
}: {
  title: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex-shrink-0 p-1 rounded transition-colors ${
        active ? "text-green-600" : "text-neutral-300 hover:text-neutral-700 hover:bg-neutral-100"
      }`}
    >
      {active ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

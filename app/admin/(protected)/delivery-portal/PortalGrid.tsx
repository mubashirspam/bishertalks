"use client";

import { useState } from "react";
import { Check, Copy, Undo2 } from "lucide-react";
import {
  PORTAL_STATUS_STEPS,
  PORTAL_STEP_LABELS,
  PORTAL_STATUS_LABELS,
  ENTERED_LABEL,
  ENTERED_HINT,
  TRACKING_MAX,
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
  agentNames,
}: {
  rows: PortalRow[];
  startIndex: number;
  /** Staff id → name, for the Agent column. Covers agents since switched off. */
  agentNames: Record<string, string>;
}) {
  const [overrides, setOverrides] = useState<Record<string, OrderStatus>>({});
  const [entered, setEntered] = useState<Record<string, boolean>>({});
  const [tracking, setTracking] = useState<Record<string, string | null>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<string | null>(null);
  /** What's typed in each row's tracking box, before it's saved. */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  /**
   * A pending undo waiting on "yes, really".
   *
   * Only untick-ing asks. Ticking a stage forward is the whole job and has to
   * stay one click; taking one back means the parcel wasn't where the screen
   * said it was, which is worth a moment's thought — and on a dense grid of
   * small boxes it is an easy click to make by accident.
   */
  const [confirming, setConfirming] = useState<{
    title: string;
    body: string;
    run: () => void;
  } | null>(null);

  const statusOf = (row: PortalRow): OrderStatus => overrides[row.order_number] ?? row.status;

  /** `??` won't do here: a cleared tracking ID is a legitimate null override. */
  const trackingOf = (row: PortalRow): string | null =>
    row.order_number in tracking ? tracking[row.order_number] : row.tracking_number;

  /**
   * Has the address been keyed into the courier's system?
   *
   * The timestamp, and nothing else. This used to also infer it from the
   * status — a parcel at Packed must have been entered — which read fine and
   * counted as a lie: the tick said yes, /admin/delivery counted the column and
   * said no, and undo wrote NULL over a NULL that was already there, so nothing
   * moved. Migration 0021 gave those rows their real timestamp; the tick now
   * shows what is actually recorded, and undoing one changes it.
   *
   * Ticking a later stage still fills the column in — the API does it (see the
   * portal route) — so skipping the first box costs nothing.
   */
  const enteredOf = (row: PortalRow): boolean => {
    const local = entered[row.order_number];
    if (local !== undefined) return local;
    return !!row.courier_entered_at;
  };

  /**
   * Move a parcel to a stage, optionally carrying a tracking ID with it.
   *
   * The two travel in one request on purpose: the server writes the ID before
   * it messages the customer, so a parcel shipped with a tracking ID quotes it
   * in the "on its way" WhatsApp rather than a follow-up nobody sends.
   */
  async function setStatus(row: PortalRow, status: OrderStatus, trackingId?: string) {
    const previous = statusOf(row);
    const previousTracking = trackingOf(row);
    const withTracking = trackingId !== undefined;
    if (previous === status && !withTracking) return;

    setOverrides((o) => ({ ...o, [row.order_number]: status }));
    if (withTracking) {
      setTracking((t) => ({ ...t, [row.order_number]: trackingId || null }));
    }
    setSaving((s) => ({ ...s, [row.order_number]: true }));
    setError(null);

    try {
      const res = await fetch("/api/admin/delivery/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_number: row.order_number,
          status,
          ...(withTracking ? { tracking_number: trackingId } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Update failed (${res.status})`);
      }
    } catch (e) {
      // Put it back — a tick that silently didn't save is worse than no tick.
      setOverrides((o) => ({ ...o, [row.order_number]: previous }));
      if (withTracking) {
        setTracking((t) => ({ ...t, [row.order_number]: previousTracking }));
      }
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setSaving((s) => ({ ...s, [row.order_number]: false }));
    }
  }

  /** Tracking ID alone — for a parcel already gone out, or a corrected typo. */
  async function saveTracking(row: PortalRow, value: string) {
    const previous = trackingOf(row);
    if ((value || null) === (previous || null)) return;

    setTracking((t) => ({ ...t, [row.order_number]: value || null }));
    setSaving((s) => ({ ...s, [row.order_number]: true }));
    setError(null);

    try {
      const res = await fetch("/api/admin/delivery/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_number: row.order_number, tracking_number: value }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Update failed (${res.status})`);
      }
    } catch (e) {
      setTracking((t) => ({ ...t, [row.order_number]: previous }));
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setSaving((s) => ({ ...s, [row.order_number]: false }));
    }
  }

  /** What's in this row's box: what's been typed, else what's saved. */
  const draftOf = (row: PortalRow): string =>
    row.order_number in drafts ? drafts[row.order_number] : (trackingOf(row) ?? "");

  function submitTracking(row: PortalRow) {
    const value = draftOf(row).trim();
    setDrafts((d) => {
      const next = { ...d };
      delete next[row.order_number];
      return next;
    });

    // A tracking ID for a parcel that hasn't gone out yet means it is going out
    // now — that is where the number comes from. Ship it in the same call.
    if (reached(statusOf(row), "shipped")) {
      void saveTracking(row, value);
    } else if (value) {
      void setStatus(row, "shipped", value);
    }
  }

  /** Untick Confirmed — the address is no longer in the courier's system. */
  function askUndoEntered(row: PortalRow) {
    setConfirming({
      title: `Undo Confirmed on ${row.order_number}?`,
      body: "This says the address is no longer entered in the courier's system. The parcel stays where it is otherwise.",
      run: () => void toggleEntered(row),
    });
  }

  /** Untick Packed — or pull a parcel back from a later stage to Packed. */
  function askUndoStep(row: PortalRow, step: PortalStatusStep) {
    const current = statusOf(row);
    const backwards = current !== step;

    setConfirming({
      title: backwards
        ? `Move ${row.order_number} back to ${PORTAL_STEP_LABELS[step]}?`
        : `Undo ${PORTAL_STEP_LABELS[step]} on ${row.order_number}?`,
      body: backwards
        ? `This parcel is marked ${PORTAL_STATUS_LABELS[current] ?? current}. Moving it back says that was wrong.`
        : "The parcel goes back to Confirmed — packed no longer ticked.",
      run: () => void setStatus(row, backwards ? step : "confirmed"),
    });
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

      {/* portal-scroll (globals.css): a permanent, thick, draggable bar. The
          macOS overlay scrollbar fades out while you read, which on a table
          this wide hides the only clue that there are more columns. */}
      <div className="overflow-x-auto portal-scroll">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-neutral-50 border-b border-neutral-200 text-left">
              {["#", "Ordered", "Name", "Mobile", "Address", "Pincode", "Agent"].map((h) => (
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
                    {/* Loud, because packing one book into a three-book parcel
                        is a mistake nobody notices until the customer does. */}
                    {r.quantity > 1 && (
                      <span className="ml-1.5 inline-flex px-1.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold align-middle">
                        {r.quantity} books
                      </span>
                    )}
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

                  {/* Whose parcel. Constant down the page on an agent's own
                      screen, and the whole point of it on an owner's. */}
                  <td className={`${cell} whitespace-nowrap border-r border-neutral-100`}>
                    <span className="text-neutral-600">
                      {r.assigned_agent_id
                        ? (agentNames[r.assigned_agent_id] ?? "Removed agent")
                        : "—"}
                    </span>
                  </td>

                  <td className="px-2 py-2 text-center border-r border-neutral-100">
                    <Tick
                      on={enteredOf(r)}
                      tone="bg-blue-500 border-blue-500"
                      disabled={!!busy}
                      title={enteredOf(r) ? `Undo — ${ENTERED_LABEL}` : ENTERED_HINT}
                      onClick={() =>
                        enteredOf(r) ? askUndoEntered(r) : toggleEntered(r)
                      }
                    />
                  </td>

                  {PORTAL_STATUS_STEPS.map((step) => {
                    const on = reached(status, step);
                    // Packed and Confirmed ask before they come off; the two
                    // later stages don't, because moving a parcel back from
                    // Shipped is a correction someone came here to make.
                    const guarded = on && step === "processing";

                    return (
                      <td key={step} className="px-2 py-2 text-center border-r border-neutral-100">
                        <Tick
                          on={on}
                          muted={status === "returned"}
                          tone={STEP_TONE[step]}
                          disabled={!!busy}
                          title={
                            guarded
                              ? `Undo — ${PORTAL_STEP_LABELS[step]}`
                              : `Mark ${PORTAL_STEP_LABELS[step].toLowerCase()}`
                          }
                          onClick={() =>
                            guarded ? askUndoStep(r, step) : setStatus(r, step)
                          }
                        />

                        {/* Shipped is the one stage with a number attached to
                            it. Always on show, always optional: the tick above
                            still ships a parcel on its own, for the couriers
                            that give us nothing to type in here. */}
                        {step === "shipped" && (
                          <input
                            value={draftOf(r)}
                            onChange={(e) =>
                              setDrafts((d) => ({ ...d, [r.order_number]: e.target.value }))
                            }
                            onBlur={() => submitTracking(r)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") e.currentTarget.blur();
                              if (e.key === "Escape") {
                                setDrafts((d) => {
                                  const next = { ...d };
                                  delete next[r.order_number];
                                  return next;
                                });
                                e.currentTarget.blur();
                              }
                            }}
                            maxLength={TRACKING_MAX}
                            placeholder="Tracking ID"
                            title="Optional. Entering one on an unshipped parcel ships it and sends the customer the number."
                            className="mt-1.5 w-28 px-1.5 py-1 rounded border border-neutral-200 bg-neutral-50 font-mono text-[11px] text-center placeholder:font-sans placeholder:text-neutral-400 focus:outline-none focus:bg-white focus:border-purple-500 transition-colors"
                          />
                        )}
                      </td>
                    );
                  })}

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
        Click a box to mark that stage — it saves straight away. Clicking a
        ticked Confirmed or Packed asks before it undoes it. The tracking ID
        under Shipped is optional; entering one on a parcel that hasn&apos;t
        gone yet ships it and sends the customer the number with it.
      </p>

      {confirming && (
        <ConfirmDialog
          title={confirming.title}
          body={confirming.body}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            confirming.run();
            setConfirming(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * A yes/no on top of the grid.
 *
 * Deliberately not window.confirm: that blocks the whole tab, looks like a
 * browser warning rather than part of the screen, and on some phones is a
 * full-page takeover for a one-line question.
 */
function ConfirmDialog({
  title,
  body,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 px-4"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        className="bg-white rounded-2xl shadow-xl border border-neutral-200 max-w-sm w-full p-5"
      >
        <div className="flex items-start gap-3">
          <span className="flex-shrink-0 w-8 h-8 rounded-full bg-amber-50 text-amber-600 inline-flex items-center justify-center">
            <Undo2 className="w-4 h-4" />
          </span>
          <div>
            <h2 className="font-semibold text-sm text-neutral-900">{title}</h2>
            <p className="text-xs text-neutral-500 mt-1 leading-relaxed">{body}</p>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded-lg text-xs font-medium text-neutral-600 border border-neutral-200 hover:border-neutral-400 transition-colors"
          >
            Keep it
          </button>
          <button
            autoFocus
            onClick={onConfirm}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 transition-colors"
          >
            Undo it
          </button>
        </div>
      </div>
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

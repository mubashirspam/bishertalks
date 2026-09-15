"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Phone, MessageCircle, Clock, Copy, Check, History, PackageCheck, CheckCircle2,
  RotateCcw, X, AlertCircle, Truck,
} from "lucide-react";
import { formatIST, formatISTDate, formatISTShort, timeAgo } from "@/lib/format-date";
import { waLink, telLink } from "@/lib/wa-message";
import { deliveryStage, DELIVERY_SHORT, DELIVERY_BADGE } from "@/lib/delivery-stage";
import {
  CALL_OUTCOMES,
  CALL_STATUS_LABELS,
  CALL_STATUS_BADGE,
  CALL_FLAGS,
  CALL_FLAG_LABELS,
  CALL_FLAG_BADGE,
  remarkOf,
  type CallFlag,
  type CallStatus,
} from "@/lib/calls";
import type { CallAttempt, CallTask } from "@/lib/db/calls";
import OrderQuickPanel from "../tasks/OrderQuickPanel";

// Outside the component: they read the clock, which is fine in a helper and
// not something to do in a render body.
function isDue(iso: string | null): boolean {
  return !!iso && Date.parse(iso) <= Date.now();
}
function daysSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 864e5));
}
/** A Date as the value a datetime-local input wants, in the browser's zone. */
function toLocalInput(d: Date): string {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function quickTimes(): { label: string; value: string }[] {
  const now = new Date();
  const inHour = new Date(now.getTime() + 60 * 60 * 1000);
  const evening = new Date(now);
  evening.setHours(18, 0, 0, 0);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(10, 0, 0, 0);
  return [
    { label: "In 1 hour", value: toLocalInput(inHour) },
    ...(evening > now ? [{ label: "This evening", value: toLocalInput(evening) }] : []),
    { label: "Tomorrow 10am", value: toLocalInput(tomorrow) },
  ];
}

type Msg = { text: string; bad?: boolean };

export default function CallList({
  calls,
  staff,
  canManage,
  canDeliver,
  canViewOrders,
  canEditOrders,
}: {
  calls: CallTask[];
  staff: { id: string; name: string; email: string }[];
  canManage: boolean;
  canDeliver: boolean;
  canViewOrders: boolean;
  canEditOrders: boolean;
}) {
  const router = useRouter();
  const [, startRefresh] = useTransition();
  const refresh = useCallback(() => startRefresh(() => router.refresh()), [router]);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Record<string, Msg>>({});
  // The one call whose "how did it go" panel is open, and the outcome picked.
  const [logging, setLogging] = useState<{ id: string; outcome: CallStatus } | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [callbackDraft, setCallbackDraft] = useState("");
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [history, setHistory] = useState<CallAttempt[]>([]);
  const [orderSheet, setOrderSheet] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const staffName = new Map(staff.map((s) => [s.email, s.name]));

  const patch = async (id: string, body: Record<string, unknown>): Promise<boolean> => {
    setBusyId(id);
    setMsgs((m) => {
      const next = { ...m };
      delete next[id];
      return next;
    });
    try {
      const res = await fetch(`/api/admin/calls/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsgs((m) => ({ ...m, [id]: { text: json.error ?? "Something went wrong", bad: true } }));
        return false;
      }
      if (body.action === "deliver") {
        setMsgs((m) => ({
          ...m,
          [id]: { text: json.notified ? "Marked delivered — customer messaged on WhatsApp." : "Marked delivered." },
        }));
      }
      refresh();
      if (historyFor === id) void loadHistory(id);
      return true;
    } catch {
      setMsgs((m) => ({ ...m, [id]: { text: "Network error — try again", bad: true } }));
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const loadHistory = async (id: string) => {
    const json = await fetch(`/api/admin/calls/${id}`).then((r) => r.json()).catch(() => ({}));
    setHistory(Array.isArray(json.attempts) ? json.attempts : []);
  };

  const toggleHistory = (id: string) => {
    if (historyFor === id) {
      setHistoryFor(null);
      return;
    }
    setHistory([]);
    setHistoryFor(id);
    void loadHistory(id);
  };

  const openLog = (c: CallTask, outcome: CallStatus) => {
    setNoteDraft("");
    setCallbackDraft(
      outcome === "not_attended" || outcome === "switched_off" ? quickTimes()[0].value : ""
    );
    setLogging({ id: c.id, outcome });
  };

  const saveLog = async (c: CallTask) => {
    if (!logging) return;
    const ok = await patch(c.id, {
      action: "log",
      outcome: logging.outcome,
      note: noteDraft.trim() || null,
      callback_at: callbackDraft ? new Date(callbackDraft).toISOString() : null,
    });
    if (ok) setLogging(null);
  };

  const toggleFlag = (c: CallTask, f: CallFlag) => {
    const flags = c.flags.includes(f) ? c.flags.filter((x) => x !== f) : [...c.flags, f];
    void patch(c.id, { action: "update", flags });
  };

  const whatsapp = (c: CallTask) => {
    const o = c.order;
    if (!o?.buyer_phone) return;
    const name = o.buyer_name?.trim() || "";
    const track = `${window.location.origin}/neuro-code/track?id=${o.order_number}`;
    const text =
      `Hi ${name},\nThis is Bisher Talks customer care about your Neuro Code order (${o.order_number}).\n` +
      `We tried to reach you regarding your delivery. You can track it here: ${track}\n\nThank you`;
    window.open(waLink(o.buyer_phone, text), "_blank", "noopener,noreferrer");
  };

  if (!calls.length) {
    return (
      <p className="bg-white border border-neutral-200 rounded-2xl px-4 py-10 text-center text-sm text-neutral-400">
        No calls here. {canManage ? "Assign a list from Reports — filter the parcels, then Assign calls." : "Nothing assigned to you with these filters."}
      </p>
    );
  }

  const small = "px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors disabled:opacity-50";
  const field =
    "w-full bg-white border border-neutral-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-primary-500";

  return (
    <>
      <div className="space-y-3">
        {calls.map((c) => {
          const o = c.order;
          const stage = o ? deliveryStage(o) : null;
          const due = !c.done && isDue(c.callback_at);
          const remark = remarkOf(o?.courier_last_scan);
          const busy = busyId === c.id;
          const msg = msgs[c.id];
          const closed = stage === "delivered" || stage === "returned" || stage === "cancelled";

          return (
            <div
              key={c.id}
              className={`bg-white border rounded-2xl p-4 shadow-sm ${
                due ? "border-rose-300 ring-1 ring-rose-100" : "border-neutral-200"
              } ${c.done ? "opacity-75" : ""}`}
            >
              {/* Who, and where the parcel is */}
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="font-bold text-neutral-900">{o?.buyer_name || "No name"}</p>
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold border ${CALL_STATUS_BADGE[c.call_status]}`}>
                      {CALL_STATUS_LABELS[c.call_status]}
                    </span>
                    {c.flags.includes("urgent") && (
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold border ${CALL_FLAG_BADGE.urgent}`}>
                        URGENT
                      </span>
                    )}
                    {c.done && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border bg-neutral-50 text-neutral-500 border-neutral-200">
                        <CheckCircle2 className="w-3 h-3" /> Done
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1 text-xs text-neutral-500">
                    {canViewOrders ? (
                      <button
                        onClick={() => setOrderSheet(c.order_number)}
                        className="font-mono text-primary-600 hover:underline"
                      >
                        {c.order_number}
                      </button>
                    ) : (
                      <span className="font-mono">{c.order_number}</span>
                    )}
                    {stage && (
                      <span className={`inline-flex px-1.5 py-0.5 rounded-full border text-[10px] font-semibold ${DELIVERY_BADGE[stage]}`}>
                        {DELIVERY_SHORT[stage]}
                      </span>
                    )}
                    {o && <span>{[o.city || o.district, o.pincode].filter(Boolean).join(" · ")}</span>}
                    {o && <span>{daysSince(o.ordered_at)}d since order</span>}
                    {o && o.quantity > 1 && <span className="font-semibold text-amber-700">× {o.quantity}</span>}
                  </div>
                </div>

                {o?.buyer_phone && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={async () => {
                        await navigator.clipboard?.writeText(o.buyer_phone!);
                        setCopied(c.id);
                        setTimeout(() => setCopied(null), 1200);
                      }}
                      title="Copy number"
                      className="text-sm tabular-nums text-neutral-700 hover:text-neutral-900 flex items-center gap-1"
                    >
                      +91 {o.buyer_phone}
                      {copied === c.id ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5 text-neutral-400" />}
                    </button>
                    <a
                      href={telLink(o.buyer_phone)}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-primary-500 hover:bg-primary-600 text-white text-xs font-bold"
                    >
                      <Phone className="w-3.5 h-3.5" /> Call
                    </a>
                    <button
                      onClick={() => whatsapp(c)}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-green-50 hover:bg-green-100 text-green-700 border border-green-200 text-xs font-bold"
                    >
                      <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
                    </button>
                  </div>
                )}
              </div>

              {/* What the courier says */}
              {(remark || o?.tracking_number) && (
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs bg-neutral-50 border border-neutral-200 rounded-lg px-2.5 py-1.5">
                  <Truck className="w-3.5 h-3.5 text-neutral-400" />
                  {remark && (
                    <span className="text-neutral-800 font-medium" title={o?.courier_last_scan ?? ""}>
                      {remark}
                    </span>
                  )}
                  {o?.courier_last_scan_at && (
                    <span className="text-neutral-400">{timeAgo(o.courier_last_scan_at)}</span>
                  )}
                  {o?.tracking_number && (
                    <span className="font-mono text-neutral-500">{o.tracking_number}</span>
                  )}
                </div>
              )}

              {(c.note || c.callback_at) && (
                <div className="mt-2 space-y-1 text-xs">
                  {c.callback_at && !c.done && (
                    <p className={`flex items-center gap-1 font-medium ${due ? "text-rose-700" : "text-sky-700"}`}>
                      <Clock className="w-3.5 h-3.5" />
                      {due ? "Call back now — was due " : "Call back "}
                      {formatISTShort(c.callback_at)}
                    </p>
                  )}
                  {c.note && <p className="text-neutral-700 whitespace-pre-wrap">“{c.note}”</p>}
                </div>
              )}

              <p className="mt-2 text-[11px] text-neutral-400">
                {c.attempts
                  ? `${c.attempts} call${c.attempts === 1 ? "" : "s"} · last ${timeAgo(c.last_called_at!)} by ${
                      staffName.get(c.last_called_by_email ?? "") ?? c.last_called_by_email
                    }`
                  : "Not called yet"}
                {" · "}
                {canManage && (
                  <>assigned to {staffName.get(c.assigned_to_email ?? "") ?? c.assigned_to_email ?? "nobody"} </>
                )}
                on {formatISTDate(c.assigned_at)}
                {c.batch_label && ` · ${c.batch_label}`}
              </p>

              {/* Flags */}
              <div className="mt-3 flex flex-wrap gap-1.5">
                {CALL_FLAGS.map((f) => {
                  const on = c.flags.includes(f);
                  return (
                    <button
                      key={f}
                      disabled={busy}
                      onClick={() => toggleFlag(c, f)}
                      className={`px-2 py-1 rounded-full border text-[11px] font-medium transition-colors disabled:opacity-50 ${
                        on ? CALL_FLAG_BADGE[f] : "bg-white text-neutral-500 border-neutral-200 hover:border-neutral-400"
                      }`}
                    >
                      {CALL_FLAG_LABELS[f]}
                    </button>
                  );
                })}
              </div>

              {/* Log the call */}
              {!c.done && (
                <div className="mt-3 pt-3 border-t border-neutral-100">
                  {logging?.id === c.id ? (
                    <div className="bg-neutral-50 border border-neutral-200 rounded-xl p-3 space-y-2.5">
                      <p className="text-xs font-semibold text-neutral-700">
                        Log call: <span className="font-bold">{CALL_STATUS_LABELS[logging.outcome]}</span>
                      </p>
                      <textarea
                        autoFocus
                        rows={2}
                        value={noteDraft}
                        onChange={(e) => setNoteDraft(e.target.value)}
                        placeholder={
                          logging.outcome === "attended"
                            ? "What did they say? (e.g. not home till Friday, will collect from post office)"
                            : "Note (optional)"
                        }
                        className={field}
                      />
                      <div>
                        <label className="text-[11px] font-medium text-neutral-500 block mb-1">Call back at</label>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <input
                            type="datetime-local"
                            value={callbackDraft}
                            onChange={(e) => setCallbackDraft(e.target.value)}
                            className="bg-white border border-neutral-300 rounded-lg px-2 py-1 text-xs"
                          />
                          {quickTimes().map((t) => (
                            <button
                              key={t.label}
                              onClick={() => setCallbackDraft(t.value)}
                              className={`${small} bg-white border-neutral-200 text-neutral-600 hover:border-neutral-400`}
                            >
                              {t.label}
                            </button>
                          ))}
                          {callbackDraft && (
                            <button
                              onClick={() => setCallbackDraft("")}
                              className="text-[11px] text-neutral-500 hover:text-neutral-900"
                            >
                              No call back
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => void saveLog(c)}
                          disabled={busy}
                          className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-white text-xs font-bold disabled:opacity-50"
                        >
                          {busy ? "Saving…" : "Save call"}
                        </button>
                        <button
                          onClick={() => setLogging(null)}
                          className="px-3 py-1.5 rounded-lg border border-neutral-200 text-xs text-neutral-600"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] font-medium text-neutral-500 mr-1">After the call:</span>
                      {CALL_OUTCOMES.map((s) => (
                        <button
                          key={s}
                          disabled={busy}
                          onClick={() => openLog(c, s)}
                          className={`${small} ${CALL_STATUS_BADGE[s]} hover:brightness-95`}
                        >
                          {CALL_STATUS_LABELS[s]}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* The rest */}
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <button
                  onClick={() => toggleHistory(c.id)}
                  className={`${small} bg-white border-neutral-200 text-neutral-600 hover:border-neutral-400 flex items-center gap-1`}
                >
                  <History className="w-3.5 h-3.5" /> {historyFor === c.id ? "Hide history" : "History"}
                </button>

                {canDeliver && !closed && (
                  <button
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Mark ${c.order_number} delivered?\n\nOnly when the customer has confirmed they have the book. They'll get the delivered WhatsApp.`
                        )
                      ) {
                        void patch(c.id, { action: "deliver" });
                      }
                    }}
                    className={`${small} bg-green-600 border-green-600 text-white hover:bg-green-700 flex items-center gap-1`}
                  >
                    <PackageCheck className="w-3.5 h-3.5" /> Mark delivered
                  </button>
                )}

                {c.done ? (
                  <button
                    disabled={busy}
                    onClick={() => void patch(c.id, { action: "reopen" })}
                    className={`${small} bg-white border-neutral-200 text-neutral-600 hover:border-neutral-400 flex items-center gap-1`}
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> Reopen
                  </button>
                ) : (
                  <button
                    disabled={busy}
                    onClick={() => void patch(c.id, { action: "done" })}
                    className={`${small} bg-white border-neutral-300 text-neutral-800 hover:border-neutral-500 flex items-center gap-1`}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" /> Done
                  </button>
                )}

                {canManage && (
                  <select
                    value={c.assigned_to_id ?? ""}
                    disabled={busy}
                    onChange={(e) => void patch(c.id, { action: "reassign", staff_id: e.target.value || null })}
                    className="ml-auto bg-white border border-neutral-200 rounded-lg px-2 py-1.5 text-xs text-neutral-700 cursor-pointer"
                    title="Move this call to someone else"
                  >
                    <option value="">Unassigned</option>
                    {staff.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {msg && (
                <p className={`mt-2 flex items-center gap-1 text-xs ${msg.bad ? "text-red-600" : "text-green-700"}`}>
                  {msg.bad && <AlertCircle className="w-3.5 h-3.5" />}
                  {msg.text}
                </p>
              )}

              {historyFor === c.id && (
                <ul className="mt-3 pt-3 border-t border-neutral-100 space-y-2">
                  {history.length === 0 ? (
                    <li className="text-xs text-neutral-400">No calls logged yet.</li>
                  ) : (
                    history.map((h) => (
                      <li key={h.id} className="flex items-start gap-2 text-xs">
                        <span className={`mt-0.5 inline-flex px-1.5 py-0.5 rounded-full border text-[10px] font-semibold ${CALL_STATUS_BADGE[h.outcome] ?? ""}`}>
                          {CALL_STATUS_LABELS[h.outcome] ?? h.outcome}
                        </span>
                        <div className="min-w-0">
                          {h.note && <p className="text-neutral-700">{h.note}</p>}
                          <p className="text-neutral-400">
                            {staffName.get(h.staff_email) ?? h.staff_email} · {formatIST(h.created_at)}
                            {h.callback_at && ` · call back ${formatISTShort(h.callback_at)}`}
                          </p>
                        </div>
                      </li>
                    ))
                  )}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {orderSheet && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-neutral-900/20" onClick={() => setOrderSheet(null)} />
          <aside className="absolute inset-y-0 right-0 w-full max-w-xl bg-neutral-50 shadow-2xl border-l border-neutral-200 flex flex-col">
            <header className="flex items-center justify-between px-4 py-3 bg-white border-b border-neutral-200">
              <span className="text-sm font-semibold text-neutral-700">Order</span>
              <button
                onClick={() => setOrderSheet(null)}
                className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-neutral-500 hover:bg-neutral-100"
              >
                <X className="w-4 h-4" />
              </button>
            </header>
            <div className="flex-1 overflow-y-auto p-4">
              <OrderQuickPanel key={orderSheet} orderNumber={orderSheet} canEdit={canEditOrders} />
            </div>
          </aside>
        </div>
      )}
    </>
  );
}

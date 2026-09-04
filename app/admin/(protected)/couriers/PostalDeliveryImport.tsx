"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Upload, Loader2, Check, AlertTriangle, X, FileSpreadsheet, MessageCircle,
} from "lucide-react";

/**
 * Reconciling India Post's tracking report against our parcels.
 *
 * Speed Post has no reachable API, so a posted parcel goes quiet the moment it
 * leaves the counter and sits at "Handed over" until somebody ticks it off.
 * Nobody ticks off two thousand parcels, so the delivery queue fills with work
 * that is already done and the reports screen counts it all as late. Their
 * portal exports the scans as a spreadsheet; this is where that file gets
 * turned back into order statuses.
 *
 * Always previews first. The file can move a thousand orders to delivered in
 * one click, and delivered settles referral commissions — so it must not be
 * able to do that without somebody having read what it is about to do.
 *
 * The .xlsx goes up as-is. This screen deliberately does not ask anyone to
 * re-save it as CSV first: it is a machine-generated file that arrives from
 * their portal already in this format, and a conversion step every week is how
 * a reconciliation quietly stops happening.
 */

interface PlanRow {
  order_number: string;
  buyer_name: string | null;
  article: string | null;
  matched_on: "article" | "waybill" | "reference";
  scan: string;
  at: string | null;
  from_status: string;
  to_status: string | null;
  fills_tracking: boolean;
  corrects_date: { from: string; to: string } | null;
}

interface HeldRow {
  key: string;
  why: string;
}

interface Result {
  fileRows: number;
  parcels: number;
  superseded: number;
  kinds: Record<string, number>;
  matched: number;
  willMove: number;
  unchanged: number;
  moves: Record<string, number>;
  willFillTracking: number;
  willCorrectDates: number;
  unmatched: number;
  held: number;
  plan?: PlanRow[];
  unmatchedRows?: HeldRow[];
  heldRows?: HeldRow[];
  /** Present only on the applied response. */
  scanned?: number;
  moved?: Record<string, number>;
  datesCorrected?: number;
  notified?: number;
}

const MATCHED_ON: Record<PlanRow["matched_on"], string> = {
  article: "article number",
  waybill: "waybill",
  reference: "our reference",
};

/** Our statuses, in the words the rest of the admin uses. */
const STATUS_WORD: Record<string, string> = {
  confirmed: "Confirmed",
  processing: "Packed",
  shipped: "Shipped",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  returned: "Returned",
  cancelled: "Cancelled",
};

/** India Post's event kinds, said in words rather than in their vocabulary. */
const KIND_WORD: Record<string, string> = {
  booked: "Booked at the counter",
  in_transit: "Moving through the post",
  out_for_delivery: "Out for delivery",
  delivered_to_addressee: "Delivered",
  delivered_to_sender: "Came back to us",
  returning: "On its way back",
  delivered_unknown_direction: "Delivered — direction unclear",
  unknown: "Not recognised",
};

const STATUS_TONE: Record<string, string> = {
  shipped: "text-purple-700",
  out_for_delivery: "text-amber-700",
  delivered: "text-green-700",
  returned: "text-rose-600",
};

/** "3 Sep, 12:02 pm" — the courier's own event time, in IST. */
function when(iso: string | null): string {
  if (!iso) return "no date";
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export default function PostalDeliveryImport({ courierName }: { courierName: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Result | null>(null);
  const [applied, setApplied] = useState<Result | null>(null);
  // Off by default and deliberately so — see the note in the route. A backfill
  // of last week's deliveries has no business messaging a thousand people.
  const [notify, setNotify] = useState(false);

  const reset = () => {
    setFile(null);
    setPreview(null);
    setError(null);
    setNotify(false);
    if (input.current) input.current.value = "";
  };

  const send = async (apply: boolean) => {
    if (!file) return;

    setBusy(apply ? "apply" : "preview");
    setError(null);

    try {
      const body = new FormData();
      body.set("file", file);
      body.set("apply", String(apply));
      body.set("notify", String(apply && notify));

      const res = await fetch("/api/admin/delivery/postal-import", {
        method: "POST",
        body,
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || data.error) {
        setError(data.error ?? "Could not read that file.");
        setPreview(null);
        return;
      }

      if (apply) {
        setApplied(data as Result);
        reset();
        router.refresh();
      } else {
        setPreview(data as Result);
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(null);
    }
  };

  /** Delivered customers are the only ones a message would go to. */
  const wouldMessage = (preview?.moves?.delivered ?? 0) + (preview?.moves?.shipped ?? 0);

  return (
    <div className="mt-4 rounded-xl border border-neutral-200 bg-neutral-50/70 p-4">
      <div className="flex items-start gap-2 mb-2">
        <FileSpreadsheet className="w-4 h-4 text-neutral-500 mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p className="text-xs font-medium text-neutral-700">
            Update parcels from their tracking report
          </p>
          <p className="text-[11px] text-neutral-500 mt-0.5 leading-relaxed">
            {courierName} tells us nothing after a parcel is posted, so these sit
            at &ldquo;Handed over&rdquo; forever. Download the report from their
            portal and upload it here. Every parcel it names gets its latest
            scan, and any that has moved past where we had it is brought up to
            date on the day it actually happened.
          </p>
        </div>
      </div>

      {/* ── Pick a file ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 mt-3">
        <input
          ref={input}
          type="file"
          accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            setFile(f);
            setPreview(null);
            setApplied(null);
            setError(null);
          }}
          className="text-[11px] text-neutral-600 file:mr-2 file:rounded-lg file:border file:border-neutral-300 file:bg-white file:px-2.5 file:py-1.5 file:text-[11px] file:font-medium file:text-neutral-700 hover:file:border-neutral-400"
        />

        {file && !preview && (
          <button
            onClick={() => send(false)}
            disabled={busy !== null}
            className="flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {busy === "preview" ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Upload className="w-3 h-3" />
            )}
            Check the file
          </button>
        )}

        {(file || preview) && (
          <button
            onClick={reset}
            className="flex items-center gap-1 text-[11px] text-neutral-500 hover:text-neutral-900"
          >
            <X className="w-3 h-3" /> Clear
          </button>
        )}
      </div>

      {error && (
        <p className="mt-2.5 flex items-start gap-1.5 rounded-lg bg-red-50 px-2.5 py-2 text-[11px] text-red-700">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
          <span>{error}</span>
        </p>
      )}

      {/* ── What happened, after applying ───────────────────────────────── */}
      {applied && (
        <div className="mt-2.5 rounded-lg bg-green-50 px-2.5 py-2 text-[11px] text-green-800">
          <p className="flex items-center gap-1.5 font-semibold">
            <Check className="w-3.5 h-3.5" />
            {applied.scanned ?? 0} parcels updated from their report
          </p>
          <p className="mt-0.5 text-green-700">
            {Object.entries(applied.moved ?? {}).length
              ? Object.entries(applied.moved ?? {})
                  .map(([k, v]) => `${v} → ${STATUS_WORD[k] ?? k}`)
                  .join(", ")
              : "No parcel needed its status changed."}
            {applied.datesCorrected
              ? ` ${applied.datesCorrected} delivery date${applied.datesCorrected === 1 ? " was" : "s were"} moved back to the day India Post delivered.`
              : ""}
            {applied.notified
              ? ` ${applied.notified} customers were messaged.`
              : " No customers were messaged."}
            {applied.unmatched
              ? ` ${applied.unmatched} rows matched no parcel here.`
              : ""}
          </p>
        </div>
      )}

      {/* ── The plan ────────────────────────────────────────────────────── */}
      {preview && (
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Figure label="Parcels in file" value={preview.parcels} />
            <Figure label="Found here" value={preview.matched} />
            <Figure
              label="Status will move"
              value={preview.willMove}
              tone={preview.willMove ? "good" : undefined}
            />
            <Figure label="Scan only" value={preview.unchanged} />
            {!!preview.willCorrectDates && (
              <Figure
                label="Delivery date wrong"
                value={preview.willCorrectDates}
                tone="good"
              />
            )}
          </div>

          {/* Where their parcels actually are, in their words. The reason to
              upload a full report rather than only the deliveries: this is the
              line that says how much is still on the road. */}
          {!!Object.keys(preview.kinds).length && (
            <div className="rounded-xl border border-neutral-200 bg-white p-2.5">
              <p className="text-[11px] font-medium text-neutral-700 mb-1.5">
                Where {courierName} says they are
              </p>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(preview.kinds)
                  .sort((a, b) => b[1] - a[1])
                  .map(([kind, n]) => (
                    <span
                      key={kind}
                      className="rounded-lg border border-neutral-200 bg-neutral-50 px-2 py-1 text-[11px] text-neutral-700"
                    >
                      {KIND_WORD[kind] ?? kind}{" "}
                      <strong className="text-neutral-900">{n.toLocaleString("en-IN")}</strong>
                    </span>
                  ))}
              </div>
            </div>
          )}

          {/* What the button will actually do, per status. */}
          {!!preview.willMove && (
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(preview.moves)
                .sort((a, b) => b[1] - a[1])
                .map(([status, n]) => (
                  <span
                    key={status}
                    className={`rounded-lg border border-neutral-200 bg-white px-2 py-1 text-[11px] font-medium ${
                      STATUS_TONE[status] ?? "text-neutral-700"
                    }`}
                  >
                    {n.toLocaleString("en-IN")} → {STATUS_WORD[status] ?? status}
                  </span>
                ))}
            </div>
          )}

          {preview.superseded > 0 && (
            <p className="text-[11px] text-neutral-500">
              {preview.fileRows} rows in that file cover {preview.parcels}{" "}
              parcels — only each parcel&apos;s latest event is used.
            </p>
          )}

          {preview.willFillTracking > 0 && (
            <p className="text-[11px] text-neutral-500">
              {preview.willFillTracking} parcels have no tracking number here
              yet and will get theirs from this file, so the customer&apos;s
              tracking page starts working.
            </p>
          )}

          {/* Rows needing a person. Shown before the plan, because these are
              the ones that will still be wrong after the button is pressed. */}
          {!!preview.held && (
            <Trouble
              tone="amber"
              title={`${preview.held} need checking by hand`}
              rows={preview.heldRows ?? []}
            />
          )}
          {!!preview.unmatched && (
            <Trouble
              tone="neutral"
              title={`${preview.unmatched} rows match no parcel here`}
              hint="Usually post booked on the same contract that did not come from this shop, or a parcel sent before article numbers were recorded."
              rows={preview.unmatchedRows ?? []}
            />
          )}

          {preview.matched > 0 ? (
            <>
              <div className="rounded-xl border border-neutral-200 bg-white p-3">
                <p className="text-[11px] font-medium text-neutral-700 mb-1.5">
                  What will change
                  {preview.matched > (preview.plan?.length ?? 0) && (
                    <span className="font-normal text-neutral-400">
                      {" "}
                      — the {preview.plan?.length} most significant of {preview.matched}
                    </span>
                  )}
                </p>
                <div className="max-h-60 overflow-y-auto">
                  <table className="w-full text-[11px]">
                    <tbody>
                      {(preview.plan ?? []).map((p) => (
                        <tr key={p.order_number} className="border-b border-neutral-100 last:border-0">
                          <td className="py-1 pr-2 font-mono text-neutral-900 whitespace-nowrap align-top">
                            {p.order_number}
                          </td>
                          <td className="py-1 pr-2 text-neutral-600 truncate max-w-[9rem] align-top">
                            {p.buyer_name ?? "—"}
                          </td>
                          <td className="py-1 pr-2 whitespace-nowrap align-top">
                            {p.to_status ? (
                              <>
                                <span className="text-neutral-400">
                                  {STATUS_WORD[p.from_status] ?? p.from_status} →{" "}
                                </span>
                                <span
                                  className={`font-semibold ${STATUS_TONE[p.to_status] ?? "text-neutral-700"}`}
                                >
                                  {STATUS_WORD[p.to_status] ?? p.to_status}
                                </span>
                              </>
                            ) : p.corrects_date ? (
                              <span className="font-semibold text-amber-700 whitespace-nowrap">
                                delivery date fixed
                              </span>
                            ) : (
                              <span className="text-neutral-400">scan only</span>
                            )}
                          </td>
                          <td
                            className="py-1 pr-2 text-neutral-600 align-top max-w-[16rem] truncate"
                            title={`${p.scan}${p.article ? ` · ${p.article}` : ""} · matched on ${MATCHED_ON[p.matched_on]}`}
                          >
                            {p.scan}
                          </td>
                          <td className="py-1 text-neutral-500 whitespace-nowrap align-top">
                            {when(p.at)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* ── The one decision worth pausing on ──────────────────────
                  Marking a parcel shipped or delivered normally messages the
                  customer. For a week-old event that message is stale, and a
                  thousand at once is the kind of send that costs a business
                  number its rating. So it is off unless it is ticked, and the
                  tick says how many people it would reach. */}
              {wouldMessage > 0 && (
                <label className="flex items-start gap-2 rounded-xl border border-neutral-200 bg-white p-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={notify}
                    onChange={(e) => setNotify(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span className="text-[11px] leading-relaxed">
                    <span className="font-medium text-neutral-700 flex items-center gap-1">
                      <MessageCircle className="w-3 h-3" />
                      Message {wouldMessage} customers about these parcels
                    </span>
                    <span className="block text-neutral-500 mt-0.5">
                      Off by default. These events happened days ago, so the
                      message arrives late — and sending hundreds at once is
                      what damages a WhatsApp number&apos;s rating.
                    </span>
                  </span>
                </label>
              )}

              <button
                onClick={() => send(true)}
                disabled={busy !== null}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-green-600 px-3 py-2 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50"
              >
                {busy === "apply" ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Check className="w-3.5 h-3.5" />
                )}
                Update {preview.matched} parcels
                {preview.willMove ? `, moving ${preview.willMove}` : ""}
                {notify && wouldMessage ? ` and messaging ${wouldMessage}` : ""}
              </button>
            </>
          ) : (
            <p className="rounded-lg bg-neutral-100 px-2.5 py-2 text-[11px] text-neutral-600">
              None of the {preview.parcels} parcels in that file match anything
              here.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Figure({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "good" | "bad";
}) {
  const colour =
    tone === "good" ? "text-green-700" : tone === "bad" ? "text-rose-600" : "text-neutral-900";
  return (
    <div className="rounded-xl border border-neutral-200 bg-white px-2.5 py-2">
      <p className={`text-base font-black ${colour}`}>{value.toLocaleString("en-IN")}</p>
      <p className="text-[10px] uppercase tracking-wider text-neutral-500 mt-0.5">{label}</p>
    </div>
  );
}

/** A collapsed list of rows that will not be applied, and why. */
function Trouble({
  tone,
  title,
  hint,
  rows,
}: {
  tone: "amber" | "neutral";
  title: string;
  hint?: string;
  rows: HeldRow[];
}) {
  const [open, setOpen] = useState(false);
  const skin =
    tone === "amber"
      ? "border-amber-300 bg-amber-50 text-amber-900"
      : "border-neutral-200 bg-white text-neutral-700";

  return (
    <div className={`rounded-xl border p-2.5 text-[11px] ${skin}`}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left font-medium"
      >
        <span className="flex items-center gap-1.5">
          {tone === "amber" && <AlertTriangle className="w-3.5 h-3.5 shrink-0" />}
          {title}
        </span>
        <span className="text-neutral-400">{open ? "hide" : "show"}</span>
      </button>

      {hint && <p className="mt-1 opacity-80">{hint}</p>}

      {open && (
        <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
          {rows.map((r, i) => (
            <li key={`${r.key}-${i}`} className="flex gap-2">
              <span className="font-mono shrink-0">{r.key}</span>
              <span className="opacity-80">{r.why}</span>
            </li>
          ))}
          {!rows.length && <li className="opacity-60">Nothing to list.</li>}
        </ul>
      )}
    </div>
  );
}

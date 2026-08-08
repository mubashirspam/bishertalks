"use client";

import React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import {
  Printer, Check, RotateCcw, X, AlertCircle, Phone, MessageCircle, Info, ChevronDown, ChevronUp,
} from "lucide-react";
import {
  deliveryStage,
  DELIVERY_SHORT,
  DELIVERY_BADGE,
  BULK_STATUSES,
} from "@/lib/delivery-stage";
import { STATUS_LABELS, type OrderStatus } from "@/lib/types/order";
import { formatISTShort, timeAgo } from "@/lib/format-date";
import { deliveryWaMessage, waLink, telLink } from "@/lib/wa-message";
import type { DeliveryRow } from "@/lib/db/delivery-query";

/** Mirrors lib/shipping-label.ts — duplicated rather than imported so the PDF
 *  writer doesn't get bundled into the browser for one number. */
const LABELS_PER_PAGE = 6;

/** Mirrors MAX_LABELS in the labels route. */
const MAX_LABELS = 300;

/**
 * The delivery worklist.
 *
 * Selection is the unit of work here: tick some rows (or the header box for
 * the whole page), then print, ship, or correct them in one go. With nothing
 * ticked the toolbar offers the common case instead — print everything the
 * current filters match, which is how a day's post actually gets done.
 */
export default function DeliveryTable({
  rows,
  matching,
}: {
  rows: DeliveryRow[];
  matching: number;
}) {
  const router = useRouter();
  const params = useSearchParams();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<OrderStatus>("shipped");
  const [courier, setCourier] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; bad?: boolean } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleExpanded = (n: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });

  const ids = [...selected];
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.order_number));

  const toggle = (n: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });

  const toggleAll = () =>
    setSelected(allOnPage ? new Set() : new Set(rows.map((r) => r.order_number)));

  const done = (text: string, bad?: boolean) => {
    setMessage({ text, bad });
    setBusy(null);
    if (!bad) setSelected(new Set());
    router.refresh();
  };

  /** Ask for the label PDF and hand it to the browser as a download. */
  const printLabels = async (scope: "selected" | "filtered") => {
    setBusy("print");
    setMessage(null);

    const body =
      scope === "selected"
        ? { order_numbers: ids }
        : { filters: Object.fromEntries(params.entries()) };

    try {
      const res = await fetch("/api/admin/delivery/labels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "Failed" }));
        return done(error ?? "Could not build labels", true);
      }

      const count = Number(res.headers.get("X-Label-Count") ?? 0);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download =
        res.headers.get("Content-Disposition")?.match(/filename="(.+?)"/)?.[1] ??
        "labels.pdf";
      a.click();
      URL.revokeObjectURL(url);

      done(
        `${count} label${count === 1 ? "" : "s"} downloaded — marked as printed.`
      );
    } catch {
      done("Download failed — check your connection and try again.", true);
    }
  };

  const bulk = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(action);
    setMessage(null);

    try {
      const res = await fetch("/api/admin/delivery/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, order_numbers: ids, ...extra }),
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok) return done(json.error ?? "Update failed", true);

      done(
        `${json.updated} order${json.updated === 1 ? "" : "s"} updated` +
          (json.notified ? ` · ${json.notified} notified on WhatsApp` : "")
      );
    } catch {
      done("Update failed — check your connection and try again.", true);
    }
  };

  const btn =
    "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50";

  // A run is capped server-side; say so rather than promising more than the
  // PDF will contain.
  const printAllCount = Math.min(matching, MAX_LABELS);
  const sheets = Math.ceil(printAllCount / LABELS_PER_PAGE);
  const printAllLabel =
    `Print ${printAllCount < matching ? `first ${printAllCount}` : `all ${matching}`} ` +
    `label${printAllCount === 1 ? "" : "s"} (${sheets} sheet${sheets === 1 ? "" : "s"})`;

  return (
    <div>
      {/* ── Action bar ───────────────────────────────────────────────────── */}
      <div className="bg-white border border-neutral-200 rounded-2xl p-3 shadow-sm mb-4 flex flex-wrap items-center gap-2">
        {ids.length === 0 ? (
          <>
            <p className="text-xs text-neutral-500 mr-auto">
              {matching} order{matching === 1 ? "" : "s"} in this view · tick rows
              to act on them
            </p>
            <button
              onClick={() => printLabels("filtered")}
              disabled={!matching || !!busy}
              className={`${btn} bg-primary-500 text-white hover:bg-primary-600`}
            >
              <Printer className="w-3.5 h-3.5" />
              {busy === "print" ? "Building PDF…" : printAllLabel}
            </button>
          </>
        ) : (
          <>
            <p className="text-xs font-semibold text-neutral-900 mr-1">
              {ids.length} selected
            </p>
            <button
              onClick={() => setSelected(new Set())}
              className="text-xs text-neutral-500 hover:text-neutral-900 mr-auto flex items-center gap-1"
            >
              <X className="w-3 h-3" /> Clear
            </button>

            <button
              onClick={() => printLabels("selected")}
              disabled={!!busy}
              className={`${btn} bg-primary-500 text-white hover:bg-primary-600`}
            >
              <Printer className="w-3.5 h-3.5" />
              {busy === "print" ? "Building PDF…" : "Print labels"}
            </button>

            <div className="flex items-center gap-1.5 border-l border-neutral-200 pl-2 ml-1">
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as OrderStatus)}
                className="bg-white border border-neutral-300 rounded-lg px-2 py-1.5 text-xs cursor-pointer focus:outline-none focus:border-primary-500"
              >
                {BULK_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
              {/* Only useful when handing a batch to a courier. */}
              {(status === "shipped" || status === "out_for_delivery") && (
                <input
                  value={courier}
                  onChange={(e) => setCourier(e.target.value)}
                  placeholder="Courier (optional)"
                  className="bg-white border border-neutral-300 rounded-lg px-2 py-1.5 text-xs w-32 focus:outline-none focus:border-primary-500"
                />
              )}
              <button
                onClick={() => bulk("status", { status, courier_name: courier })}
                disabled={!!busy}
                className={`${btn} bg-neutral-900 text-white hover:bg-neutral-700`}
              >
                <Check className="w-3.5 h-3.5" />
                {busy === "status" ? "Saving…" : "Apply"}
              </button>
            </div>

            <button
              onClick={() => bulk("mark_printed")}
              disabled={!!busy}
              className={`${btn} border border-neutral-200 text-neutral-600 hover:border-neutral-400`}
              title="Mark as printed without downloading a PDF"
            >
              <Check className="w-3.5 h-3.5" /> Mark printed
            </button>
            <button
              onClick={() => bulk("unmark_printed")}
              disabled={!!busy}
              className={`${btn} border border-neutral-200 text-neutral-600 hover:border-neutral-400`}
              title="Undo — for labels that printed badly"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Undo print
            </button>
          </>
        )}
      </div>

      {message && (
        <div
          className={`flex items-start gap-2 rounded-xl px-4 py-2.5 mb-4 text-sm border ${
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

      {/* ── Rows ─────────────────────────────────────────────────────────── */}
      {!rows.length ? (
        <div className="bg-white border border-neutral-200 rounded-2xl p-12 text-center text-neutral-500 shadow-sm">
          Nothing to deliver here.
        </div>
      ) : (
        <div className="bg-white border border-neutral-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left bg-neutral-50">
                  <th className="px-3 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={allOnPage}
                      onChange={toggleAll}
                      aria-label="Select all on this page"
                      className="w-4 h-4 rounded border-neutral-300 cursor-pointer accent-primary-500"
                    />
                  </th>
                  {["Order", "Deliver to", "Stage", "Label", "Ordered"].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => {
                  const s = deliveryStage(o);
                  const checked = selected.has(o.order_number);
                  return (
                    <React.Fragment key={o.id}>
                    <tr
                      className={`border-b border-neutral-100 last:border-0 transition-colors ${
                        checked ? "bg-primary-50/40" : "hover:bg-neutral-50"
                      }`}
                    >
                      <td className="px-3 py-3">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(o.order_number)}
                          aria-label={`Select ${o.order_number}`}
                          className="w-4 h-4 rounded border-neutral-300 cursor-pointer accent-primary-500"
                        />
                      </td>
                      <td className="px-4 py-3 align-top">
                        <Link
                          href={`/admin/orders/${o.order_number}`}
                          className="font-mono text-primary-600 hover:text-primary-700 text-xs font-medium"
                        >
                          {o.order_number}
                        </Link>
                        {o.tracking_number && (
                          <p className="text-neutral-400 text-[11px] mt-0.5 font-mono">
                            {o.courier_name ? `${o.courier_name} · ` : ""}
                            {o.tracking_number}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top max-w-xs">
                        <div className="flex items-center gap-1.5">
                          <p className="text-neutral-900 font-medium">
                            {o.buyer_name ?? "—"}
                          </p>
                          <button
                            onClick={() => toggleExpanded(o.order_number)}
                            title={expanded.has(o.order_number) ? "Hide address" : "Show address"}
                            className="inline-flex items-center justify-center w-5 h-5 rounded-full text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors"
                          >
                            {expanded.has(o.order_number) ? (
                              <ChevronUp className="w-3.5 h-3.5" />
                            ) : (
                              <Info className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                        <p className="text-neutral-500 text-xs mt-0.5 flex items-center gap-1.5">
                          <span>{o.buyer_phone ?? "—"}</span>
                          {o.buyer_phone && (
                            <span className="inline-flex items-center gap-1">
                              <a
                                href={telLink(o.buyer_phone)}
                                title="Call"
                                className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-neutral-100 text-neutral-600 hover:bg-neutral-200 transition-colors"
                              >
                                <Phone className="w-3 h-3" />
                              </a>
                              <a
                                href={waLink(o.buyer_phone, deliveryWaMessage(o))}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="WhatsApp"
                                className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-green-50 text-green-600 hover:bg-green-100 transition-colors"
                              >
                                <MessageCircle className="w-3 h-3" />
                              </a>
                            </span>
                          )}
                        </p>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <span
                          className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium border whitespace-nowrap ${DELIVERY_BADGE[s]}`}
                        >
                          {DELIVERY_SHORT[s]}
                        </span>
                      </td>
                      <td className="px-4 py-3 align-top text-xs whitespace-nowrap">
                        {o.label_downloaded_at ? (
                          <>
                            <p className="text-neutral-700">
                              {formatISTShort(o.label_downloaded_at)}
                            </p>
                            {o.label_download_count > 1 && (
                              <p className="text-amber-600 text-[11px] mt-0.5">
                                printed {o.label_download_count}×
                              </p>
                            )}
                          </>
                        ) : (
                          <span className="text-orange-600 font-medium">
                            Not printed
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top text-xs whitespace-nowrap">
                        <p className="text-neutral-700 font-medium">
                          {formatISTShort(o.created_at)}
                        </p>
                        <p className="text-neutral-400 mt-0.5">{timeAgo(o.created_at)}</p>
                      </td>
                    </tr>
                    {expanded.has(o.order_number) && (
                      <tr className="bg-neutral-50 border-b border-neutral-100 last:border-0">
                        <td />
                        <td colSpan={5} className="px-4 py-3 text-xs text-neutral-600 leading-relaxed">
                          <p>
                            {[o.address_line1, o.address_line2, o.city, o.district]
                              .filter(Boolean)
                              .join(", ")}
                          </p>
                          <p className="mt-0.5">
                            {o.state} — <span className="font-semibold">{o.pincode}</span>
                          </p>
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

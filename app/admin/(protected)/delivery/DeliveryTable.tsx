"use client";

import React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import {
  Printer, Check, X, AlertCircle, Phone, MessageCircle, Info, ChevronUp, UserPlus, UserMinus,
} from "lucide-react";
import {
  deliveryStage,
  DELIVERY_SHORT,
  DELIVERY_BADGE,
} from "@/lib/delivery-stage";
import { formatISTShort, timeAgo } from "@/lib/format-date";
import { deliveryWaMessage, waLink, telLink } from "@/lib/wa-message";
import type { DeliveryRow } from "@/lib/db/delivery-query";
import type { DeliveryAgent } from "@/lib/db/staff";

/** Mirrors lib/shipping-label.ts — duplicated rather than imported so the PDF
 *  writer doesn't get bundled into the browser for one number. */
const LABELS_PER_PAGE = 6;

/** Mirrors MAX_LABELS in the labels route. */
const MAX_LABELS = 300;

/**
 * The delivery worklist — an owner's view of every agent's parcels.
 *
 * Nothing here changes a parcel's status. Shipped and delivered are ticked off
 * in the portal by the agent actually holding the parcel, on the row in front
 * of them; a second place to mark the same thing meant two people guessing at
 * each other's work. What this screen does is decide *whose* parcel it is:
 * tick some rows, choose an agent, and they appear on that agent's portal.
 *
 * Printing labels does the same thing — you cannot print a sheet without
 * saying who is taking it, because a printed label belonging to nobody was
 * exactly the state that used to look "handled" and reach no one.
 */
export default function DeliveryTable({
  rows,
  matching,
  agents,
  agentNames,
}: {
  rows: DeliveryRow[];
  matching: number;
  /** Who parcels can be handed to — active staff with portal access. */
  agents: DeliveryAgent[];
  /** id → name for display, including agents since switched off. */
  agentNames: Record<string, string>;
}) {
  const router = useRouter();
  const params = useSearchParams();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [agentId, setAgentId] = useState("");
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

    const body = {
      agent_id: agentId,
      ...(scope === "selected"
        ? { order_numbers: ids }
        : { filters: Object.fromEntries(params.entries()) }),
    };

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
        `${count} label${count === 1 ? "" : "s"} downloaded — assigned to ${agentName}.`
      );
    } catch {
      done("Download failed — check your connection and try again.", true);
    }
  };

  /** Hand the ticked parcels to an agent, or take them back with null. */
  const assign = async (to: string | null) => {
    setBusy(to ? "assign" : "unassign");
    setMessage(null);

    try {
      const res = await fetch("/api/admin/delivery/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_numbers: ids, agent_id: to }),
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok) return done(json.error ?? "Assignment failed", true);

      done(
        to
          ? `${json.updated} parcel${json.updated === 1 ? "" : "s"} assigned to ${json.agent_name} — now on their portal.`
          : `${json.updated} parcel${json.updated === 1 ? "" : "s"} moved back to New.`
      );
    } catch {
      done("Assignment failed — check your connection and try again.", true);
    }
  };

  const agentName = agents.find((a) => a.id === agentId)?.name ?? "";
  const noAgent = !agentId;

  const btn =
    "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

  // A run is capped server-side; say so rather than promising more than the
  // PDF will contain.
  const printAllCount = Math.min(matching, MAX_LABELS);
  const sheets = Math.ceil(printAllCount / LABELS_PER_PAGE);
  const printAllLabel =
    `Print ${printAllCount < matching ? `first ${printAllCount}` : `all ${matching}`} ` +
    `label${printAllCount === 1 ? "" : "s"} (${sheets} sheet${sheets === 1 ? "" : "s"})`;

  /** The one control both actions read — printing and assigning are the same
   *  decision made two ways, so there is one place to make it. */
  const agentPicker = (
    <select
      value={agentId}
      onChange={(e) => setAgentId(e.target.value)}
      className="bg-white border border-neutral-300 rounded-lg px-2 py-1.5 text-xs cursor-pointer focus:outline-none focus:border-primary-500"
    >
      <option value="">Choose delivery agent…</option>
      {agents.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
        </option>
      ))}
    </select>
  );

  return (
    <div>
      {/* ── Action bar ───────────────────────────────────────────────────── */}
      <div className="bg-white border border-neutral-200 rounded-2xl p-3 shadow-sm mb-4 flex flex-wrap items-center gap-2">
        {!agents.length ? (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            No delivery agents yet — add one under{" "}
            <Link href="/admin/staff" className="underline font-semibold">
              Staff
            </Link>{" "}
            with portal access before assigning parcels.
          </p>
        ) : ids.length === 0 ? (
          <>
            <p className="text-xs text-neutral-500 mr-auto">
              {matching} order{matching === 1 ? "" : "s"} in this view · tick rows
              to hand them to an agent
            </p>
            {agentPicker}
            <button
              onClick={() => printLabels("filtered")}
              disabled={!matching || !!busy || noAgent}
              title={noAgent ? "Choose the agent these parcels are going to" : undefined}
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

            {agentPicker}

            <button
              onClick={() => assign(agentId)}
              disabled={!!busy || noAgent}
              title={noAgent ? "Choose an agent first" : `Move to ${agentName}'s portal`}
              className={`${btn} bg-neutral-900 text-white hover:bg-neutral-700`}
            >
              <UserPlus className="w-3.5 h-3.5" />
              {busy === "assign" ? "Assigning…" : "Assign"}
            </button>

            <button
              onClick={() => printLabels("selected")}
              disabled={!!busy || noAgent}
              title={noAgent ? "Choose the agent these parcels are going to" : undefined}
              className={`${btn} bg-primary-500 text-white hover:bg-primary-600`}
            >
              <Printer className="w-3.5 h-3.5" />
              {busy === "print" ? "Building PDF…" : "Print & assign"}
            </button>

            <button
              onClick={() => assign(null)}
              disabled={!!busy}
              title="Take these back — they return to New"
              className={`${btn} border border-neutral-200 text-neutral-600 hover:border-neutral-400`}
            >
              <UserMinus className="w-3.5 h-3.5" />
              {busy === "unassign" ? "Removing…" : "Unassign"}
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
                  {["Order", "Deliver to", "Stage", "Agent", "Confirmed", "Label", "Ordered"].map((h) => (
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
                        {o.quantity > 1 && (
                          <span
                            title="Copies of the book in this parcel"
                            className="ml-1.5 inline-flex px-1.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold"
                          >
                            ×{o.quantity}
                          </span>
                        )}
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
                                className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-neutral-100 text-neutral-600 hover:bg-neutral-200 transition-colors"
                              >
                                <Phone className="w-4 h-4" />
                              </a>
                              <a
                                href={waLink(o.buyer_phone, deliveryWaMessage(o))}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="WhatsApp"
                                className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-green-50 text-green-600 hover:bg-green-100 transition-colors"
                              >
                                <MessageCircle className="w-4 h-4" />
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

                      {/* Whose parcel this is. The point of the whole screen. */}
                      <td className="px-4 py-3 align-top text-xs whitespace-nowrap">
                        {o.assigned_agent_id ? (
                          <>
                            <p className="text-neutral-800 font-medium">
                              {agentNames[o.assigned_agent_id] ?? "Removed agent"}
                            </p>
                            {o.assigned_at && (
                              <p className="text-neutral-400 mt-0.5">
                                {formatISTShort(o.assigned_at)}
                              </p>
                            )}
                          </>
                        ) : (
                          <span className="text-orange-600 font-medium">Unassigned</span>
                        )}
                      </td>

                      {/* Has the agent keyed the address into the courier's
                          system? Ticked in the portal; read-only here. */}
                      <td className="px-4 py-3 align-top text-xs whitespace-nowrap">
                        {o.courier_entered_at ? (
                          <p className="text-green-700 font-medium">
                            {formatISTShort(o.courier_entered_at)}
                          </p>
                        ) : o.assigned_agent_id ? (
                          <span className="text-neutral-400">Waiting</span>
                        ) : (
                          <span className="text-neutral-300">—</span>
                        )}
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
                          <span className="text-neutral-400">Not printed</span>
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
                        <td colSpan={7} className="px-4 py-3 text-xs text-neutral-600 leading-relaxed">
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

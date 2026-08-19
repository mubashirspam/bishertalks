"use client";

import React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import {
  Printer, Check, X, AlertCircle, Phone, MessageCircle, Info, ChevronUp, UserMinus,
  Truck, RefreshCw,
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
 * Parcels per request when routing a selection.
 *
 * The route accepts 300, and sending 48 in one call was the shape this used to
 * have: one request, one spinner on a button, and nothing to look at for the
 * thirty seconds it took to talk to Delhivery about all of them. Worse, a slow
 * batch could outlive the function's own time limit and leave the browser with
 * no answer at all about parcels that had already been manifested.
 *
 * Ten is small enough that each round trip returns quickly — so the bar moves,
 * and a failure costs at most ten parcels' worth of uncertainty — and large
 * enough that a full day is a handful of calls rather than fifty.
 */
const ROUTE_CHUNK = 10;

/** What a routing run did, accumulated across its chunks. */
type RunResult = {
  courierName: string | null;
  /** True when the run cleared the courier rather than setting one. */
  cleared: boolean;
  routed: number;
  sent: number;
  held: number;
  skipped: number;
  /** Refused by the courier, with the reason it gave. */
  failed: { order_number: string; error: string }[];
  /** Refused before asking, because the courier does not reach the pincode. */
  unserviceable: string[];
};

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
  couriers,
  courierNames,
}: {
  rows: DeliveryRow[];
  matching: number;
  /** Who parcels can be handed to — active staff with portal access. */
  agents: DeliveryAgent[];
  /** id → name for display, including agents since switched off. */
  agentNames: Record<string, string>;
  /**
   * Couriers a parcel can be assigned to right now. `dispatches` marks the
   * ones where routing also hands the parcel over, which is the difference
   * between a decision that can be changed and one that cannot.
   */
  couriers: { id: string; name: string; dispatches?: boolean }[];
  /** id → name for display, including couriers since switched off. */
  courierNames: Record<string, string>;
}) {
  const router = useRouter();
  const params = useSearchParams();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [courierId, setCourierId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; bad?: boolean } | null>(null);
  /** Non-null while a routing run is in flight — drives the progress panel. */
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  /** The last run's outcome. Set as it goes, so the panel fills in live. */
  const [result, setResult] = useState<RunResult | null>(null);
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
    setProgress(null);
    if (!bad) setSelected(new Set());
    router.refresh();
  };

  /** Ask for the label PDF and hand it to the browser as a download. */
  const printLabels = async (scope: "selected" | "filtered") => {
    setBusy("print");
    setMessage(null);

    const body = {
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

      done(`${count} label${count === 1 ? "" : "s"} downloaded.`);
    } catch {
      done("Download failed — check your connection and try again.", true);
    }
  };


  /**
   * Route the ticked parcels to a courier, and hand them over.
   *
   * Sent in chunks rather than as one request, so there is something to watch
   * and something to salvage. A batch of fifty used to be a single call behind
   * a button that said "Assigning…" and nothing else — no way to tell a slow
   * Delhivery from a stuck one, and if the function timed out the browser
   * learned nothing about parcels that may already have been manifested.
   *
   * Each chunk is independently safe. The claim in lib/db/courier-send.ts is
   * what prevents a double send, not the shape of this loop, so a run that dies
   * halfway leaves the parcels it already handled correctly recorded and the
   * rest untouched.
   *
   * The panel fills in as it goes rather than at the end, because the first
   * refusal is worth seeing before the last chunk finishes.
   */
  const setCourier = async (to: string | null) => {
    setBusy("courier");
    setMessage(null);
    setResult(null);

    const batches: string[][] = [];
    for (let i = 0; i < ids.length; i += ROUTE_CHUNK) {
      batches.push(ids.slice(i, i + ROUTE_CHUNK));
    }

    const acc: RunResult = {
      courierName: null,
      cleared: !to,
      routed: 0,
      sent: 0,
      held: 0,
      skipped: 0,
      failed: [],
      unserviceable: [],
    };

    setProgress({ done: 0, total: ids.length });

    for (const batch of batches) {
      let json: Record<string, never> | Record<string, unknown> = {};
      try {
        const res = await fetch("/api/admin/delivery/courier", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ order_numbers: batch, courier_id: to }),
        });
        json = await res.json().catch(() => ({}));

        // A rejected chunk stops the run. Carrying on would keep pushing
        // parcels at a courier that has already said no to the request itself
        // — a bad key or a switched-off partner fails the same way every time.
        if (!res.ok) {
          setResult(acc.routed || acc.sent ? { ...acc } : null);
          return done(
            (json.error as string) ?? "Could not set the courier",
            true
          );
        }
      } catch {
        setResult(acc.routed || acc.sent ? { ...acc } : null);
        return done("Could not set the courier — check your connection.", true);
      }

      acc.courierName = (json.courier_name as string) ?? acc.courierName;
      acc.routed += (json.updated as number) ?? 0;
      acc.sent += (json.sent as number) ?? 0;
      acc.held += (json.held as number) ?? 0;
      acc.skipped += (json.skipped as number) ?? 0;
      const f = json.failed as RunResult["failed"] | undefined;
      if (f?.length) acc.failed.push(...f);
      const u = json.unserviceable as string[] | undefined;
      if (u?.length) acc.unserviceable.push(...u);

      setProgress((p) => ({
        done: Math.min((p?.done ?? 0) + batch.length, ids.length),
        total: ids.length,
      }));
      // A fresh object each time, or React sees the same reference and the
      // panel never repaints mid-run.
      setResult({ ...acc, failed: [...acc.failed], unserviceable: [...acc.unserviceable] });
    }

    setProgress(null);
    setBusy(null);
    setResult(acc);

    // Leave exactly the parcels that need another decision ticked, so the next
    // action is one click: choose a different courier and press Assign. A run
    // with nothing to fix clears the selection as it always did.
    const needsAnother = [
      ...acc.failed.map((x) => x.order_number),
      ...acc.unserviceable,
    ];
    setSelected(new Set(needsAnother));

    router.refresh();
  };

  /**
   * Ask the courier where the ticked parcels are.
   *
   * Read-only at their end, so it needs no confirmation and can be pressed as
   * often as anyone likes — unlike Send, which is next to it and is not.
   */
  const syncFromCourier = async () => {
    setBusy("sync");
    setMessage(null);

    try {
      const res = await fetch("/api/admin/delivery/courier-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_numbers: ids, courier_id: couriers[0]?.id }),
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok) return done(json.error ?? "Could not sync", true);

      const bits: string[] = [];
      if (json.moved) bits.push(`${json.moved} moved on`);
      if (json.learned) bits.push(`${json.learned} waybill${json.learned === 1 ? "" : "s"} found`);
      if (json.unknown) bits.push(`${json.unknown} the courier has no record of`);
      done(bits.length ? bits.join(" · ") : "Everything already up to date.");
    } catch {
      done("Could not sync — check your connection.", true);
    }
  };



  /** Prefix for the one message that is a warning rather than a result. */
  const R_BAD = "⚠";

  /**
   * Route the ticked parcels, asking first only when it is irreversible.
   *
   * A courier we hand a spreadsheet to can be re-routed freely, so demanding a
   * confirmation for it would be noise. A courier we dispatch to over an API
   * cannot — the parcel exists at their end the moment this returns.
   */
  const confirmAndRoute = (courier: { id: string; name: string; dispatches?: boolean }) => {
    if (courier.dispatches) {
      const ok = window.confirm(
        `Send ${ids.length} parcel${ids.length === 1 ? "" : "s"} to ${courier.name}?\n\n` +
          "They go into the courier's system straight away. Undoing this means " +
          "cancelling with the courier, not here."
      );
      if (!ok) return;
    }
    void setCourier(courier.id);
  };

  const btn =
    "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

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
        {/* The gate is the courier, not a staff member. It used to check for a
            delivery agent, which blocked the entire bar for a flow that no
            longer needs one. */}
        {!couriers.length ? (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            No courier is switched on, so parcels cannot be routed anywhere.
          </p>
        ) : ids.length === 0 ? (
          <>
            <p className="text-xs text-neutral-500 mr-auto">
              {matching} order{matching === 1 ? "" : "s"} in this view · tick rows
              to choose a courier
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

            {/* One partner is a button; several is a choice. Which courier a
                parcel goes to is the decision this screen exists for, so it
                should never be more than one control. */}
            {couriers.length === 1 ? (
              <button
                onClick={() => confirmAndRoute(couriers[0])}
                disabled={!!busy}
                title={`Route to ${couriers[0].name}`}
                className={`${btn} bg-neutral-900 text-white hover:bg-neutral-700`}
              >
                <Truck className="w-3.5 h-3.5" />
                {busy === "courier"
                  ? progress
                    ? `${progress.done}/${progress.total}…`
                    : "Assigning…"
                  : `Assign to ${couriers[0].name}`}
              </button>
            ) : (
              <>
                <select
                  value={courierId}
                  onChange={(e) => setCourierId(e.target.value)}
                  className="bg-white border border-neutral-300 rounded-lg px-2 py-1.5 text-xs cursor-pointer focus:outline-none focus:border-primary-500"
                >
                  <option value="">Choose courier…</option>
                  {couriers.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>

                <button
                  onClick={() => {
                    const c = couriers.find((x) => x.id === courierId);
                    if (c) confirmAndRoute(c);
                  }}
                  disabled={!!busy || !courierId}
                  title={courierId ? "Route these parcels" : "Choose a courier first"}
                  className={`${btn} bg-neutral-900 text-white hover:bg-neutral-700`}
                >
                  <Truck className="w-3.5 h-3.5" />
                  {busy === "courier"
                    ? progress
                      ? `${progress.done}/${progress.total}…`
                      : "Assigning…"
                    : "Assign"}
                </button>
              </>
            )}

            <button
              onClick={syncFromCourier}
              disabled={!!busy}
              title="Ask the courier where these parcels are"
              className={`${btn} border border-neutral-300 text-neutral-700 hover:border-neutral-500`}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${busy === "sync" ? "animate-spin" : ""}`} />
              {busy === "sync" ? "Asking…" : "Sync status"}
            </button>

            <span className="w-px h-6 bg-neutral-200" />

          </>
        )}
      </div>

      {/* ── Progress ─────────────────────────────────────────────────────── */}
      {progress && (
        <div className="bg-white border border-neutral-200 rounded-2xl p-4 shadow-sm mb-4">
          <div className="flex items-center justify-between gap-4 mb-2">
            <p className="text-sm font-semibold text-neutral-900 flex items-center gap-2">
              <Truck className="w-4 h-4 text-primary-500 animate-pulse" />
              Handing parcels over…
            </p>
            <p className="text-xs text-neutral-500 tabular-nums">
              {progress.done} of {progress.total}
            </p>
          </div>
          <div className="h-2 rounded-full bg-neutral-100 overflow-hidden">
            <div
              className="h-full rounded-full bg-primary-500 transition-all duration-300"
              style={{
                width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%`,
              }}
            />
          </div>
          {/* Running totals, not just a bar. A bar says how long is left; this
              says whether it is going well, which is the thing worth knowing
              before it finishes — a run refusing everything is worth stopping. */}
          {result && (
            <p className="flex flex-wrap items-center gap-x-3 text-xs mt-2">
              {result.sent > 0 && (
                <span className="text-green-700 font-medium">
                  {result.sent} sent
                </span>
              )}
              {result.failed.length + result.unserviceable.length > 0 && (
                <span className="text-red-700 font-medium">
                  {result.failed.length + result.unserviceable.length} refused
                </span>
              )}
              {result.held > 0 && (
                <span className="text-amber-700 font-medium">
                  {result.held} held
                </span>
              )}
              {result.skipped > 0 && (
                <span className="text-neutral-500">{result.skipped} skipped</span>
              )}
            </p>
          )}

          {/* Said plainly, because the honest answer to "can I close this tab?"
              is no — the run lives in this page, not on the server. */}
          <p className="text-[11px] text-neutral-400 mt-2">
            Sent {ROUTE_CHUNK} at a time. Keep this tab open until it finishes —
            parcels already handed over are safely recorded either way.
          </p>
        </div>
      )}

      {/* ── What the run did ─────────────────────────────────────────────── */}
      {result && !progress && (
        <RunSummary
          result={result}
          onDismiss={() => setResult(null)}
          onSelectRefused={(numbers) => setSelected(new Set(numbers))}
        />
      )}

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
                  {["Order", "Deliver to", "Contents", "Stage", "Agent", "Confirmed", "Label", "Ordered"].map((h) => (
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
                      {/* What is in the parcel and what it was paid for.
                          Packing decisions live here — copies, wrapping and
                          signing all change what someone puts in the box — and
                          the amount is the figure a customer quotes on the
                          phone, so it saves opening the order page to check. */}
                      <td className="px-4 py-3 align-top text-xs whitespace-nowrap">
                        <p className="text-neutral-900 font-semibold">
                          ₹{Math.round(o.amount_paise / 100).toLocaleString("en-IN")}
                        </p>
                        <p className="text-neutral-500 mt-0.5">
                          {o.quantity > 1 ? `${o.quantity} books` : "1 book"}
                        </p>
                        {(o.is_gift || o.is_signed) && (
                          <p className="flex flex-wrap items-center gap-1 mt-1">
                            {o.is_gift && (
                              <span
                                title={
                                  o.gift_message
                                    ? "Gift — wrap it, and write the card (message on the order page)"
                                    : "Gift — wrap it. No message; send a blank card."
                                }
                                className="inline-flex px-1.5 rounded-full bg-primary-100 text-primary-800 text-[10px] font-bold"
                              >
                                🎁 gift
                              </span>
                            )}
                            {o.is_signed && (
                              <span
                                title="Signed — every copy goes to Bisher to be signed before it is wrapped"
                                className="inline-flex px-1.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold"
                              >
                                ✒️ signed
                              </span>
                            )}
                          </p>
                        )}
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
                        {/* An agent, when one is carrying it. "Unassigned" in
                            orange is only a warning when nobody at all has this
                            parcel — a parcel routed to a courier needs no staff
                            member, and flagging it as unassigned made a normal
                            state look broken. */}
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
                        ) : !o.courier_id ? (
                          <span className="text-orange-600 font-medium">Nobody has this</span>
                        ) : null}

                        {/* Which courier carries it, and — the part that
                            actually confuses people — whether the courier has
                            been told. Choosing a courier does not send anything,
                            so "assigned" and "sent" must not look alike. */}
                        {o.courier_id && (
                          <div className="mt-1">
                            <p className="flex items-center gap-1 text-neutral-500">
                              <Truck className="w-3 h-3 flex-shrink-0" />
                              <span className="truncate">
                                {courierNames[o.courier_id] ?? "Removed courier"}
                              </span>
                            </p>

                            {o.courier_sent_at ? (
                              <>
                                <p className="flex items-center gap-1 text-green-700 font-medium mt-0.5">
                                  <Check className="w-3 h-3 flex-shrink-0" />
                                  Sent {formatISTShort(o.courier_sent_at)}
                                </p>
                                {o.tracking_number && (
                                  <p className="font-mono text-neutral-500 mt-0.5 break-all">
                                    {o.tracking_number}
                                  </p>
                                )}
                                {/* Where the parcel actually is, from the
                                    courier's own scan. The answer to "packed or
                                    not, delivered or not". */}
                                {o.courier_last_scan && (
                                  <p className="text-neutral-600 mt-0.5">
                                    {o.courier_last_scan}
                                    {o.courier_last_scan_at && (
                                      <span className="text-neutral-400">
                                        {" · "}
                                        {timeAgo(o.courier_last_scan_at)}
                                      </span>
                                    )}
                                  </p>
                                )}
                              </>
                            ) : (
                              // Says the next action, not just the absence.
                              // "Not sent yet" on its own reads as a fault when
                              // it is simply the step before Send.
                              <p
                                className="text-amber-700 mt-0.5"
                                title="Choosing a courier does not tell them anything. Press Send."
                              >
                                Waiting to be sent
                              </p>
                            )}
                          </div>
                        )}

                        {/* A send that failed or never came back. Loud, because
                            the alternative is a parcel quietly going nowhere.
                            The chip distinguishes the two cases the text alone
                            cannot: REFUSED means the claim was given back and
                            this parcel is going nowhere until somebody routes
                            it elsewhere, while an error with the claim still
                            held is one where the outcome is simply unknown and
                            re-sending could duplicate a real shipment. */}
                        {o.courier_send_error && (
                          <p className="mt-1">
                            {!o.courier_sent_at ? (
                              <span className="inline-flex px-1.5 rounded-full bg-red-100 text-red-800 text-[10px] font-bold uppercase tracking-wide">
                                Refused
                              </span>
                            ) : (
                              <span className="inline-flex px-1.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold uppercase tracking-wide">
                                Held
                              </span>
                            )}
                          </p>
                        )}
                        {o.courier_send_error && (
                          <p
                            title={o.courier_send_error}
                            className="mt-1 flex items-start gap-1 text-red-600 max-w-[200px]"
                          >
                            <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                            <span className="line-clamp-2">{o.courier_send_error}</span>
                          </p>
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
                          {formatISTShort(o.ordered_at)}
                        </p>
                        <p className="text-neutral-400 mt-0.5">{timeAgo(o.ordered_at)}</p>
                      </td>
                    </tr>
                    {expanded.has(o.order_number) && (
                      <tr className="bg-neutral-50 border-b border-neutral-100 last:border-0">
                        <td />
                        <td colSpan={8} className="px-4 py-3 text-xs text-neutral-600 leading-relaxed">
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

/**
 * What a routing run actually did, with the refusals named.
 *
 * The summary used to be one sentence — "48 sent to KKR Logistics (Delhivery) ·
 * 2 routed but not sent · 2 refused" — which told you a number and left you to
 * find the two parcels yourself among fifty rows, then open each one to read
 * why. The reasons were already in the response and were being thrown away.
 *
 * So each refusal is a line: which parcel, what the courier said, and a way
 * straight to it. The refused parcels are also left ticked by the run itself,
 * which makes the fix the next thing you do rather than something you go
 * hunting for.
 */
function RunSummary({
  result,
  onDismiss,
  onSelectRefused,
}: {
  result: RunResult;
  onDismiss: () => void;
  onSelectRefused: (numbers: string[]) => void;
}) {
  const where = result.courierName ?? "the courier";

  // One list, whatever the reason. To the person fixing them, "the courier
  // said no" and "the courier does not go there" are the same job.
  const refused: { order_number: string; error: string }[] = [
    ...result.failed,
    ...result.unserviceable.map((n) => ({
      order_number: n,
      error: `${where} does not deliver to this pincode.`,
    })),
  ];

  // Everything routed that did not reach the courier and is not accounted for
  // by one of the named piles below. `held` has to come off too — a held parcel
  // has already been described, and counting it here as well would report more
  // parcels than the run touched.
  const routedNotSent = Math.max(
    0,
    result.routed - result.sent - result.held - refused.length
  );

  return (
    <div className="bg-white border border-neutral-200 rounded-2xl shadow-sm mb-4 overflow-hidden">
      <div className="flex items-start gap-3 px-4 py-3 border-b border-neutral-100">
        {refused.length || result.held ? (
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-600" />
        ) : (
          <Check className="w-4 h-4 mt-0.5 flex-shrink-0 text-green-600" />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-neutral-900">
            {result.cleared
              ? `Courier cleared on ${result.routed} parcel${result.routed === 1 ? "" : "s"}`
              : result.sent
                ? `${result.sent} sent to ${where}`
                : `${result.routed} parcel${result.routed === 1 ? "" : "s"} routed to ${where}`}
          </p>

          {/* The rest of the arithmetic, only where there is any. Zero rows
              here would be four lines of nothing on a clean run. */}
          <ul className="text-xs text-neutral-500 mt-1 space-y-0.5">
            {routedNotSent > 0 && (
              <li>{routedNotSent} routed but not sent</li>
            )}
            {result.held > 0 && (
              <li className="text-amber-700">
                {result.held} held — we could not confirm what happened. Check{" "}
                {where} before sending these again; they may already be there.
              </li>
            )}
            {result.skipped > 0 && (
              <li>{result.skipped} skipped — already with a courier</li>
            )}
          </ul>
        </div>

        <button
          onClick={onDismiss}
          title="Dismiss"
          className="text-neutral-400 hover:text-neutral-700 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {refused.length > 0 && (
        <div className="bg-red-50/60 px-4 py-3">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
            <p className="text-xs font-semibold text-red-800">
              {refused.length} refused — pick a different courier for these
            </p>
            <button
              onClick={() => onSelectRefused(refused.map((r) => r.order_number))}
              className="text-xs font-medium text-red-700 hover:text-red-900 underline underline-offset-2"
            >
              Select all {refused.length}
            </button>
          </div>

          <ul className="space-y-1">
            {refused.map((r) => (
              <li
                key={r.order_number}
                className="flex flex-wrap items-baseline gap-x-2 text-xs"
              >
                <Link
                  href={`/admin/orders/${r.order_number}`}
                  className="font-mono font-semibold text-red-800 hover:underline"
                >
                  {r.order_number}
                </Link>
                <span className="text-red-700">{r.error}</span>
              </li>
            ))}
          </ul>

          <p className="text-[11px] text-red-600/80 mt-2">
            These are ticked already. Choose another courier above and press
            Assign — that clears the refusal and routes them afresh.
          </p>
        </div>
      )}
    </div>
  );
}

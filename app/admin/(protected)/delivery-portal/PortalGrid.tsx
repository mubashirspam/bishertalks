"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, RefreshCw, RefreshCcwDot, Undo2 } from "lucide-react";
import { COURIER_SHEET_MAX } from "@/lib/courier-sheet";
import PortalExport from "./PortalExport";
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
  courierNames,
  courierId,
  syncCourierId,
  live,
}: {
  rows: PortalRow[];
  startIndex: number;
  /** id → name, so a routed parcel can say who is taking it. */
  courierNames: Record<string, string>;
  /** The courier being looked at, or null for all of them. */
  courierId: string | null;
  /**
   * The courier to run an account-wide sweep against, whatever the filter says.
   *
   * Separate from `courierId` because syncing everything is not a property of
   * the view: it should not require picking a courier first, which is what hid
   * the button whenever the filter was on "All couriers" — the state most
   * people open the page in.
   */
  syncCourierId: string | null;
  /**
   * Can we ask this courier where the parcels are?
   *
   * True turns the grid into a tracking screen: waybill and their own latest
   * scan, refreshed on demand. False leaves it the copy-and-tick spreadsheet,
   * which is the right answer for a courier we hand parcels to by hand.
   */
  live: boolean;
}) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  /** Guards the automatic sync below against React's double-invoked effects. */
  const autoSynced = useRef(false);
  const [overrides, setOverrides] = useState<Record<string, OrderStatus>>({});
  const [entered, setEntered] = useState<Record<string, boolean>>({});
  /** Parcels ticked for the courier sheet. Capped at a sheetful, see below. */
  const [picked, setPicked] = useState<Set<string>>(new Set());
  /** True while the last click was refused for hitting that limit. */
  const [capped, setCapped] = useState(false);
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

  // ── Picking parcels for the courier sheet ─────────────────────────────────

  /**
   * Can this parcel go on a sheet?
   *
   * Only a genuinely new one: still at Confirmed status and not yet entered
   * with the courier. A parcel that has been sheeted up already has its
   * Confirmed tick, and putting it on a second file would ask the courier to
   * create a second waybill for a parcel that already has one.
   */
  const isNew = (r: PortalRow): boolean =>
    statusOf(r) === "confirmed" && !enteredOf(r);

  /**
   * What the button will actually send.
   *
   * Read off the rows rather than out of the set, so a parcel ticked and then
   * marked Packed drops out on its own instead of travelling as a stale id.
   */
  const pickedRows = rows.filter((r) => picked.has(r.order_number) && isNew(r));
  const selectable = rows.filter(isNew);
  const allPicked =
    selectable.length > 0 && selectable.every((r) => picked.has(r.order_number));

  function togglePicked(row: PortalRow) {
    const n = row.order_number;
    const next = new Set(picked);

    if (next.has(n)) {
      next.delete(n);
      setCapped(false);
    } else if (pickedRows.length >= COURIER_SHEET_MAX) {
      // Refuse rather than silently swapping something out — the agent is
      // choosing what goes on this sheet, and the next one is one click away.
      setCapped(true);
      return;
    } else {
      next.add(n);
    }

    setPicked(next);
  }

  /** Tick the whole page, or as much of it as one sheet holds. */
  function toggleAllPicked() {
    if (allPicked || pickedRows.length) {
      setPicked(new Set());
      setCapped(false);
      return;
    }
    const take = selectable.slice(0, COURIER_SHEET_MAX);
    setPicked(new Set(take.map((r) => r.order_number)));
    setCapped(take.length < selectable.length);
  }

  /**
   * Ask the courier where this page's parcels are, right now.
   *
   * Read-only at their end — it asks, it never sends — so it is safe to press
   * as often as someone likes. The scheduled poller does the same job on a
   * timer; this is for when there is a customer on the phone.
   */
  async function syncNow(all = false) {
    const target = all ? syncCourierId : courierId;
    if (!target) return;
    setSyncing(true);
    setSyncNote(null);

    try {
      const res = await fetch("/api/admin/delivery/courier-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courier_id: target,
          // A sweep names nothing: the server picks every unfinished parcel it
          // can ask about, so the answer does not depend on which page is open.
          ...(all ? { all: true } : { order_numbers: rows.map((r) => r.order_number) }),
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || data.error) {
        setSyncNote(data.error ?? "Could not sync.");
        return;
      }

      const bits: string[] = [];
      if (data.all) bits.push(`${data.asked} checked`);
      if (data.moved) bits.push(`${data.moved} moved on`);
      if (data.learned) bits.push(`${data.learned} waybill${data.learned === 1 ? "" : "s"} found`);
      if (data.unknown) bits.push(`${data.unknown} not at the courier`);
      setSyncNote(bits.length ? bits.join(" · ") : "Everything already up to date.");
      router.refresh();
    } catch {
      setSyncNote("Could not reach the server.");
    } finally {
      setSyncing(false);
    }
  }

  /**
   * Ask the courier once when the screen opens.
   *
   * The button stays, for the moment somebody wants an answer right now, but
   * nobody should have to press anything to see a current status — a screen
   * that is only right after you remember to refresh it is a screen people
   * stop trusting. Runs once per mount, and only where there is something to
   * ask about.
   */
  useEffect(() => {
    if (!live || !courierId || !rows.length || autoSynced.current) return;
    autoSynced.current = true;
    void syncNow(false);
    // Deliberately mount-only: re-syncing on every render would hammer the
    // courier's rate limit for no new information.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** The sheet has been downloaded: those parcels are now with the courier. */
  function sheetDownloaded(confirmed: string[]) {
    setEntered((e) => ({
      ...e,
      ...Object.fromEntries(confirmed.map((n) => [n, true])),
    }));
    setPicked(new Set());
    setCapped(false);
    // Their place in the "not yet entered first" ordering has changed, and on
    // a New filter they have left the list entirely.
    router.refresh();
  }

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

  /**
   * Is there anything to tick for a sheet?
   *
   * Deliberately NOT `!live`. Whether a courier reports its own scans decides
   * which *columns* to show; it must not decide whether a spreadsheet can be
   * built. Tying the two together produced a dead end: for a Delhivery parcel
   * the live view hid the sheet controls, and with sending still switched off
   * there was no way left to get the parcel to the courier at all. The sheet
   * is the documented fallback for exactly that situation.
   */
  const showPick = selectable.length > 0 || pickedRows.length > 0;

  const cell = "px-3 py-2 align-top";

  return (
    <div className="bg-white border border-neutral-200 rounded-2xl shadow-sm">
      {error && (
        <p className="text-xs text-red-600 bg-red-50 border-b border-red-100 px-4 py-2 rounded-t-2xl">
          {error}
        </p>
      )}

      {/* A courier with live tracking replaces the whole spreadsheet ritual:
          there is nothing to copy out and nothing to upload, so the bar offers
          the one thing that is useful — go and ask them where these are. */}
      {(live || syncCourierId) && (
        <div
          className={`flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-neutral-100 bg-neutral-50/60 ${
            error ? "" : "rounded-t-2xl"
          }`}
        >
          <span className="text-xs text-neutral-600">
            {live
              ? "Status comes straight from the courier — waybill and last scan below."
              : "Pick a courier above to see its waybills, or sync everything now."}
          </span>

          {syncNote && <span className="text-xs text-neutral-500">{syncNote}</span>}

          <span className="ml-auto flex items-center gap-2">
            <button
              onClick={() => syncNow(false)}
              disabled={syncing || !rows.length || !live}
              title={live ? "Ask about the parcels on this page" : "Pick a courier above first"}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-300 bg-white text-xs font-semibold text-neutral-700 hover:border-neutral-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "Asking the courier…" : "Sync this page"}
            </button>

            {/* The sweep. Silent by design — it catches up on parcels that
                moved days ago, and telling those customers their book has
                shipped when it is already on their shelf is worse than saying
                nothing. */}
            <button
              onClick={() => {
                const ok = window.confirm(
                  "Sync every parcel the courier can be asked about?\n\n" +
                    "This takes a minute or two and sends no messages to customers — " +
                    "it is catching up on history, not reporting news."
                );
                if (ok) void syncNow(true);
              }}
              disabled={syncing || !syncCourierId}
              title="Ask about every unfinished parcel, whatever is filtered"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-300 bg-white text-xs font-semibold text-neutral-700 hover:border-neutral-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              <RefreshCcwDot className="w-3.5 h-3.5" />
              Sync everything
            </button>
          </span>
        </div>
      )}

      {/* The sheet bar. Only new parcels can be ticked, so it has nothing to
          offer a page whose parcels are all already with the courier. It stays
          available on a live courier too: the spreadsheet is how a day's
          parcels still go out when the API is unavailable or switched off. */}
      {showPick && (
        <div
          className={`flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-neutral-100 bg-neutral-50/60 ${
            error ? "" : "rounded-t-2xl"
          }`}
        >
          <span className="text-xs text-neutral-600">
            {pickedRows.length ? (
              <>
                <strong className="text-neutral-900">{pickedRows.length}</strong> of{" "}
                {COURIER_SHEET_MAX} picked for the courier sheet
              </>
            ) : (
              <>Tick up to {COURIER_SHEET_MAX} new parcels to build a courier sheet</>
            )}
          </span>

          {pickedRows.length > 0 && (
            <button
              onClick={() => {
                setPicked(new Set());
                setCapped(false);
              }}
              className="text-xs text-neutral-500 hover:text-neutral-900 underline underline-offset-2 transition-colors"
            >
              Clear
            </button>
          )}

          {capped && (
            <span className="text-xs text-amber-700">
              One sheet holds {COURIER_SHEET_MAX} — download these, then pick the next lot.
            </span>
          )}

          <span className="ml-auto flex items-center gap-2">
            <PortalExport
              orderNumbers={pickedRows.map((r) => r.order_number)}
              onDone={sheetDownloaded}
            />
          </span>
        </div>
      )}

      {/* portal-scroll (globals.css): a permanent, thick, draggable bar. The
          macOS overlay scrollbar fades out while you read, which on a table
          this wide hides the only clue that there are more columns. */}
      <div className="overflow-x-auto portal-scroll">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-neutral-50 border-b border-neutral-200 text-left">
              {showPick && (
              <th className="px-3 py-2.5 w-9 border-r border-neutral-100">
                <input
                  type="checkbox"
                  checked={allPicked}
                  // Half a page picked is its own state, and without this the
                  // box reads as empty while the bar says nine are chosen.
                  ref={(el) => {
                    if (el) el.indeterminate = !allPicked && pickedRows.length > 0;
                  }}
                  disabled={!selectable.length}
                  onChange={toggleAllPicked}
                  aria-label="Pick every new parcel on this page"
                  title={`Pick the new parcels on this page, up to ${COURIER_SHEET_MAX}`}
                  className="w-3.5 h-3.5 rounded border-neutral-300 cursor-pointer accent-emerald-600 disabled:cursor-not-allowed disabled:opacity-40"
                />
              </th>
              )}
              {(live
                ? ["#", "Ordered", "Name", "Mobile", "Address", "Pincode", "Waybill", "Courier status"]
                : ["#", "Ordered", "Name", "Mobile", "Address", "Pincode", "Reference"]
              ).map((h) => (
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
              const canPick = isNew(r);
              const isPicked = canPick && picked.has(r.order_number);

              return (
                <tr
                  key={r.id}
                  className={`border-b border-neutral-100 last:border-0 transition-colors ${
                    isPicked ? "bg-emerald-50/60" : "hover:bg-neutral-50/70"
                  } ${busy ? "opacity-60" : ""}`}
                >
                  {/* Blank rather than a disabled box on a parcel that has
                      already been sheeted up: there is nothing to decide, and
                      a greyed tick down the column reads as "not done yet". */}
                  {showPick && (
                    <td className="px-3 py-2 align-top border-r border-neutral-100">
                      {canPick && (
                        <input
                          type="checkbox"
                          checked={isPicked}
                          onChange={() => togglePicked(r)}
                          aria-label={`Pick ${r.order_number} for the courier sheet`}
                          className="w-3.5 h-3.5 rounded border-neutral-300 cursor-pointer accent-emerald-600"
                        />
                      )}
                    </td>
                  )}

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
                    {/* Same reasoning as the copy count: a parcel that went out
                        unwrapped can't be fixed after the fact. The message
                        itself is on the order page — it is private, and this
                        grid is open on a shared screen while packing. */}
                    {/* Which courier is taking it. An agent needs this to
                        know whether a parcel is theirs to hand over or has
                        already gone out through an integration. */}
                    {r.courier_id && (
                      <span
                        title={
                          r.courier_sent_at
                            ? `Already sent to ${courierNames[r.courier_id] ?? "the courier"}`
                            : `Going by ${courierNames[r.courier_id] ?? "a courier"}`
                        }
                        className={`ml-1.5 inline-flex items-center gap-1 px-1.5 rounded-full text-[10px] font-bold align-middle ${
                          r.courier_sent_at
                            ? "bg-green-100 text-green-800"
                            : "bg-neutral-100 text-neutral-600"
                        }`}
                      >
                        {courierNames[r.courier_id] ?? "Courier"}
                        {r.courier_sent_at && <Check className="w-2.5 h-2.5" />}
                      </span>
                    )}
                    {r.is_gift && (
                      <span
                        title={
                          r.gift_message
                            ? "Gift — wrap it, and write the card (message on the order page)"
                            : "Gift — wrap it. No message; send a blank card."
                        }
                        className="ml-1.5 inline-flex px-1.5 rounded-full bg-primary-100 text-primary-800 text-[10px] font-bold align-middle"
                      >
                        🎁 gift
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

                  {/* On a live courier this is the waybill — the number the
                      customer tracks with, and the one to quote on the phone.
                      Otherwise it is our own reference, which is all the Excel
                      channel ever gives us back. */}
                  <td className={`${cell} whitespace-nowrap border-r border-neutral-100`}>
                    {live ? (
                      r.tracking_number ? (
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-neutral-700">
                            {r.tracking_number}
                          </span>
                          <CopyButton
                            title="Copy waybill"
                            active={copied === `${r.order_number}:awb`}
                            onClick={() => copy(`${r.order_number}:awb`, r.tracking_number!)}
                          />
                        </div>
                      ) : (
                        // No waybill on a live courier means they have no record
                        // of it — usually a sheet that was never uploaded. Worth
                        // saying, not worth a dash.
                        <span
                          title="The courier has no record of this parcel yet"
                          className="text-amber-700 text-[11px] font-medium"
                        >
                          Not with them
                        </span>
                      )
                    ) : r.courier_reference ? (
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-neutral-700">
                          {r.courier_reference}
                        </span>
                        <CopyButton
                          title="Copy reference number"
                          active={copied === `${r.order_number}:ref`}
                          onClick={() =>
                            copy(`${r.order_number}:ref`, r.courier_reference!)
                          }
                        />
                      </div>
                    ) : (
                      <span className="text-neutral-300">—</span>
                    )}
                  </td>

                  {/* The courier's own words, and when they said them. */}
                  {live && (
                    <td className={`${cell} border-r border-neutral-100 min-w-[180px]`}>
                      {r.courier_last_scan ? (
                        <>
                          <span className="text-neutral-800">{r.courier_last_scan}</span>
                          {r.courier_last_scan_at && (
                            <span className="block text-neutral-400 text-[11px] mt-0.5">
                              {formatISTShort(r.courier_last_scan_at)}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-neutral-300">—</span>
                      )}
                    </td>
                  )}

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
        {live ? (
          <>
            Waybill and status come from the courier — press Sync now to ask
            them again. &ldquo;Not with them&rdquo; means the courier has no
            record of that parcel at all. A parcel that has not gone yet can
            still be ticked on the left and put on an Excel sheet, which is how
            a day&apos;s parcels go out when sending is unavailable.
          </>
        ) : (
          <>
            Click a box to mark that stage — it saves straight away. Clicking a
            ticked Confirmed or Packed asks before it undoes it. The tracking ID
            under Shipped is optional; entering one on a parcel that hasn&apos;t
            gone yet ships it and sends the customer the number with it. The
            left-hand tick picks a new parcel for the courier&apos;s Excel sheet
            — up to {COURIER_SHEET_MAX} at a time, and downloading the sheet
            ticks them Confirmed.
          </>
        )}
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

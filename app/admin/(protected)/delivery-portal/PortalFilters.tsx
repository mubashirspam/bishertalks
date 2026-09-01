"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowDownUp, CalendarDays, Gift, Search, Truck, X } from "lucide-react";
import { useNavigation } from "@/components/admin/Revalidating";
import {
  PORTAL_FILTERS,
  PORTAL_FILTER_LABELS,
  PORTAL_TRACKING,
  PORTAL_TRACKING_LABELS,
  PORTAL_PACKING,
  PORTAL_PACKING_LABELS,
  PORTAL_PACKING_HINTS,
  PORTAL_SEARCH_LABELS,
  portalSearch,
} from "@/lib/db/delivery-portal";
import type { DeliveryAgent } from "@/lib/db/staff";
import {
  HANDOVER_CHIPS,
  HANDOVER_LABELS,
  HANDOVER_HINTS,
  HANDOVER_TONE,
} from "@/lib/delivery/handover";

/** Today in IST as YYYY-MM-DD — the agent's browser may be in any timezone. */
function istToday(): string {
  return new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
}
function istDaysAgo(n: number): string {
  return new Date(Date.now() + 5.5 * 3600e3 - n * 864e5).toISOString().slice(0, 10);
}

/** Matches the tick colours in the grid, so a filter looks like what it picks. */
const STATUS_ACTIVE: Record<string, string> = {
  // New is the to-do list — the blue the old "To enter" chip wore.
  new: "border-blue-500 bg-blue-50 text-blue-700",
  confirmed: "border-neutral-500 bg-neutral-100 text-neutral-800",
  processing: "border-amber-500 bg-amber-50 text-amber-700",
  shipped: "border-purple-500 bg-purple-50 text-purple-700",
  out_for_delivery: "border-teal-500 bg-teal-50 text-teal-700",
  delivered: "border-green-600 bg-green-50 text-green-700",
  returned: "border-rose-500 bg-rose-50 text-rose-700",
};

/**
 * One day, one status.
 *
 * A range, with the single day kept as the common case.
 *
 * It was one date, on the reasoning that the portal is worked a day at a time
 * and making somebody fill two boxes to see today is friction on the most
 * frequent action there is. That is still true of a normal day — which is why
 * Today and Yesterday are one tap and leave the second box empty — but it was
 * never true of a backlog. Draining four days meant four page loads and a
 * mental tally, and the answer to "how many went out this week" did not exist
 * on the screen at all.
 *
 * Either end stands alone: `date` on its own is one day, `to` on its own is
 * everything up to it.
 *
 * The day is the day the parcel was ASSIGNED, not the day it was ordered — the
 * same clock the list is sorted by, see migration 0046. So "Today" means the
 * batch handed out this morning, which is what someone opening this screen is
 * looking for. A parcel that went straight to a courier and was never assigned
 * to anybody falls back to its order date, and the grid marks those rows.
 */
/**
 * Chip colours for the packing filter.
 *
 * Gift and Signed are warm because they are the exceptions someone has to act
 * on; "Nothing extra" stays neutral — it is the ordinary pile, and colouring it
 * would give the same weight to "do nothing" as to "wrap this one".
 */
const PACKING_TONE: Record<string, string> = {
  gift: "border-pink-500 bg-pink-50 text-pink-700",
  signed: "border-violet-500 bg-violet-50 text-violet-700",
  plain: "border-neutral-400 bg-neutral-100 text-neutral-700",
};

export default function PortalFilters({
  countSlot,
  downloadSlot,
  agents,
  couriers,
  trackedCourierIds,
}: {
  countSlot?: React.ReactNode;
  /**
   * The download button, top right.
   *
   * Passed in rather than imported so this stays a pure filter bar: it knows
   * which filters are set, and the thing that turns them into a file is none
   * of its business.
   */
  downloadSlot?: React.ReactNode;
  /** Empty for an agent — they only ever see their own parcels. */
  agents: DeliveryAgent[];
  /**
   * Who is carrying the parcels. The portal's main axis now: pick Delhivery
   * and the grid shows live waybills and their own scans; pick anyone else and
   * it stays the copy-and-tick spreadsheet it has always been.
   */
  couriers: { id: string; name: string }[];
  /** Couriers that report their own scans — the rest have nothing to compare. */
  trackedCourierIds: string[];
}) {
  const params = useSearchParams();
  const { navigate } = useNavigation();

  const date = params.get("date") ?? "";
  const dateTo = params.get("to") ?? "";
  const status = params.get("status") ?? "";
  const agent = params.get("agent") ?? "";
  const courier = params.get("courier") ?? "";
  const tracking = params.get("tracking") ?? "";
  const handover = params.get("handover") ?? "";
  const packing = params.get("packing") ?? "";
  const sort = params.get("sort") === "oldest" ? "oldest" : "newest";
  const q = params.get("q") ?? "";

  // The box is typed into before it is submitted, so it holds its own value —
  // pushing a URL per keystroke would be a page load per letter.
  const [typed, setTyped] = useState(q);

  // Resynced from the URL, so Clear, the back button and a pasted link all
  // reach the input. Adjusted during render rather than from an effect: an
  // effect paints the stale value first and then corrects it, which on Clear
  // is a visible flash of the search somebody just cleared.
  const [syncedTo, setSyncedTo] = useState(q);
  if (syncedTo !== q) {
    setSyncedTo(q);
    setTyped(q);
  }

  // The same parser the query uses, so the hint under the box cannot claim to
  // be searching one column while the server searches another.
  const parsed = portalSearch(typed);

  const push = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete("page"); // any filter change invalidates the current page
    navigate(`/admin/delivery-portal?${next.toString()}`);
  };

  /** A quick chip is one day, so it clears any open range. */
  const oneDay = (d: string) =>
    date === d && !dateTo ? { date: null, to: null } : { date: d, to: null };

  /** The last N days, inclusive of today — the shape a backlog is worked in. */
  const lastDays = (n: number) => ({ date: istDaysAgo(n - 1), to: istToday() });

  const rangeActive = (n: number) => date === istDaysAgo(n - 1) && dateTo === istToday();

  const chip = (active: boolean, activeClass: string) =>
    `px-3 py-1.5 rounded-lg border text-xs transition-all ${
      active
        ? `${activeClass} font-semibold`
        : "border-neutral-200 text-neutral-600 hover:border-neutral-400 hover:text-neutral-900"
    }`;

  return (
    <div className="bg-white border border-neutral-200 rounded-2xl p-3.5 shadow-sm mb-4">
      {/* Finding ONE parcel, above the filters that choose a pile of them.
          It is the thing somebody reaches for mid-phone-call — "he's asking
          about his order" — and it narrows within everything below rather
          than replacing it, which is why it sits with them rather than in the
          page header. */}
      <div className="flex flex-wrap items-center gap-2 pb-3 mb-3 border-b border-neutral-100">
        <Search className="w-4 h-4 text-neutral-400" />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            push({ q: typed.trim() || null });
          }}
          className="flex items-center gap-2"
        >
          <input
            type="search"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Order number, mobile or name"
            aria-label="Search by order number, mobile or name"
            title="Type an order number, a mobile or a name, then press Enter"
            className="bg-white border border-neutral-300 rounded-lg px-2.5 py-1.5 text-xs w-64 focus:outline-none focus:border-primary-500 transition-colors"
          />
          <button
            type="submit"
            className="px-3 py-1.5 rounded-lg border border-neutral-300 text-xs text-neutral-700 hover:border-neutral-400 hover:text-neutral-900 transition-all"
          >
            Search
          </button>
        </form>

        {/* Which column it landed on, said before the search is run rather
            than guessed afterwards from the rows that come back. */}
        {parsed && (
          <span className="text-xs text-neutral-400">
            by {PORTAL_SEARCH_LABELS[parsed.kind]}
          </span>
        )}
        {!parsed && typed.trim() && (
          <span className="text-xs text-neutral-400">keep typing…</span>
        )}

        {q && (
          <button
            onClick={() => push({ q: null })}
            className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-900 transition-colors"
          >
            <X className="w-3 h-3" /> Clear search
          </button>
        )}
      </div>

      {/* The courier comes first because it decides what this screen *is* —
          a live view of a courier's own tracking, or the spreadsheet you copy
          addresses out of. Everything below narrows within that. */}
      {(couriers.length > 0 || downloadSlot) && (
        <div className="flex flex-wrap items-center gap-2 pb-3 mb-3 border-b border-neutral-100">
          {couriers.length > 0 && (
            <>
          <Truck className="w-4 h-4 text-neutral-400" />
          <label htmlFor="portal-courier" className="text-xs font-medium text-neutral-500">
            Courier
          </label>
          <select
            id="portal-courier"
            value={courier}
            onChange={(e) => push({ courier: e.target.value || null })}
            className="bg-white border border-neutral-300 rounded-lg px-2.5 py-1.5 text-xs cursor-pointer focus:outline-none focus:border-primary-500 transition-colors font-medium"
          >
            <option value="">All couriers</option>
            {couriers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {!courier && (
            <span className="text-xs text-neutral-400">
              Pick one to see its live tracking
            </span>
          )}

          {/* Only meaningful for a courier that reports its own scans. For
              anyone else there is no waybill to be missing, so the question
              has no answer and the control is not offered. */}
          {trackedCourierIds.includes(courier) && (
            <>
              <span className="w-px h-5 bg-neutral-200 mx-1" />
              <button
                onClick={() => push({ tracking: null })}
                className={chip(!tracking, "border-neutral-900 bg-neutral-900 text-white")}
              >
                All
              </button>
              {PORTAL_TRACKING.map((t) => (
                <button
                  key={t}
                  onClick={() => push({ tracking: tracking === t ? null : t })}
                  className={chip(
                    tracking === t,
                    t === "with"
                      ? "border-green-600 bg-green-50 text-green-700"
                      : "border-amber-500 bg-amber-50 text-amber-800"
                  )}
                >
                  {PORTAL_TRACKING_LABELS[t]}
                </button>
              ))}
            </>
          )}
            </>
          )}

          {/* Top right, and on its own end of the row: it acts on everything
              the filters below add up to, not on the courier beside it. */}
          {downloadSlot && <span className="ml-auto">{downloadSlot}</span>}
        </div>
      )}

      {/* What is happening to the parcel — a different question from where it
          is in the customer's journey, and the one that says whether anybody
          needs to do something. Above the fulfilment chips because it is the
          coarser cut. */}
      <div className="flex flex-wrap items-center gap-2 pb-3 mb-3 border-b border-neutral-100">
        <span className="text-xs font-medium text-neutral-500">State</span>
        <button
          onClick={() => push({ handover: null })}
          className={chip(!handover, "border-neutral-900 bg-neutral-900 text-white")}
        >
          Any
        </button>
        {HANDOVER_CHIPS.map((hs) => (
          <button
            key={hs}
            title={HANDOVER_HINTS[hs]}
            onClick={() => push({ handover: handover === hs ? null : hs })}
            className={chip(handover === hs, HANDOVER_TONE[hs])}
          >
            {HANDOVER_LABELS[hs]}
          </button>
        ))}
      </div>

      {/* What has to happen to the parcel before the box is taped shut.
          Its own row rather than sharing the one above: that one already
          carries eight handover chips, and thirteen buttons on a line wrap
          into something nobody can scan.

          Worth a filter because these are rare — about ten gifts in twelve
          hundred parcels, five of them signed. Rare is exactly the problem:
          nobody finds ten rows by scrolling, and the mistake it prevents, an
          unwrapped gift or an unsigned copy, is only ever discovered by the
          customer. */}
      <div className="flex flex-wrap items-center gap-2 pb-3 mb-3 border-b border-neutral-100">
        <Gift className="w-4 h-4 text-neutral-400" />
        <span className="text-xs font-medium text-neutral-500">Packing</span>
        <button
          onClick={() => push({ packing: null })}
          className={chip(!packing, "border-neutral-900 bg-neutral-900 text-white")}
        >
          Any
        </button>
        {PORTAL_PACKING.map((pk) => (
          <button
            key={pk}
            title={PORTAL_PACKING_HINTS[pk]}
            onClick={() => push({ packing: packing === pk ? null : pk })}
            className={chip(packing === pk, PACKING_TONE[pk])}
          >
            {PORTAL_PACKING_LABELS[pk]}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <CalendarDays className="w-4 h-4 text-neutral-400" />

        {/* Two inputs, either of which may stand alone: "since Monday" and
            "up to Thursday" are both things people ask for, and demanding
            both ends would turn each of them into a date somebody invents. */}
        <input
          type="date"
          value={date}
          max={dateTo || istToday()}
          title="From this day (the day the parcel was assigned)"
          onChange={(e) => push({ date: e.target.value || null })}
          className="bg-white border border-neutral-300 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-primary-500 transition-colors cursor-pointer"
        />
        <span className="text-xs text-neutral-400">to</span>
        <input
          type="date"
          value={dateTo}
          min={date || undefined}
          max={istToday()}
          title="Up to this day, included"
          onChange={(e) => push({ to: e.target.value || null })}
          className="bg-white border border-neutral-300 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-primary-500 transition-colors cursor-pointer"
        />

        <button
          onClick={() => push(oneDay(istToday()))}
          className={chip(date === istToday() && !dateTo, "border-primary-500 bg-primary-50 text-primary-700")}
        >
          Today
        </button>
        <button
          onClick={() => push(oneDay(istDaysAgo(1)))}
          className={chip(date === istDaysAgo(1) && !dateTo, "border-primary-500 bg-primary-50 text-primary-700")}
        >
          Yesterday
        </button>
        {/* The ranges a backlog is actually drained in. */}
        <button
          onClick={() => push(rangeActive(7) ? { date: null, to: null } : lastDays(7))}
          className={chip(rangeActive(7), "border-primary-500 bg-primary-50 text-primary-700")}
        >
          Last 7 days
        </button>
        <button
          onClick={() => push(rangeActive(30) ? { date: null, to: null } : lastDays(30))}
          className={chip(rangeActive(30), "border-primary-500 bg-primary-50 text-primary-700")}
        >
          Last 30 days
        </button>

        {/* Only rendered for someone who runs the queue — an agent has one
            possible answer, so a dropdown would be a control that does
            nothing. */}
        {agents.length > 0 && (
          <select
            value={agent}
            onChange={(e) => push({ agent: e.target.value || null })}
            className="bg-white border border-neutral-300 rounded-lg px-2.5 py-1.5 text-xs cursor-pointer focus:outline-none focus:border-primary-500 transition-colors"
          >
            <option value="">All agents</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        )}

        <span className="w-px h-6 bg-neutral-200 mx-1" />

        <button
          onClick={() => push({ status: null })}
          className={chip(!status, "border-neutral-900 bg-neutral-900 text-white")}
        >
          All
        </button>
        {PORTAL_FILTERS.map((s) => (
          <button
            key={s}
            onClick={() => push({ status: status === s ? null : s })}
            className={chip(status === s, STATUS_ACTIVE[s])}
          >
            {PORTAL_FILTER_LABELS[s]}
          </button>
        ))}

        <span className="w-px h-6 bg-neutral-200 mx-1" />

        {/* Applies on top of whatever is filtered above — the chips choose
            which parcels, this chooses which end of them is at the top. */}
        <ArrowDownUp className="w-3.5 h-3.5 text-neutral-400" />
        <select
          value={sort}
          // The default stays out of the URL, so a link is only ever longer
          // for having been changed from it.
          onChange={(e) => push({ sort: e.target.value === "oldest" ? "oldest" : null })}
          title="Which end of the queue to show first — by the day assigned"
          className="bg-white border border-neutral-300 rounded-lg px-2.5 py-1.5 text-xs cursor-pointer focus:outline-none focus:border-primary-500 transition-colors"
        >
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>

        <p className="text-xs text-neutral-500 ml-auto whitespace-nowrap">{countSlot}</p>

        {(date || dateTo || status || agent || courier || tracking || handover || packing || q || sort === "oldest") && (
          <button
            onClick={() => navigate("/admin/delivery-portal")}
            className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-900 transition-colors"
          >
            <X className="w-3 h-3" /> Clear
          </button>
        )}
      </div>
    </div>
  );
}

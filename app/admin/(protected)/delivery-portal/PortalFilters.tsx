"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowDownUp, CalendarDays, Search, Truck, X } from "lucide-react";
import { useNavigation } from "@/components/admin/Revalidating";
import {
  PORTAL_FILTERS,
  PORTAL_FILTER_LABELS,
  PORTAL_TRACKING,
  PORTAL_TRACKING_LABELS,
  PORTAL_PACKING,
  PORTAL_PACKING_LABELS,
  PORTAL_SEARCH_LABELS,
  portalSearch,
} from "@/lib/db/delivery-portal";
import { HANDOVER_CHIPS, HANDOVER_LABELS } from "@/lib/delivery/handover";
import { DELIVERY_MODES, DELIVERY_MODE_LABELS } from "@/lib/delivery-mode";

/** Today in IST as YYYY-MM-DD — the agent's browser may be in any timezone. */
function istToday(): string {
  return new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
}
function istDaysAgo(n: number): string {
  return new Date(Date.now() + 5.5 * 3600e3 - n * 864e5).toISOString().slice(0, 10);
}

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
export default function PortalFilters({
  countSlot,
  downloadSlot,
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
  // "New" is the portal's landing state (see page.tsx) — absent from the URL
  // means New, same as the server default. "All" is only ever reached by
  // explicitly picking it, which writes the param rather than clearing it.
  const status = params.get("status") ?? "new";
  const courier = params.get("courier") ?? "";
  const tracking = params.get("tracking") ?? "";
  const handover = params.get("handover") ?? "";
  const packing = params.get("packing") ?? "";
  const mode = params.get("mode") ?? "";
  const urgent = params.get("urgent") === "1";
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

      {/* Everything that narrows the pile, in one row now that Status, State
          and Packing are all dropdowns rather than chip rows — three separate
          bordered sections shrank to one. The courier picker stays first: it
          decides what this screen *is*, a live view of one courier's own
          tracking or the spreadsheet you copy addresses out of. */}
      <div className="flex flex-wrap items-center gap-2 pb-3 mb-3 border-b border-neutral-100">
        {couriers.length > 0 && (
          <>
            <Truck className="w-4 h-4 text-neutral-400" />
            <select
              value={courier}
              onChange={(e) => push({ courier: e.target.value || null })}
              title="Which courier's parcels — pick one to see its live tracking"
              className="bg-white border border-neutral-300 rounded-lg px-2.5 py-1.5 text-xs cursor-pointer focus:outline-none focus:border-primary-500 transition-colors font-medium"
            >
              <option value="">All couriers</option>
              {couriers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>

            {/* Only meaningful for a courier that reports its own scans — for
                anyone else there is no waybill to be missing, so the question
                has no answer and stays a two-way toggle rather than a third
                dropdown for one yes/no. */}
            {trackedCourierIds.includes(courier) && (
              <>
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

        {/* Where the parcel physically is — a different question from
            Status, which is what has been ticked off it. */}
        <select
          value={handover}
          onChange={(e) => push({ handover: e.target.value || null })}
          title="State — where the parcel actually is with the courier"
          className="bg-white border border-neutral-300 rounded-lg px-2.5 py-1.5 text-xs cursor-pointer focus:outline-none focus:border-primary-500 transition-colors"
        >
          <option value="">Any state</option>
          {HANDOVER_CHIPS.map((hs) => (
            <option key={hs} value={hs}>
              {HANDOVER_LABELS[hs]}
            </option>
          ))}
        </select>

        {/* Rare — about ten gifts in twelve hundred parcels, five of them
            signed — which is exactly why it stays findable as its own
            control instead of something you scroll a table looking for. */}
        <select
          value={packing}
          onChange={(e) => push({ packing: e.target.value || null })}
          title="Packing — gift-wrapped or signed copies, which need a table rather than a jiffy bag"
          className="bg-white border border-neutral-300 rounded-lg px-2.5 py-1.5 text-xs cursor-pointer focus:outline-none focus:border-primary-500 transition-colors"
        >
          <option value="">Any packing</option>
          {PORTAL_PACKING.map((pk) => (
            <option key={pk} value={pk}>
              {PORTAL_PACKING_LABELS[pk]}
            </option>
          ))}
        </select>

        {/* Who's paying, and when — a COD parcel needs cash collected at the
            door, which is a different job from a prepaid one on the same
            route. */}
        <select
          value={mode}
          onChange={(e) => push({ mode: e.target.value || null })}
          title="How this order gets paid for"
          className="bg-white border border-neutral-300 rounded-lg px-2.5 py-1.5 text-xs cursor-pointer focus:outline-none focus:border-primary-500 transition-colors"
        >
          <option value="">Prepaid & COD</option>
          {DELIVERY_MODES.map((m) => (
            <option key={m} value={m}>
              {DELIVERY_MODE_LABELS[m]}
            </option>
          ))}
        </select>

        {/* A direct sale can be flagged urgent at the counter (0063) — this is
            where that actually matters: the pile someone should be working
            first. A toggle, not a dropdown, for the same reason "All" isn't
            offered beside it — the only real question is on or off. */}
        <button
          onClick={() => push({ urgent: urgent ? null : "1" })}
          title="Only parcels flagged urgent at the counter"
          className={chip(urgent, "border-red-500 bg-red-50 text-red-700")}
        >
          Urgent only
        </button>

        {/* On its own end of the row: it acts on everything the filters add
            up to, not on the courier beside it. */}
        {downloadSlot && <span className="ml-auto">{downloadSlot}</span>}
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

        {/* One dropdown instead of eight buttons — same choices (PORTAL_FILTERS
            is unchanged), just not spelled out across the row any more.
            Defaults to New (see the `status` default above); picking All
            writes "all" explicitly rather than clearing the param, so the
            two stay distinguishable in the URL. */}
        <select
          value={status}
          onChange={(e) => push({ status: e.target.value })}
          title="Status — where the parcel is in the fulfilment pipeline"
          className="bg-white border border-neutral-300 rounded-lg px-2.5 py-1.5 text-xs cursor-pointer focus:outline-none focus:border-primary-500 transition-colors font-medium"
        >
          <option value="all">All</option>
          {PORTAL_FILTERS.map((s) => (
            <option key={s} value={s}>
              {PORTAL_FILTER_LABELS[s]}
            </option>
          ))}
        </select>

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

        {(date || dateTo || status !== "new" || courier || tracking || handover || packing || mode || urgent || q || sort === "oldest") && (
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

"use client";

import { useSearchParams } from "next/navigation";
import { ArrowDownUp, CalendarDays, Truck, X } from "lucide-react";
import { useNavigation } from "@/components/admin/Revalidating";
import {
  PORTAL_FILTERS,
  PORTAL_FILTER_LABELS,
  PORTAL_TRACKING,
  PORTAL_TRACKING_LABELS,
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
  delivered: "border-green-600 bg-green-50 text-green-700",
  returned: "border-rose-500 bg-rose-50 text-rose-700",
};

/**
 * One day, one status.
 *
 * A single date rather than a range: the portal is worked a day at a time, and
 * making someone fill two boxes to see today's parcels is friction on the most
 * common action there is.
 *
 * The day is the day the parcel was ASSIGNED, not the day it was ordered — the
 * same clock the list is sorted by, see migration 0046. So "Today" means the
 * batch handed out this morning, which is what someone opening this screen is
 * looking for. A parcel that went straight to a courier and was never assigned
 * to anybody falls back to its order date, and the grid marks those rows.
 */
export default function PortalFilters({
  countSlot,
  agents,
  couriers,
  trackedCourierIds,
}: {
  countSlot?: React.ReactNode;
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
  const status = params.get("status") ?? "";
  const agent = params.get("agent") ?? "";
  const courier = params.get("courier") ?? "";
  const tracking = params.get("tracking") ?? "";
  const handover = params.get("handover") ?? "";
  const sort = params.get("sort") === "oldest" ? "oldest" : "newest";

  const push = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete("page"); // any filter change invalidates the current page
    navigate(`/admin/delivery-portal?${next.toString()}`);
  };

  const chip = (active: boolean, activeClass: string) =>
    `px-3 py-1.5 rounded-lg border text-xs transition-all ${
      active
        ? `${activeClass} font-semibold`
        : "border-neutral-200 text-neutral-600 hover:border-neutral-400 hover:text-neutral-900"
    }`;

  return (
    <div className="bg-white border border-neutral-200 rounded-2xl p-3.5 shadow-sm mb-4">
      {/* The courier comes first because it decides what this screen *is* —
          a live view of a courier's own tracking, or the spreadsheet you copy
          addresses out of. Everything below narrows within that. */}
      {couriers.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 pb-3 mb-3 border-b border-neutral-100">
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

      <div className="flex flex-wrap items-center gap-2">
        <CalendarDays className="w-4 h-4 text-neutral-400" />

        <input
          type="date"
          value={date}
          max={istToday()}
          title="The day the parcel was assigned"
          onChange={(e) => push({ date: e.target.value || null })}
          className="bg-white border border-neutral-300 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-primary-500 transition-colors cursor-pointer"
        />

        <button
          onClick={() => push({ date: date === istToday() ? null : istToday() })}
          className={chip(date === istToday(), "border-primary-500 bg-primary-50 text-primary-700")}
        >
          Today
        </button>
        <button
          onClick={() => push({ date: date === istDaysAgo(1) ? null : istDaysAgo(1) })}
          className={chip(date === istDaysAgo(1), "border-primary-500 bg-primary-50 text-primary-700")}
        >
          Yesterday
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

        {(date || status || agent || courier || tracking || handover || sort === "oldest") && (
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

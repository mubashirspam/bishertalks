"use client";

import { useSearchParams } from "next/navigation";
import { CalendarDays, X } from "lucide-react";
import { useNavigation } from "@/components/admin/Revalidating";
import { PORTAL_STATUSES, PORTAL_STATUS_LABELS } from "@/lib/db/delivery-portal";
import type { DeliveryAgent } from "@/lib/db/staff";

/** Today in IST as YYYY-MM-DD — the agent's browser may be in any timezone. */
function istToday(): string {
  return new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
}
function istDaysAgo(n: number): string {
  return new Date(Date.now() + 5.5 * 3600e3 - n * 864e5).toISOString().slice(0, 10);
}

/** Matches the tick colours in the grid, so a filter looks like what it picks. */
const STATUS_ACTIVE: Record<string, string> = {
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
 */
export default function PortalFilters({
  countSlot,
  agents,
}: {
  countSlot?: React.ReactNode;
  /** Empty for an agent — they only ever see their own parcels. */
  agents: DeliveryAgent[];
}) {
  const params = useSearchParams();
  const { navigate } = useNavigation();

  const date = params.get("date") ?? "";
  const status = params.get("status") ?? "";
  const agent = params.get("agent") ?? "";
  const pending = params.get("pending") === "1";

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
      <div className="flex flex-wrap items-center gap-2">
        <CalendarDays className="w-4 h-4 text-neutral-400" />

        <input
          type="date"
          value={date}
          max={istToday()}
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

        {/* The agent's to-do list: paid, shippable, not yet keyed into the
            courier's system. This is the whole point of the Confirmed tick. */}
        <button
          onClick={() => push({ pending: pending ? null : "1" })}
          className={chip(pending, "border-blue-500 bg-blue-50 text-blue-700")}
        >
          To enter
        </button>

        <button
          onClick={() => push({ status: null })}
          className={chip(!status, "border-neutral-900 bg-neutral-900 text-white")}
        >
          All
        </button>
        {PORTAL_STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => push({ status: status === s ? null : s })}
            className={chip(status === s, STATUS_ACTIVE[s])}
          >
            {PORTAL_STATUS_LABELS[s]}
          </button>
        ))}

        <p className="text-xs text-neutral-500 ml-auto whitespace-nowrap">{countSlot}</p>

        {(date || status || pending || agent) && (
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

import { Suspense } from "react";
import Link from "next/link";
import { ScrollText } from "lucide-react";
import { requirePageAccess } from "@/lib/admin-auth";
import { SkeletonHeader, SkeletonTable } from "@/components/admin/Skeleton";
import { listMessages } from "@/lib/crm/messages";
import CrmTabs from "../CrmTabs";
import LogFilters from "./LogFilters";
import { RANGES, DEFAULT_RANGE } from "./ranges";

/** One screenful. Enough to scan, small enough that the count is the cost. */
const PER_PAGE = 50;

/**
 * The window to read, as UTC bounds.
 *
 * An explicit from/to wins over a quick range — two controls claiming to set
 * the same window is how a filter starts lying about what is on screen.
 *
 * `datetime-local` gives a wall-clock string with no zone. The admins are in
 * IST and the database is UTC, so it is read as IST here rather than as the
 * server's local time, which in production is neither.
 */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function istLocalToUtc(local: string): string | undefined {
  // "2026-08-29T14:30" → the same moment in UTC.
  const parsed = Date.parse(`${local}:00.000Z`);
  return Number.isNaN(parsed)
    ? undefined
    : new Date(parsed - IST_OFFSET_MS).toISOString();
}

function windowFor(params: { range?: string; from?: string; to?: string }): {
  from?: string;
  to?: string;
} {
  if (params.from || params.to) {
    return {
      from: params.from ? istLocalToUtc(params.from) : undefined,
      to: params.to ? istLocalToUtc(params.to) : undefined,
    };
  }

  const key = params.range ?? DEFAULT_RANGE;
  const range =
    RANGES.find((r) => r.key === key) ??
    RANGES.find((r) => r.key === DEFAULT_RANGE)!;
  // "All time" is the one window with no lower bound, and it is deliberately
  // not the default: this table grows with every message, campaign row and
  // refusal, so the unbounded read is the one that eventually times out.
  if (!range.hours) return {};
  return { from: new Date(Date.now() - range.hours * 3600_000).toISOString() };
}

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  sent: "bg-neutral-100 text-neutral-600 border-neutral-200",
  delivered: "bg-blue-50 text-blue-700 border-blue-200",
  read: "bg-green-50 text-green-700 border-green-200",
  failed: "bg-red-50 text-red-700 border-red-200",
  queued: "bg-amber-50 text-amber-700 border-amber-200",
};

/**
 * Every message, and every refusal.
 *
 * The screen that answers "did this customer get told?" in one search.
 * Refusals sit in the same list as sends, marked, because a message that was
 * deliberately not sent is an answer to that question — and one that would
 * otherwise look identical to a message that was never attempted.
 */
export default async function MessageLogPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    direction?: string;
    range?: string;
    from?: string;
    to?: string;
    page?: string;
  }>;
}) {
  await requirePageAccess("crm.view");
  const params = await searchParams;

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-black flex items-center gap-2">
          <ScrollText className="w-5 h-5 text-primary-500" /> Message log
        </h1>
        <p className="text-neutral-500 text-sm mt-1">
          Everything sent and received on the automated number, newest first —
          including messages the system refused to send, and why. Showing the
          last 7 days by default; widen the window above to go further back.
        </p>
      </div>

      <CrmTabs active="log" />

      <Suspense fallback={<><SkeletonHeader /><SkeletonTable rows={10} columns={5} /></>}>
        <Body params={params} />
      </Suspense>
    </div>
  );
}

async function Body({
  params,
}: {
  params: {
    status?: string;
    direction?: string;
    range?: string;
    from?: string;
    to?: string;
    page?: string;
  };
}) {
  const page = Math.max(0, parseInt(params.page ?? "1") - 1);
  const bounds = windowFor(params);

  const { rows, count } = await listMessages(
    {
      status: params.status,
      direction:
        params.direction === "in" || params.direction === "out"
          ? params.direction
          : undefined,
      ...bounds,
    },
    page,
    PER_PAGE
  );

  const totalPages = Math.ceil(count / PER_PAGE);

  const pageLink = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v && k !== "page") sp.set(k, String(v));
    }
    if (p > 1) sp.set("page", String(p));
    const qs = sp.toString();
    return `/admin/crm/log${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="space-y-4">
      <LogFilters count={count} showing={rows.length} />

      {!rows.length ? (
        <p className="rounded-xl border border-neutral-200 bg-white px-4 py-8 text-center text-sm text-neutral-400">
          Nothing in this window. Widen the range, or try All time.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-neutral-100 bg-neutral-50 text-left text-[10px] uppercase tracking-wider text-neutral-500">
                <th className="px-4 py-2.5 font-semibold">When</th>
                <th className="px-4 py-2.5 font-semibold">Who</th>
                <th className="px-4 py-2.5 font-semibold">Direction</th>
                <th className="px-4 py-2.5 font-semibold">Message</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {rows.map((m) => {
                // A refusal is stored as a failed send whose error begins
                // "Refused:" — the log calls that out rather than showing it as
                // something that broke.
                const refused = m.error?.startsWith("Refused:");
                return (
                  <tr key={m.id} className="align-top">
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs tabular-nums text-neutral-500">
                      {new Date(m.created_at).toLocaleString("en-IN", {
                        day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
                      })}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs">
                      <Link
                        href={`/admin/crm/${m.contact_id}`}
                        className="font-medium text-neutral-800 hover:text-primary-600"
                      >
                        {m.contact?.display_name?.trim() || m.contact?.phone || "—"}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs text-neutral-500">
                      {m.direction === "in" ? "Received" : "Sent"}
                      {m.template_name && (
                        <span className="ml-1 font-mono text-[10px] text-neutral-400">
                          {m.template_name}
                        </span>
                      )}
                    </td>
                    <td className="max-w-md px-4 py-2.5 text-xs text-neutral-700">
                      <p className="line-clamp-2 whitespace-pre-wrap break-words">
                        {m.body ?? <span className="italic text-neutral-400">({m.kind})</span>}
                      </p>
                      {m.error && (
                        <p
                          className={`mt-1 text-[11px] ${
                            refused ? "text-amber-700" : "text-red-700"
                          }`}
                        >
                          {m.error}
                        </p>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      {refused ? (
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-700">
                          Refused
                        </span>
                      ) : m.status ? (
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${
                            STATUS_STYLE[m.status] ?? STATUS_STYLE.sent
                          }`}
                        >
                          {m.status}
                        </span>
                      ) : (
                        <span className="text-[10px] text-neutral-400">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-neutral-500">
            Page {page + 1} of {totalPages.toLocaleString("en-IN")}
          </p>
          <div className="flex gap-2">
            {page > 0 && (
              <Link
                href={pageLink(page)}
                className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm transition-all hover:border-neutral-300"
              >
                ← Prev
              </Link>
            )}
            {page + 1 < totalPages && (
              <Link
                href={pageLink(page + 2)}
                className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm transition-all hover:border-neutral-300"
              >
                Next →
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

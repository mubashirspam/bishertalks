import { Suspense } from "react";
import Link from "next/link";
import { ScrollText } from "lucide-react";
import { requirePageAccess } from "@/lib/admin-auth";
import { SkeletonHeader, SkeletonTable } from "@/components/admin/Skeleton";
import { listMessages } from "@/lib/crm/messages";
import CrmTabs from "../CrmTabs";

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
  searchParams: Promise<{ status?: string; direction?: string }>;
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
          including messages the system refused to send, and why.
        </p>
      </div>

      <CrmTabs active="log" />

      <Suspense fallback={<><SkeletonHeader /><SkeletonTable rows={10} columns={5} /></>}>
        <Body status={params.status} direction={params.direction} />
      </Suspense>
    </div>
  );
}

async function Body({ status, direction }: { status?: string; direction?: string }) {
  const rows = await listMessages({
    status,
    direction: direction === "in" || direction === "out" ? direction : undefined,
  });

  const filters = [
    { label: "All", href: "/admin/crm/log", active: !status && !direction },
    { label: "Received", href: "/admin/crm/log?direction=in", active: direction === "in" },
    { label: "Sent", href: "/admin/crm/log?direction=out", active: direction === "out" },
    { label: "Failed", href: "/admin/crm/log?status=failed", active: status === "failed" },
    { label: "Read", href: "/admin/crm/log?status=read", active: status === "read" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {filters.map((f) => (
          <Link
            key={f.label}
            href={f.href}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
              f.active
                ? "border-primary-500 bg-primary-50 text-primary-700"
                : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300"
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {!rows.length ? (
        <p className="rounded-xl border border-neutral-200 bg-white px-4 py-8 text-center text-sm text-neutral-400">
          Nothing recorded yet.
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
    </div>
  );
}

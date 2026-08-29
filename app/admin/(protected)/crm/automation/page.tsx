import { Suspense } from "react";
import Link from "@/components/admin/AdminLink";
import { Bot, Info } from "lucide-react";
import { requirePageAccess } from "@/lib/admin-auth";
import { SkeletonHeader, SkeletonTable } from "@/components/admin/Skeleton";
import { listEvents, queueSummary } from "@/lib/crm/automation";
import { formatIST, timeAgo } from "@/lib/format-date";
import CrmTabs from "../CrmTabs";

export const dynamic = "force-dynamic";

const PER_PAGE = 50;

/**
 * What the system sends without being asked.
 *
 * This screen exists because that question had no answer. A rule scheduled to
 * fire "ten days after delivery" queued 700 people in a single run and
 * attempted 600 messages; the only visible symptom anywhere in the admin was
 * refusals accumulating in the message log, one row at a time, indistinguish-
 * able from any other failure.
 *
 * So: every queued follow-up, what put it there, and what became of it.
 */

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  sending: "bg-blue-50 text-blue-700 border-blue-200",
  sent: "bg-green-50 text-green-700 border-green-200",
  refused: "bg-neutral-100 text-neutral-600 border-neutral-200",
  failed: "bg-red-50 text-red-700 border-red-200",
  cancelled: "bg-neutral-50 text-neutral-400 border-neutral-200",
};

const EVENT_LABELS: Record<string, string> = {
  later_reminder: "Reminder about the book",
  reading_followup_10d: "10-day reading check",
  encouragement: "Reading encouragement",
  feedback_30d: "30-day feedback",
  referral_followup: "Referral follow-up",
};

export default async function AutomationPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  await requirePageAccess("crm.view");
  const params = await searchParams;

  return (
    <div>
      <div className="mb-5">
        <h1 className="flex items-center gap-2 text-2xl font-black">
          <Bot className="h-5 w-5 text-primary-500" /> Automation
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          Every message the system has queued on its own, what put it there,
          and whether it went.
        </p>
      </div>

      <CrmTabs active="automation" />

      <Suspense fallback={<><SkeletonHeader /><SkeletonTable rows={8} columns={5} /></>}>
        <Body status={params.status} page={Math.max(0, parseInt(params.page ?? "1") - 1)} />
      </Suspense>
    </div>
  );
}

async function Body({ status, page }: { status?: string; page: number }) {
  const [summary, { rows, count }] = await Promise.all([
    queueSummary(),
    listEvents({ status }, page, PER_PAGE),
  ]);

  const totalPages = Math.ceil(count / PER_PAGE);
  const link = (p: number) => {
    const sp = new URLSearchParams();
    if (status) sp.set("status", status);
    if (p > 1) sp.set("page", String(p));
    const qs = sp.toString();
    return `/admin/crm/automation${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="space-y-4">
      {/* What actually sends by itself, stated rather than inferred. Somebody
          reading this screen is asking exactly that. */}
      <p className="flex items-start gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          <strong>Only a customer&rsquo;s own button tap queues anything here.</strong>{" "}
          Tapping <em>Later</em> schedules one reminder; tapping{" "}
          <em>Recommend</em> schedules one referral follow-up. Nothing is sent
          on a timer to people who have not replied — the reading follow-ups
          and the 30-day feedback are{" "}
          <Link href="/admin/crm/campaigns" className="underline underline-offset-2">
            campaigns
          </Link>
          , filtered by how long ago the parcel arrived.
        </span>
      </p>

      <div className="flex flex-wrap gap-1.5">
        <Link
          href="/admin/crm/automation"
          className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
            !status
              ? "border-primary-500 bg-primary-50 text-primary-700"
              : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300"
          }`}
        >
          All {count.toLocaleString("en-IN")}
        </Link>
        {Object.entries(summary).map(([s, n]) => (
          <Link
            key={s}
            href={`/admin/crm/automation?status=${s}`}
            className={`rounded-full border px-3 py-1 text-xs font-medium capitalize transition ${
              status === s
                ? "border-primary-500 bg-primary-50 text-primary-700"
                : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300"
            }`}
          >
            {s} {n.toLocaleString("en-IN")}
          </Link>
        ))}
      </div>

      {!rows.length ? (
        <p className="rounded-xl border border-neutral-200 bg-white px-4 py-8 text-center text-sm text-neutral-400">
          Nothing queued.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-neutral-100 bg-neutral-50 text-left text-[10px] uppercase tracking-wider text-neutral-500">
                <th className="px-4 py-2.5 font-semibold">Who</th>
                <th className="px-4 py-2.5 font-semibold">What</th>
                <th className="px-4 py-2.5 font-semibold">Why it is queued</th>
                <th className="px-4 py-2.5 font-semibold">Due</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {rows.map((e) => (
                <tr key={e.id} className="align-top">
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs">
                    <Link
                      href={`/admin/crm/${e.contact_id}`}
                      className="font-medium text-neutral-800 hover:text-primary-600"
                    >
                      {e.contact?.display_name?.trim() || e.contact?.phone || "—"}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-neutral-700">
                    {EVENT_LABELS[e.event_type] ?? e.event_type}
                    {e.template_name && (
                      <span className="ml-1 font-mono text-[10px] text-neutral-400">
                        {e.template_name}
                      </span>
                    )}
                  </td>
                  {/* The column that matters most. A follow-up nobody can
                      explain is a follow-up nobody can defend. */}
                  <td className="max-w-xs px-4 py-2.5 text-xs text-neutral-500">
                    {e.created_reason ?? "—"}
                    {e.error && (
                      <p className="mt-0.5 text-[11px] text-neutral-400">{e.error}</p>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs tabular-nums text-neutral-500">
                    {formatIST(e.scheduled_at)}
                    <span className="ml-1 text-neutral-400">
                      ({timeAgo(e.scheduled_at)})
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${
                        STATUS_STYLE[e.status] ?? STATUS_STYLE.pending
                      }`}
                    >
                      {e.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-neutral-500">
            Page {page + 1} of {totalPages}
          </p>
          <div className="flex gap-2">
            {page > 0 && (
              <Link href={link(page)} className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm hover:border-neutral-300">
                ← Prev
              </Link>
            )}
            {page + 1 < totalPages && (
              <Link href={link(page + 2)} className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm hover:border-neutral-300">
                Next →
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

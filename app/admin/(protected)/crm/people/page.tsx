import { Suspense } from "react";
import { Users, Megaphone, MessageSquare, Ban } from "lucide-react";
import Link from "@/components/admin/AdminLink";
import { requirePageAccess } from "@/lib/admin-auth";
import { can } from "@/lib/permissions";
import { SkeletonTable } from "@/components/admin/Skeleton";
import { NavigationPending, StaleWhileRevalidating } from "@/components/admin/Revalidating";
import { formatISTShort, timeAgo } from "@/lib/format-date";
import {
  listPeople,
  peopleDistricts,
  isPersonStage,
  isPriority,
  PERSON_STAGE_LABELS,
  PRIORITY_LABELS,
  PRIORITY_TONE,
  type PeopleFilters as Filters,
} from "@/lib/crm/people";
import CrmTabs from "../CrmTabs";
import PeopleFilters from "./PeopleFilters";

export const dynamic = "force-dynamic";

/** One screenful. Long enough to work down, short enough to render fast. */
const PER_PAGE = 50;

/**
 * Everyone who ever left us a phone number, one row each.
 *
 * The screen the campaign composer should have been built on. Its whole job is
 * that a person appears once, in the bucket that matches the furthest they
 * ever got — so "payment failed" means "still owes us money", not "has ever
 * had a payment fail". In this database those two differ by 149 people who
 * have since paid, and every one of them was in range of a campaign telling
 * them their payment did not go through.
 */
export default async function CrmPeoplePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const staff = await requirePageAccess("crm.view");
  const params = await searchParams;

  const filters: Filters = {
    stage: isPersonStage(params.stage) ? params.stage : undefined,
    priority: isPriority(params.priority) ? params.priority : undefined,
    messaged: params.messaged === "yes" || params.messaged === "no" ? params.messaged : undefined,
    replied: params.replied === "1" || undefined,
    // Opted-out people are hidden unless asked for. They can never be
    // messaged, so leaving them in every count would overstate every campaign
    // by however many of them there are.
    contactableOnly: params.stopped !== "1",
    q: params.q,
    district: params.district,
    from: params.from,
    to: params.to,
  };

  const page = Math.max(0, parseInt(params.page ?? "1") - 1);

  return (
    <NavigationPending>
      <div className="mb-5">
        <h1 className="text-2xl font-black flex items-center gap-2">
          <Users className="w-5 h-5 text-primary-500" /> People
        </h1>
        <p className="text-neutral-500 text-sm mt-1">
          One row per phone number, in the bucket for the furthest they ever
          got. Somebody who failed five times and then paid is a customer here,
          and appears nowhere else.
        </p>
      </div>

      <CrmTabs active="people" />

      <Suspense fallback={<SkeletonTable rows={10} columns={6} />}>
        <Body filters={filters} page={page} mayCampaign={can(staff, "crm.campaign")} />
      </Suspense>
    </NavigationPending>
  );
}

async function Body({
  filters,
  page,
  mayCampaign,
}: {
  filters: Filters;
  page: number;
  mayCampaign: boolean;
}) {
  const [result, districts] = await Promise.all([
    listPeople(filters, page, PER_PAGE),
    peopleDistricts(),
  ]);

  const totalPages = Math.ceil(result.total / PER_PAGE);

  // The campaign composer, opened with this filter already in it. The link
  // carries only the person-level parts, because those are the ones the
  // composer can rebuild into the identical segment.
  const campaignHref = () => {
    const sp = new URLSearchParams();
    if (filters.stage) sp.set("stage", filters.stage);
    if (filters.priority) sp.set("priority", filters.priority);
    if (filters.messaged) sp.set("messaged", filters.messaged);
    if (filters.district) sp.set("district", filters.district);
    return `/admin/crm/campaigns?${sp.toString()}`;
  };

  const pageLink = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries({
      stage: filters.stage,
      priority: filters.priority,
      messaged: filters.messaged,
      district: filters.district,
      q: filters.q,
      from: filters.from,
      to: filters.to,
      replied: filters.replied ? "1" : undefined,
      stopped: filters.contactableOnly ? undefined : "1",
    })) {
      if (v) sp.set(k, String(v));
    }
    if (p > 1) sp.set("page", String(p));
    const qs = sp.toString();
    return `/admin/crm/people${qs ? `?${qs}` : ""}`;
  };

  const cell = "px-3 py-2 whitespace-nowrap";
  const th =
    "px-3 py-2.5 font-semibold text-neutral-500 uppercase tracking-wider whitespace-nowrap text-left";

  return (
    <>
      <PeopleFilters
        stageCounts={result.stageCounts}
        priorityCounts={result.priorityCounts}
        messagedCounts={result.messagedCounts}
        districts={districts}
        total={result.total}
        totalPeople={result.totalPeople}
        actionSlot={
          mayCampaign && result.total > 0 ? (
            <Link
              href={campaignHref()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-primary-500 bg-primary-500 text-white text-xs font-semibold hover:bg-primary-600 transition-all"
            >
              <Megaphone className="w-3.5 h-3.5" />
              Campaign to these {result.total.toLocaleString("en-IN")}
            </Link>
          ) : null
        }
      />

      <StaleWhileRevalidating>
        {!result.rows.length ? (
          <div className="bg-white border border-neutral-200 rounded-2xl p-12 text-center text-neutral-500 shadow-sm">
            Nobody matches those filters.
          </div>
        ) : (
          <div className="bg-white border border-neutral-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-neutral-50 border-b border-neutral-100">
                  <tr>
                    <th className={th}>Name</th>
                    <th className={th}>Mobile</th>
                    <th className={th}>Stage</th>
                    <th className={th}>Priority</th>
                    <th className={`${th} text-right`}>Tries</th>
                    <th className={th}>Last order</th>
                    <th className={th}>Messaged</th>
                  </tr>
                </thead>

                <tbody>
                  {result.rows.map((p) => (
                    <tr
                      key={p.phone}
                      className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50/70"
                    >
                      <td className={`${cell} font-medium text-neutral-900`}>
                        {/* Straight into the conversation where there is one;
                            there is nothing to open for somebody this system
                            has never had a message with. */}
                        {p.contactId ? (
                          <Link
                            href={`/admin/crm/${p.contactId}`}
                            className="hover:text-primary-600 hover:underline underline-offset-2"
                          >
                            {p.name ?? "No name"}
                          </Link>
                        ) : (
                          (p.name ?? <span className="text-neutral-400">No name</span>)
                        )}
                        {p.optedOut && (
                          <span
                            title="Asked us to stop. Nothing will ever be sent to them."
                            className="ml-1.5 inline-flex items-center gap-0.5 px-1.5 rounded-full bg-red-100 text-red-700 text-[10px] font-bold align-middle"
                          >
                            <Ban className="w-2.5 h-2.5" /> stopped
                          </span>
                        )}
                        {p.repliedAt && (
                          <span
                            title={`Wrote to us ${timeAgo(p.repliedAt)}`}
                            className="ml-1.5 inline-flex items-center gap-0.5 px-1.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold align-middle"
                          >
                            <MessageSquare className="w-2.5 h-2.5" /> replied
                          </span>
                        )}
                      </td>

                      <td className={`${cell} text-neutral-700 font-mono`}>{p.phone}</td>

                      <td className={cell}>
                        <span className="text-neutral-700">
                          {PERSON_STAGE_LABELS[p.stage]}
                        </span>
                      </td>

                      <td className={cell}>
                        <span
                          className={`inline-flex px-1.5 py-0.5 rounded-full border text-[10px] font-bold ${PRIORITY_TONE[p.priority]}`}
                        >
                          {PRIORITY_LABELS[p.priority]}
                        </span>
                      </td>

                      {/* Unpaid attempts, not orders. Eight of these is one
                          person who tried eight times and never got through —
                          the single most useful number on the row. */}
                      <td className={`${cell} text-right tabular-nums`}>
                        {p.attempts > 0 ? (
                          <span className={p.attempts >= 3 ? "font-bold text-rose-700" : ""}>
                            {p.attempts}
                          </span>
                        ) : (
                          <span className="text-neutral-300">—</span>
                        )}
                        {p.paidOrders > 1 && (
                          <span
                            title={`${p.paidOrders} paid orders`}
                            className="ml-1.5 text-[10px] font-bold text-green-700"
                          >
                            ×{p.paidOrders} paid
                          </span>
                        )}
                      </td>

                      <td className={`${cell} text-neutral-500`}>
                        <Link
                          href={`/admin/orders/${p.lastOrderNumber}`}
                          className="font-mono text-neutral-600 hover:text-primary-600 hover:underline underline-offset-2"
                        >
                          {p.lastOrderNumber}
                        </Link>
                        <span className="text-neutral-400"> · {formatISTShort(p.lastAt)}</span>
                      </td>

                      <td className={cell}>
                        {p.messagedAt ? (
                          <span className="text-neutral-600" title={formatISTShort(p.messagedAt)}>
                            {timeAgo(p.messagedAt)}
                          </span>
                        ) : (
                          <span className="text-neutral-400">Never</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4">
            <p className="text-neutral-500 text-xs">
              Page {page + 1} of {totalPages}
            </p>
            <div className="flex gap-2">
              {page > 0 && (
                <Link
                  href={pageLink(page)}
                  className="px-3 py-1.5 rounded-lg bg-white border border-neutral-200 text-sm hover:border-neutral-300 transition-all"
                >
                  ← Prev
                </Link>
              )}
              {page + 1 < totalPages && (
                <Link
                  href={pageLink(page + 2)}
                  className="px-3 py-1.5 rounded-lg bg-white border border-neutral-200 text-sm hover:border-neutral-300 transition-all"
                >
                  Next →
                </Link>
              )}
            </div>
          </div>
        )}
      </StaleWhileRevalidating>
    </>
  );
}

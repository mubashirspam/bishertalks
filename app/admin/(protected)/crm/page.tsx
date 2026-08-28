import { Suspense } from "react";
import Link from "next/link";
import { Inbox, AlertTriangle, Ban, Clock, PauseCircle } from "lucide-react";
import { requirePageAccess } from "@/lib/admin-auth";
import { SkeletonHeader, SkeletonTable } from "@/components/admin/Skeleton";
import {
  listConversations,
  windowState,
  formatWindow,
  getSettings,
  sentToday,
} from "@/lib/crm/contacts";
import { latestHealth, ratingTone } from "@/lib/crm/health";
import CrmTabs from "./CrmTabs";

export const dynamic = "force-dynamic";

/**
 * The inbox.
 *
 * The default CRM screen because it is the one with work in it: a customer
 * who wrote to us and has not been answered is the only thing here that is
 * time-limited. Everything else — contacts, campaigns, health — is reference
 * or deliberate action.
 */
export default async function CrmInboxPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; q?: string }>;
}) {
  await requirePageAccess("crm.view");
  const params = await searchParams;

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-black flex items-center gap-2">
          <Inbox className="w-5 h-5 text-primary-500" /> WhatsApp CRM
        </h1>
        <p className="text-neutral-500 text-sm mt-1">
          Conversations on the automated number. Replies are free text for 24
          hours after the customer writes; after that only an approved template
          can be sent.
        </p>
      </div>

      <CrmTabs active="inbox" />

      <Suspense fallback={<><SkeletonHeader /><SkeletonTable rows={8} columns={4} /></>}>
        <Body filter={params.filter} q={params.q} />
      </Suspense>
    </div>
  );
}

async function Body({ filter, q }: { filter?: string; q?: string }) {
  const [health, settings, today] = await Promise.all([
    latestHealth(),
    getSettings(),
    sentToday(),
  ]);

  const conversations = await listConversations({
    q,
    unread: filter === "unread",
    windowOpen: filter === "open",
    optedOut: filter === "stopped" ? true : filter === "active" ? false : undefined,
  });

  const tone = ratingTone(health?.quality_rating ?? null);

  return (
    <div className="space-y-4">
      {/* ── The two things that stop everything ────────────────────────── */}
      {settings.sending_paused && (
        <p className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <PauseCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <strong>All sending is paused.</strong>{" "}
            {settings.paused_reason ?? ""}
            {settings.paused_by_email ? ` — ${settings.paused_by_email}` : ""}
          </span>
        </p>
      )}

      {tone !== "good" && (
        <p
          className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${
            tone === "bad"
              ? "border-red-200 bg-red-50 text-red-800"
              : tone === "warn"
                ? "border-amber-200 bg-amber-50 text-amber-800"
                : "border-neutral-200 bg-neutral-50 text-neutral-600"
          }`}
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {health?.quality_rating
              ? `Number quality is ${health.quality_rating}. ${
                  tone === "bad"
                    ? "Nothing is sending."
                    : "Only order notifications are sending."
                }`
              : "Number health has not been checked yet — run the health cron."}
          </span>
        </p>
      )}

      {/* ── Budget strip ───────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-xs text-neutral-600">
        <span>
          <span className="text-neutral-400">Sent today:</span>{" "}
          <strong className="tabular-nums">{today.total}</strong> of{" "}
          {settings.daily_budget}
        </span>
        <span>
          <span className="text-neutral-400">Campaign messages:</span>{" "}
          <strong className="tabular-nums">{today.campaign}</strong> of{" "}
          {settings.campaign_daily_cap}
        </span>
        {health?.quality_rating && (
          <span>
            <span className="text-neutral-400">Quality:</span>{" "}
            <strong>{health.quality_rating}</strong>
          </span>
        )}
      </div>

      {/* ── Filters ────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-1.5">
        {[
          { key: undefined, label: "All" },
          { key: "unread", label: "Unread" },
          { key: "open", label: "Window open" },
          { key: "stopped", label: "Stopped" },
        ].map((f) => (
          <Link
            key={f.label}
            href={f.key ? `/admin/crm?filter=${f.key}` : "/admin/crm"}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
              filter === f.key
                ? "border-primary-500 bg-primary-50 text-primary-700"
                : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300"
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {/* ── Conversations ──────────────────────────────────────────────── */}
      {!conversations.length ? (
        <p className="rounded-xl border border-neutral-200 bg-white px-4 py-8 text-center text-sm text-neutral-400">
          Nothing here yet. Conversations appear once a customer replies to a
          message from the automated number.
        </p>
      ) : (
        <div className="divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-200 bg-white">
          {conversations.map((c) => {
            const win = windowState(c.last_inbound_at);
            return (
              <Link
                key={c.id}
                href={`/admin/crm/${c.id}`}
                className="flex items-center gap-3 px-4 py-3 transition hover:bg-neutral-50"
              >
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-semibold text-neutral-900">
                    <span className="truncate">
                      {c.display_name?.trim() || c.phone}
                    </span>
                    {c.unread_count > 0 && (
                      <span className="shrink-0 rounded-full bg-primary-500 px-1.5 py-0.5 text-[10px] font-bold text-white tabular-nums">
                        {c.unread_count}
                      </span>
                    )}
                    {c.opt_out_at && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700">
                        <Ban className="h-3 w-3" /> Stopped
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-neutral-400 tabular-nums">
                    {c.phone}
                    {c.last_order_number ? ` · ${c.last_order_number}` : ""}
                  </p>
                </div>

                <div className="shrink-0 text-right">
                  {win.open ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[10px] font-semibold text-green-700">
                      <Clock className="h-3 w-3" />
                      {formatWindow(win.remainingMs)}
                    </span>
                  ) : (
                    <span className="text-[10px] text-neutral-400">
                      {c.last_inbound_at ? "Window closed" : "Never replied"}
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

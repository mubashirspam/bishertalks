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
import { flagsFor, flagCounts } from "@/lib/crm/tags";
import { FLAGS, FLAG_LABELS, FLAG_TONE, isFlag } from "@/lib/crm/tag-labels";
import CrmTabs from "./CrmTabs";
import InboxShell, { type ConversationRow } from "./InboxShell";

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
  searchParams: Promise<{ filter?: string; flag?: string; q?: string; c?: string }>;
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
        <Body
          filter={params.filter}
          flag={isFlag(params.flag) ? params.flag : undefined}
          q={params.q}
          selected={params.c}
        />
      </Suspense>
    </div>
  );
}

async function Body({
  filter,
  flag,
  q,
  selected,
}: {
  filter?: string;
  /** `?flag=delivery_issue` — only people carrying that flag. */
  flag?: string;
  q?: string;
  /** `?c=<id>` — the conversation to open on first paint. */
  selected?: string;
}) {
  const [health, settings, today, flagTotals, conversations] = await Promise.all([
    latestHealth(),
    getSettings(),
    sentToday(),
    flagCounts(),
    listConversations({
      q,
      unread: filter === "unread",
      windowOpen: filter === "open",
      optedOut: filter === "stopped" ? true : filter === "active" ? false : undefined,
      tag: flag,
    }),
  ]);

  const flagMap = await flagsFor(conversations.map((c) => c.id));

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
              !flag && filter === f.key
                ? "border-primary-500 bg-primary-50 text-primary-700"
                : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300"
            }`}
          >
            {f.label}
          </Link>
        ))}

        <span className="mx-1 h-6 w-px bg-neutral-200" />

        {/* Flagged people. Tapping an active one again clears it. */}
        {FLAGS.map((f) => (
          <Link
            key={f}
            href={flag === f ? "/admin/crm" : `/admin/crm?flag=${f}`}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
              flag === f
                ? FLAG_TONE[f]
                : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300"
            }`}
          >
            {FLAG_LABELS[f]}
            <span className="ml-1 tabular-nums opacity-70">{flagTotals[f]}</span>
          </Link>
        ))}
      </div>

      {/* ── Conversations ──────────────────────────────────────────────── */}
      {/*
        Two panes, and no navigation between them. Each row used to be a link
        into a server-rendered thread page, so opening somebody rebuilt this
        entire screen — list included — and sending a reply did it again. See
        InboxShell.
      */}
      <InboxShell
        // InboxShell copies its rows into state, so without a key a filter
        // change would re-render it with the previous filter's list.
        key={`${filter ?? ""}|${flag ?? ""}|${q ?? ""}`}
        conversations={conversations.map((c): ConversationRow => {
          const win = windowState(c.last_inbound_at);
          return {
            id: c.id,
            phone: c.phone,
            displayName: c.display_name,
            unread: c.unread_count,
            optedOut: !!c.opt_out_at,
            lastOrderNumber: c.last_order_number,
            lastInboundAt: c.last_inbound_at,
            windowOpen: win.open,
            windowLabel: formatWindow(win.remainingMs),
            flags: flagMap.get(c.id) ?? [],
          };
        })}
        initialId={selected ?? null}
      />
    </div>
  );
}

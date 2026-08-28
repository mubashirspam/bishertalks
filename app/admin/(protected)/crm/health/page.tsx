import { Suspense } from "react";
import { Activity } from "lucide-react";
import { requirePageAccess } from "@/lib/admin-auth";
import { can } from "@/lib/permissions";
import { SkeletonHeader, SkeletonTable } from "@/components/admin/Skeleton";
import { latestHealth, healthHistory, ratingTone } from "@/lib/crm/health";
import { getSettings, sentToday } from "@/lib/crm/contacts";
import { supabaseAdmin } from "@/lib/supabase/admin";
import CrmTabs from "../CrmTabs";
import KillSwitch from "./KillSwitch";

export const dynamic = "force-dynamic";

const TONE_CLASS = {
  good: "border-green-200 bg-green-50 text-green-700",
  warn: "border-amber-200 bg-amber-50 text-amber-700",
  bad: "border-red-200 bg-red-50 text-red-700",
  unknown: "border-neutral-200 bg-neutral-50 text-neutral-500",
};

/**
 * The number's vital signs, and the switch that stops everything.
 *
 * The rating moves after the damage is done, so the two numbers worth reading
 * daily are further down: opt-outs in the last week, and undeliverable sends.
 * Both move first.
 */
export default async function HealthPage() {
  const staff = await requirePageAccess("crm.view");

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-black flex items-center gap-2">
          <Activity className="w-5 h-5 text-primary-500" /> Number health
        </h1>
        <p className="text-neutral-500 text-sm mt-1">
          The sending number&rsquo;s standing with Meta. A rating that leaves
          green stops campaigns automatically; red stops everything.
        </p>
      </div>

      <CrmTabs active="health" />

      <Suspense fallback={<><SkeletonHeader /><SkeletonTable rows={6} columns={4} /></>}>
        <Body canPause={can(staff, "crm.campaign")} />
      </Suspense>
    </div>
  );
}

async function Body({ canPause }: { canPause: boolean }) {
  const [latest, history, settings, today, signals] = await Promise.all([
    latestHealth(),
    healthHistory(30),
    getSettings(),
    sentToday(),
    leadingSignals(),
  ]);

  const tone = ratingTone(latest?.quality_rating ?? null);

  return (
    <div className="space-y-6">
      <KillSwitch
        paused={settings.sending_paused}
        reason={settings.paused_reason}
        by={settings.paused_by_email}
        canPause={canPause}
      />

      {/* ── Current state ──────────────────────────────────────────────── */}
      <div className="grid gap-px overflow-hidden rounded-xl border border-neutral-200 bg-neutral-200 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Quality rating">
          <span
            className={`inline-block rounded-full border px-2.5 py-1 text-xs font-bold ${TONE_CLASS[tone]}`}
          >
            {latest?.quality_rating ?? "Not checked"}
          </span>
        </Tile>
        <Tile label="Messaging tier">{latest?.messaging_tier ?? "—"}</Tile>
        <Tile label="Display name">{latest?.name_status ?? "—"}</Tile>
        <Tile label="Sent today">
          <span className="tabular-nums">
            {today.total} / {settings.daily_budget}
          </span>
        </Tile>
      </div>

      {latest?.error && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Last check failed: {latest.error}
        </p>
      )}

      {/* ── The numbers that move first ────────────────────────────────── */}
      <section>
        <h2 className="mb-1 text-sm font-bold uppercase tracking-wider text-neutral-500">
          Leading indicators
        </h2>
        <p className="mb-3 max-w-2xl text-xs text-neutral-500">
          The quality rating confirms damage that has already happened. These
          two move before it does — watch them, not the rating.
        </p>
        <div className="grid gap-px overflow-hidden rounded-xl border border-neutral-200 bg-neutral-200 sm:grid-cols-2">
          <Tile label="Customers who asked to stop, last 7 days">
            <span
              className={`tabular-nums ${signals.optOuts > 0 ? "text-amber-700" : ""}`}
            >
              {signals.optOuts}
            </span>
          </Tile>
          <Tile label="Undeliverable sends, last 7 days">
            <span
              className={`tabular-nums ${signals.undeliverable > 0 ? "text-amber-700" : ""}`}
            >
              {signals.undeliverable}
            </span>
          </Tile>
        </div>
      </section>

      {/* ── History ────────────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-neutral-500">
          Last 30 days
        </h2>
        {!history.length ? (
          <p className="rounded-xl border border-neutral-200 bg-white px-4 py-6 text-center text-sm text-neutral-400">
            No checks recorded yet. Schedule{" "}
            <code className="rounded bg-neutral-100 px-1 py-0.5 text-xs">
              /api/cron/whatsapp-health
            </code>{" "}
            daily with the cron secret.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-100 bg-neutral-50 text-left text-[10px] uppercase tracking-wider text-neutral-500">
                  <th className="px-4 py-2.5 font-semibold">Checked</th>
                  <th className="px-4 py-2.5 font-semibold">Quality</th>
                  <th className="px-4 py-2.5 font-semibold">Tier</th>
                  <th className="px-4 py-2.5 font-semibold">Name status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {history.map((h) => (
                  <tr key={h.checked_at}>
                    <td className="px-4 py-2.5 text-xs tabular-nums text-neutral-600">
                      {new Date(h.checked_at).toLocaleString("en-IN", {
                        day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
                      })}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                          TONE_CLASS[ratingTone(h.quality_rating)]
                        }`}
                      >
                        {h.quality_rating ?? "—"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-neutral-600">
                      {h.messaging_tier ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-neutral-600">
                      {h.name_status ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-white px-4 py-3.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
        {label}
      </p>
      <p className="mt-1.5 text-base font-bold text-neutral-900">{children}</p>
    </div>
  );
}

/** The two counts that move before the rating does. */
async function leadingSignals(): Promise<{ optOuts: number; undeliverable: number }> {
  const since = new Date(Date.now() - 7 * 86400000).toISOString();

  const [{ count: optOuts }, { count: undeliverable }] = await Promise.all([
    supabaseAdmin
      .from("whatsapp_contacts")
      .select("id", { count: "exact", head: true })
      .eq("opt_out_source", "customer")
      .gte("opt_out_at", since),
    supabaseAdmin
      .from("whatsapp_messages")
      .select("id", { count: "exact", head: true })
      .eq("status", "failed")
      .in("error_code", [131026, 131049, 131047, 470])
      .gte("created_at", since),
  ]);

  return { optOuts: optOuts ?? 0, undeliverable: undeliverable ?? 0 };
}

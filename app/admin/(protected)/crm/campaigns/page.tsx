import { Suspense } from "react";
import { Megaphone, AlertTriangle } from "lucide-react";
import { requirePageAccess } from "@/lib/admin-auth";
import { can } from "@/lib/permissions";
import { SkeletonHeader, SkeletonTable } from "@/components/admin/Skeleton";
import { listCampaigns } from "@/lib/crm/campaigns";
import { approvedTemplates } from "@/lib/crm/health";
import { CAMPAIGN_TEMPLATES } from "@/lib/whatsapp-templates";
import { getSettings } from "@/lib/crm/contacts";
import CrmTabs from "../CrmTabs";
import CampaignManager from "./CampaignManager";

export const dynamic = "force-dynamic";

/**
 * Bulk sends.
 *
 * The riskiest screen in the admin, and the copy says so rather than leaving
 * someone to find out. Everything protective sits in the code path — the gate,
 * the caps, the auto-halt — but a person about to message four hundred people
 * who never paid should be told what that costs if it goes wrong.
 */
export default async function CampaignsPage() {
  const staff = await requirePageAccess("crm.view");

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-black flex items-center gap-2">
          <Megaphone className="w-5 h-5 text-primary-500" /> Campaigns
        </h1>
        <p className="text-neutral-500 text-sm mt-1">
          Send one approved template to a group of customers. Messages go out
          slowly, in batches, and stop by themselves if people start opting out.
        </p>
      </div>

      <CrmTabs active="campaigns" />

      <Suspense fallback={<><SkeletonHeader /><SkeletonTable rows={4} columns={5} /></>}>
        <Body canRun={can(staff, "crm.campaign")} />
      </Suspense>
    </div>
  );
}

async function Body({ canRun }: { canRun: boolean }) {
  const [campaigns, approved, settings] = await Promise.all([
    listCampaigns(),
    approvedTemplates(),
    getSettings(),
  ]);

  const approvedNames = new Set(approved.map((t) => t.name));
  const templates = Object.values(CAMPAIGN_TEMPLATES).map((t) => ({
    name: t.name,
    category: t.category,
    body: t.body,
    approved: approvedNames.has(t.name),
  }));

  const usable = templates.filter((t) => t.approved);

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3.5 text-sm text-amber-900">
        <p className="flex items-center gap-1.5 font-bold">
          <AlertTriangle className="h-4 w-4" /> Read this before your first
          campaign
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] leading-relaxed">
          <li>
            People who never paid are the highest-risk audience there is.
            Blocks and reports from them are what move the number&rsquo;s quality
            rating, and a bad rating stops your order notifications too.
          </li>
          <li>
            Keep the first send at <strong>50 people</strong>. Read the opt-out
            rate before the second batch.
          </li>
          <li>
            If more than {settings.halt_optout_percent}% of recipients ask to
            stop, the campaign halts itself. That is a sign the segment is
            wrong — not that the wording needs another try.
          </li>
        </ul>
      </div>

      {!usable.length && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <strong>No campaign template is approved yet.</strong> The two written
          ones still have to be submitted to Meta and approved before anything
          can be sent. Until then this screen can only show you what a campaign
          would do.
        </p>
      )}

      <CampaignManager
        campaigns={campaigns.map((c) => ({
          id: c.id,
          name: c.name,
          templateName: c.template_name,
          status: c.status,
          haltReason: c.halt_reason,
          cap: c.recipient_cap,
          sent: c.sent_count,
          failed: c.failed_count,
          refused: c.refused_count,
          createdBy: c.created_by_email,
          createdAt: c.created_at,
        }))}
        templates={templates}
        canRun={canRun}
        defaultCap={50}
      />
    </div>
  );
}

export const dynamic = "force-dynamic";
export const maxDuration = 120;

import { NextRequest, NextResponse } from "next/server";
import { cronAuthorised } from "@/lib/cron-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { runCampaignBatch, type Campaign, type WorkerReport } from "@/lib/crm/campaigns";
import { getSettings } from "@/lib/crm/contacts";

/**
 * The campaign worker.
 *
 * Drains one small batch from each sending campaign and stops. Pacing is the
 * feature, not a limitation: a campaign spread over hours gives the opt-out
 * rate time to tell you to stop, and there is nothing urgent about a
 * promotional message. Run it every fifteen minutes or so.
 *
 * Every recipient passes the send gate individually, so a contact who opted
 * out after the campaign was queued is refused on their own row rather than
 * messaged because the list is an hour old.
 *
 * Schedule with `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(request: NextRequest) {
  if (!cronAuthorised(request, "WhatsAppCampaigns")) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const settings = await getSettings();
  if (settings.sending_paused) {
    return NextResponse.json({
      ok: true,
      skipped: "Sending is paused",
      reports: [],
    });
  }

  const { data } = await supabaseAdmin
    .from("whatsapp_campaigns")
    .select(
      "id, name, template_name, segment, status, halt_reason, recipient_cap, " +
        "sent_count, failed_count, refused_count, optout_count, created_by_email, " +
        "started_at, finished_at, created_at"
    )
    .eq("status", "sending")
    .order("started_at", { ascending: true })
    .limit(5);

  const campaigns = (data ?? []) as unknown as Campaign[];
  const reports: WorkerReport[] = [];

  for (const campaign of campaigns) {
    try {
      reports.push(await runCampaignBatch(campaign));
    } catch (e) {
      // One broken campaign must not stop the others, and it must not be
      // retried forever either — halt it and say why.
      console.error("[WhatsAppCampaigns] batch threw:", campaign.id, e);
      await supabaseAdmin
        .from("whatsapp_campaigns")
        .update({
          status: "halted",
          halt_reason: e instanceof Error ? e.message.slice(0, 400) : "Worker error",
          finished_at: new Date().toISOString(),
        })
        .eq("id", campaign.id);
    }
  }

  return NextResponse.json({ ok: true, campaigns: campaigns.length, reports });
}

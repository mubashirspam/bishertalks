export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { cronAuthorised } from "@/lib/cron-auth";
import { syncNumberHealth, syncTemplateStatus } from "@/lib/crm/health";
import { getSettings, setSendingPaused } from "@/lib/crm/contacts";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * The daily check on the number, and on what Meta will let us send.
 *
 * Two jobs because they answer the same question from opposite ends: the
 * number's quality rating says whether we may keep messaging, and the template
 * statuses say what we would be allowed to send if we did. Both feed the send
 * gate, which reads them from the database rather than calling Graph in the
 * middle of a payment.
 *
 * Run it once a day. More often is not useful — Meta moves these in hours, not
 * minutes — and the history table is more readable at one row a day.
 *
 * Schedule with `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(request: NextRequest) {
  if (!cronAuthorised(request, "WhatsAppHealth")) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const health = await syncNumberHealth();
  const templates = await syncTemplateStatus();

  // A RED rating pauses everything, here rather than only at the gate. The
  // gate refuses each message individually; this makes the state visible on
  // the admin screen and in the settings row, so nobody has to work out why
  // sends are failing one at a time.
  const rating = (health.quality_rating ?? "").toUpperCase();
  let paused = false;

  if (rating === "RED") {
    const settings = await getSettings();
    if (!settings.sending_paused) {
      await setSendingPaused(
        true,
        "Number quality dropped to RED — paused automatically",
        "system"
      );
      paused = true;
      console.error("[WhatsAppHealth] quality RED — sending paused automatically");
    }
  }

  // Campaigns stop on yellow too. A rating that has already left green is not
  // the moment to keep sending promotional messages, and the campaign worker
  // would otherwise carry on until its next batch noticed.
  let halted = 0;
  if (rating === "RED" || rating === "YELLOW") {
    const { data } = await supabaseAdmin
      .from("whatsapp_campaigns")
      .update({
        status: "halted",
        halt_reason: `Number quality is ${rating}`,
        finished_at: new Date().toISOString(),
      })
      .in("status", ["sending", "draft"])
      .select("id");
    halted = data?.length ?? 0;
  }

  return NextResponse.json({
    ok: true,
    health,
    templates,
    autoPaused: paused,
    campaignsHalted: halted,
  });
}

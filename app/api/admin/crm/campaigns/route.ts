export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-auth";
import {
  createCampaign,
  dryRun,
  getCampaign,
  setCampaignStatus,
} from "@/lib/crm/campaigns";
import { CAMPAIGN_TEMPLATES } from "@/lib/whatsapp-templates";
import { approvedTemplates } from "@/lib/crm/health";
import { audit } from "@/lib/audit";
import type { Segment } from "@/lib/crm/segments";

/**
 * Campaigns: preview, create, start, pause, stop.
 *
 * Creating one never sends anything — it queues rows and stops. Starting one
 * only flips a status; the cron worker does the sending, in paced batches,
 * with every recipient passing the gate on its own.
 *
 * All of it behind `crm.campaign`, which should sit with one person at first.
 * This is the endpoint that can message a thousand people.
 */

function parseSegment(raw: unknown): Segment {
  const s = (raw ?? {}) as Record<string, unknown>;
  const seg: Segment = {};
  // Person-level first — these are what the People screen builds and what a
  // payment-chasing campaign should almost always use.
  if (typeof s.personStage === "string") {
    seg.personStage = s.personStage as Segment["personStage"];
  }
  if (typeof s.priority === "string") seg.priority = s.priority as Segment["priority"];
  if (s.messaged === "yes" || s.messaged === "no") seg.messaged = s.messaged;
  if (typeof s.orderStage === "string") seg.orderStage = s.orderStage as Segment["orderStage"];
  if (typeof s.deliveryStage === "string") {
    seg.deliveryStage = s.deliveryStage as Segment["deliveryStage"];
  }
  if (typeof s.from === "string") seg.from = s.from;
  if (typeof s.to === "string") seg.to = s.to;
  if (typeof s.district === "string") seg.district = s.district;
  if (s.hasReplied === true) seg.hasReplied = true;
  if (s.marketingOptInOnly === true) seg.marketingOptInOnly = true;
  return seg;
}

export async function POST(request: NextRequest) {
  const auth = await requirePermission("crm.campaign");
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({}));
  const action = body.action;

  // ── Preview ───────────────────────────────────────────────────────────
  // The whole selection and every exclusion, sending nothing. What the
  // composer shows before Create is ever enabled.
  if (action === "dry_run") {
    const templateName = String(body.template_name ?? "");
    const cap = clampCap(body.cap);
    const result = await dryRun(parseSegment(body.segment), templateName, cap);
    return NextResponse.json({ ok: true, ...result });
  }

  // ── Create ────────────────────────────────────────────────────────────
  if (action === "create") {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const templateName = String(body.template_name ?? "");
    const cap = clampCap(body.cap);

    if (!name) {
      return NextResponse.json({ error: "Give the campaign a name." }, { status: 400 });
    }

    const template = CAMPAIGN_TEMPLATES[templateName];
    if (!template) {
      return NextResponse.json({ error: "Pick a template." }, { status: 400 });
    }

    // Refuse here as well as at the gate. A campaign built on an unapproved
    // template would queue hundreds of rows and then refuse every one of
    // them — technically safe, and a waste of everybody's afternoon.
    const approved = await approvedTemplates();
    if (!approved.some((t) => t.name === template.name)) {
      return NextResponse.json(
        {
          error: `${template.name} is not approved by Meta yet, so it cannot be sent. Submit it and wait for approval first.`,
        },
        { status: 409 }
      );
    }

    const result = await createCampaign({
      name,
      templateName,
      segment: parseSegment(body.segment),
      cap,
      createdBy: { id: auth.staff.id, email: auth.staff.email },
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    await audit({
      actor: auth.staff,
      action: "crm.campaign.created",
      entity: "whatsapp_campaign",
      entityId: result.campaign.id,
      meta: { name, template: templateName, cap },
    });

    return NextResponse.json({ ok: true, campaign: result.campaign });
  }

  // ── Start / pause / stop ──────────────────────────────────────────────
  const id = typeof body.campaign_id === "string" ? body.campaign_id : "";
  if (!id) {
    return NextResponse.json({ error: "Missing campaign_id" }, { status: 400 });
  }

  const campaign = await getCampaign(id);
  if (!campaign) {
    return NextResponse.json({ error: "No such campaign" }, { status: 404 });
  }

  switch (action) {
    case "start": {
      if (campaign.status === "halted") {
        // A halted campaign stopped for a reason the system found. Restarting
        // it needs the reason dealt with first, not a second click.
        return NextResponse.json(
          {
            error: `This campaign was halted: ${campaign.halt_reason ?? "unknown reason"}. Create a new one once that's resolved.`,
          },
          { status: 409 }
        );
      }
      await setCampaignStatus(id, "sending");
      await audit({
        actor: auth.staff,
        action: "crm.campaign.started",
        entity: "whatsapp_campaign",
        entityId: id,
        meta: { name: campaign.name },
      });
      return NextResponse.json({ ok: true });
    }

    case "pause":
      await setCampaignStatus(id, "paused");
      await audit({
        actor: auth.staff,
        action: "crm.campaign.paused",
        entity: "whatsapp_campaign",
        entityId: id,
      });
      return NextResponse.json({ ok: true });

    case "stop":
      await setCampaignStatus(id, "halted", `Stopped by ${auth.staff.email}`);
      await audit({
        actor: auth.staff,
        action: "crm.campaign.stopped",
        entity: "whatsapp_campaign",
        entityId: id,
      });
      return NextResponse.json({ ok: true });

    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
}

/** Never unbounded, and never zero. */
function clampCap(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 50;
  return Math.min(Math.floor(n), 5000);
}

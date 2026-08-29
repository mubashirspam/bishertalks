export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-auth";
import { getContact } from "@/lib/crm/contacts";
import { addTag, removeTag } from "@/lib/crm/tags";
import { cancelEvents } from "@/lib/crm/automation";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";

/**
 * Tags and scheduled follow-ups, by hand.
 *
 * `crm.reply` rather than `crm.campaign`: tagging a conversation and calling
 * off one person's reminder is inbox work, done by whoever is answering them.
 * Bulk sending stays behind the stricter permission.
 *
 * Everything here is audited. A cancelled follow-up is a message a customer
 * was going to get and now will not, and six months later somebody will want
 * to know who decided that.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePermission("crm.reply");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const contact = await getContact(id);
  if (!contact) return NextResponse.json({ error: "Unknown contact" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const action = body.action;

  if (action === "add_tag" || action === "remove_tag") {
    const tag = String(body.tag ?? "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_")
      .slice(0, 40);

    if (!/^[a-z0-9_]+$/.test(tag)) {
      return NextResponse.json(
        { error: "A tag is letters, numbers and underscores." },
        { status: 400 }
      );
    }

    if (action === "add_tag") await addTag(contact.id, tag);
    else await removeTag(contact.id, tag);

    await audit({
      actor: auth.staff,
      action: `crm.${action}`,
      entity: "contact",
      entityId: contact.id,
      meta: { tag },
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "cancel_event") {
    const eventId = String(body.id ?? "");
    if (!eventId) return NextResponse.json({ error: "No event" }, { status: 400 });

    // Scoped to this contact, so an id off the wire cannot cancel somebody
    // else's follow-up.
    const { data, error } = await supabaseAdmin
      .from("whatsapp_automation_events")
      .update({
        status: "cancelled",
        error: `Cancelled by ${auth.staff.email}`,
        updated_at: new Date().toISOString(),
      })
      .eq("id", eventId)
      .eq("contact_id", contact.id)
      .eq("status", "pending")
      .select("id, event_type")
      .maybeSingle();

    if (error) {
      console.error("[CRM] cancel event failed:", error.message);
      return NextResponse.json({ error: "Could not cancel it" }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json(
        { error: "That follow-up has already gone or been cancelled." },
        { status: 400 }
      );
    }

    await audit({
      actor: auth.staff,
      action: "crm.cancel_event",
      entity: "contact",
      entityId: contact.id,
      meta: { event_type: (data as { event_type?: string }).event_type },
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "cancel_all") {
    const n = await cancelEvents(contact.id, {
      reason: `Cancelled by ${auth.staff.email}`,
    });
    await audit({
      actor: auth.staff,
      action: "crm.cancel_event",
      entity: "contact",
      entityId: contact.id,
      meta: { cancelled: n },
    });
    return NextResponse.json({ ok: true, cancelled: n });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

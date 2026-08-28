export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-auth";
import { getContact } from "@/lib/crm/contacts";
import { setOptOut, clearOptOut, setMarketingOptIn } from "@/lib/crm/consent";
import { audit } from "@/lib/audit";
import { markRead } from "@/lib/crm/messages";

/**
 * Changing somebody's consent by hand.
 *
 * Behind its own permission, `crm.consent`, rather than `crm.reply`. Answering
 * a customer and deciding they may be messaged again are different-sized
 * decisions, and clearing a stop flag is the only action in this system that
 * can undo something a customer explicitly asked for.
 *
 * Every action here writes an audit row. There is deliberately no bulk
 * endpoint and no import path that reaches this — the only way to un-stop
 * somebody is one person, one contact, one typed reason.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const action = body.action;
  const contactId = typeof body.contact_id === "string" ? body.contact_id : "";

  if (!contactId) {
    return NextResponse.json({ error: "Missing contact_id" }, { status: 400 });
  }

  // Marking a thread read is not a consent decision and must not need the
  // heavier permission, or nobody without it could open the inbox.
  if (action === "mark_read") {
    const auth = await requirePermission("crm.view");
    if (!auth.ok) return auth.response;
    await markRead(contactId);
    return NextResponse.json({ ok: true });
  }

  const auth = await requirePermission("crm.consent");
  if (!auth.ok) return auth.response;

  const contact = await getContact(contactId);
  if (!contact) {
    return NextResponse.json({ error: "No such contact" }, { status: 404 });
  }

  const reason = typeof body.reason === "string" ? body.reason.trim() : "";

  switch (action) {
    case "stop": {
      if (!reason) {
        return NextResponse.json(
          { error: "Say why you're stopping messages to this contact." },
          { status: 400 }
        );
      }
      await setOptOut(contactId, reason, "staff");
      await audit({
        actor: auth.staff,
        action: "crm.opt_out.set",
        entity: "whatsapp_contact",
        entityId: contactId,
        meta: { phone: contact.phone, reason },
      });
      return NextResponse.json({ ok: true });
    }

    case "resume": {
      if (!reason) {
        return NextResponse.json(
          {
            error:
              "Say why this contact may be messaged again. This undoes something they asked for.",
          },
          { status: 400 }
        );
      }
      await clearOptOut(contactId);
      await audit({
        actor: auth.staff,
        action: "crm.opt_out.cleared",
        entity: "whatsapp_contact",
        entityId: contactId,
        meta: {
          phone: contact.phone,
          reason,
          // What is being overridden, preserved on the audit row: once the
          // flag is cleared the original reason is gone from the contact.
          previous_opt_out_at: contact.opt_out_at,
          previous_reason: contact.opt_out_reason,
          previous_source: contact.opt_out_source,
        },
      });
      return NextResponse.json({ ok: true });
    }

    case "marketing_opt_in":
    case "marketing_opt_out": {
      const optedIn = action === "marketing_opt_in";
      await setMarketingOptIn(contactId, optedIn);
      await audit({
        actor: auth.staff,
        action: optedIn ? "crm.marketing.opt_in" : "crm.marketing.opt_out",
        entity: "whatsapp_contact",
        entityId: contactId,
        meta: { phone: contact.phone, reason: reason || null },
      });
      return NextResponse.json({ ok: true });
    }

    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
}

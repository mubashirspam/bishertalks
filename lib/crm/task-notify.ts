import { upsertContact } from "@/lib/crm/contacts";
import { sendTemplateMessage } from "@/lib/crm/send";
import { audit } from "@/lib/audit";
import type { CurrentStaff } from "@/lib/admin-auth";
import { CAMPAIGN_TEMPLATES, TEMPLATE_LANGUAGE } from "@/lib/whatsapp-templates";

/**
 * "We've registered what you told us" — sent only when a task is created with
 * the customer-notify checkbox ticked (off by default), never for every task.
 * Most tasks are internal and have nobody to notify; this is for the ones
 * that are, in effect, a complaint or a request a customer raised.
 *
 * A courtesy on top of a task that already exists — same rule as every other
 * notification in this codebase (see lib/notify.ts, lib/payment-claim.ts):
 * nothing here can turn a successful task creation into a failed one, so
 * every failure is caught and logged, never thrown.
 */
export async function notifyCustomerTaskRegistered(
  task: { id: string; customer_phone: string | null; customer_name: string | null; order_number: string | null },
  staff: CurrentStaff
): Promise<void> {
  if (!task.customer_phone) return;

  try {
    const contact = await upsertContact(task.customer_phone, {
      name: task.customer_name,
      orderNumber: task.order_number,
    });
    if (!contact) return;

    const template = CAMPAIGN_TEMPLATES.request_registered;
    const params = template.params({
      customerName: contact.display_name ?? task.customer_name ?? "സുഹൃത്തേ",
      orderNumber: task.order_number ?? "",
    });

    const result = await sendTemplateMessage({
      contact,
      // Same lane the payment-recovery nudges send through — a single
      // event-triggered message, not a batch, but built on a CAMPAIGN_TEMPLATES
      // entry so it follows the same cap and consent rules as everything else
      // that isn't an order's own lifecycle event.
      kind: "campaign",
      template: { name: template.name, category: template.category, language: TEMPLATE_LANGUAGE },
      params,
      preview: template.body.replace("{{1}}", params[0]),
    });

    if (result.ok) {
      await audit({
        actor: staff,
        action: "task.customer_notified",
        entity: "task",
        entityId: task.id,
        meta: { phone: contact.phone },
      });
    } else {
      console.warn(
        "[Tasks] customer notify not sent:",
        task.id,
        result.refused ? result.reason : result.error
      );
    }
  } catch (e) {
    console.error("[Tasks] customer notify failed:", task.id, e);
  }
}

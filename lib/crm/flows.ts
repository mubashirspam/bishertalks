import type { Contact } from "@/lib/crm/contacts";
import { addTag, setStage, noteMarketingOptIn, tagsFor, onHold } from "@/lib/crm/tags";
import { scheduleEvent, cancelEvents } from "@/lib/crm/automation";
import { sendSessionButtons, sendSessionText } from "@/lib/crm/send";
import { windowState } from "@/lib/crm/contacts";
import { FLOW_ACTIONS, BUTTON_TITLES, type FlowAction } from "@/lib/crm/flow-table";

/**
 * Running one button tap.
 *
 * The table this reads is in lib/crm/flow-table.ts, which imports nothing so
 * that the template checker can validate it outside Next. This half is the
 * part that needs a database and a phone number.
 */

export {
  FLOW_ACTIONS,
  BUTTON_TITLES,
  TEMPLATE_BUTTON_PAYLOADS,
  payloadForTitle,
  validateFlows,
  type FlowAction,
  type FlowReply,
} from "@/lib/crm/flow-table";


/**
 * The link a customer shares.
 *
 * The shop's referral codes live on `orders.referral_code` and belong to the
 * person being *credited*, not the person sharing — so a per-customer share
 * link needs a code minted for them first. Until that exists this is the book
 * page, which is honest: it works, it converts, and it does not promise a
 * commission nothing would pay.
 */
function referralLink(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://bishertalks.com";
  return `${base}/neuro-code`;
}

/** The two replies whose text depends on the customer. */
function bodyFor(payload: string, action: FlowAction): string {
  if (payload === "feedback:recommend") {
    return (
      "വളരെ സന്തോഷം. Recommend ചെയ്യാൻ ആഗ്രഹിക്കുന്ന ആളിന്റെ name & phone number അയക്കൂ, അല്ലെങ്കിൽ ഈ link share ചെയ്യാം:\n" +
      referralLink()
    );
  }
  if (payload === "referral:share_link") {
    return `ഈ link share ചെയ്യാം:\n${referralLink()}`;
  }
  return action.reply.body;
}

export interface FlowOutcome {
  matched: boolean;
  replied: boolean;
  tag?: string;
  stage?: string;
  scheduled?: string;
  cancelled?: number;
  /** Why nothing was sent, when nothing was. */
  note?: string;
}

/**
 * Run one button tap.
 *
 * The CRM effects are applied before the reply is attempted, deliberately: a
 * tag recording what somebody told us is worth more than the acknowledgement,
 * and if Meta is down we would rather know the customer said "not received"
 * than lose it because the reply failed.
 */
export async function runFlowAction(
  payload: string,
  contact: Contact,
  options?: { orderId?: string | null }
): Promise<FlowOutcome> {
  const action = FLOW_ACTIONS[payload];
  if (!action) return { matched: false, replied: false };

  const outcome: FlowOutcome = { matched: true, replied: false };

  // ── CRM effects first ──
  if (action.tag) {
    await addTag(contact.id, action.tag);
    outcome.tag = action.tag;
  }
  if (action.stage) {
    await setStage(contact.id, action.stage);
    outcome.stage = action.stage;
  }
  if (action.optIn) {
    await noteMarketingOptIn(contact.id);
  }
  if (action.cancel?.length) {
    outcome.cancelled = await cancelEvents(contact.id, {
      types: action.cancel,
      reason: `Customer tapped ${BUTTON_TITLES[payload] ?? payload}`,
    });
  }

  if (action.schedule) {
    // Never queue promotion for somebody with an open problem. The hold is
    // checked here as well as in the worker, because the cheapest place to not
    // send a message is before it is ever scheduled.
    const tags = await tagsFor(contact.id);
    if (onHold(tags) && action.schedule.eventType !== "later_reminder") {
      outcome.note = "follow-up not scheduled — support hold";
    } else {
      const queued = await scheduleEvent({
        contactId: contact.id,
        orderId: options?.orderId ?? null,
        eventType: action.schedule.eventType,
        templateName: action.schedule.template,
        afterDays: action.schedule.afterDays,
        reason: `Tapped ${BUTTON_TITLES[payload] ?? payload}`,
      });
      if (queued) outcome.scheduled = action.schedule.eventType;
    }
  }

  // ── Then the reply ──
  const body = bodyFor(payload, action);
  if (!body) return outcome;

  // The tap opened the window a second ago, so this is normally open. A
  // webhook redelivered a day late is the case this guards.
  if (!windowState(contact.last_inbound_at).open) {
    outcome.note = "window closed — no session reply sent";
    return outcome;
  }

  const buttons = (action.reply.buttons ?? [])
    .map((id) => ({ id, title: BUTTON_TITLES[id] ?? id }))
    .filter((b) => b.title);

  const sent = buttons.length
    ? await sendSessionButtons({ contact, body, buttons, payload })
    : await sendSessionText({ contact, body });

  outcome.replied = sent.ok;
  if (!sent.ok) {
    outcome.note = sent.refused ? sent.reason : sent.error;
  }

  return outcome;
}

import { normalise } from "@/lib/crm/consent";
import { sendSessionText } from "@/lib/crm/send";
import { addTag, tagsFor } from "@/lib/crm/tags";
import { customerLinkBase } from "@/lib/whatsapp-templates";
import type { Contact } from "@/lib/crm/contacts";

/**
 * "How do I get the course?"
 *
 * Exists because the automated course_access announcement is HELD (see
 * lib/notify-events.ts) — five templates rejected by Meta as INCORRECT_CATEGORY,
 * so nobody who buys the book is ever told automatically that a free NLP course
 * came with it. This fills that gap without touching the held template at all:
 * it is a plain reply inside the 24-hour window the customer's own message just
 * opened, not a template, so it needs no Meta approval and can be reworded any
 * time. If the appeal on course_access ever succeeds, this stays useful anyway
 * — it answers the question on the customer's own timing, not just at purchase.
 */

const COURSE_KEYWORDS_LATIN = ["course", "courses", "nlp"];
const COURSE_KEYWORDS_MALAYALAM = ["കോഴ്സ്"];

/**
 * Does this message ask about the course?
 *
 * Whole-word matching against normalised text, same as stopWordIn — "of
 * course I paid" must not trigger just because it contains the letters.
 * Biased towards yes for the same reason stopWordIn is biased the other way:
 * an unnecessary extra reply costs nothing, an unanswered real question costs
 * a customer who thinks they were ignored.
 */
export function courseQuestionIn(text: string | null | undefined): boolean {
  if (!text) return false;

  for (const word of COURSE_KEYWORDS_MALAYALAM) {
    if (text.includes(word)) return true;
  }

  const flat = normalise(text);
  if (!flat) return false;

  for (const word of COURSE_KEYWORDS_LATIN) {
    const pattern = new RegExp(`(^|\\s)${word}(\\s|$)`);
    if (pattern.test(flat)) return true;
  }
  return false;
}

/** Set on a contact once the auto-reply has gone out, so it never repeats. */
const SENT_TAG = "course_info_sent";

/**
 * The reply itself — once per contact, ever.
 *
 * "Course" comes up again for reasons this canned reply doesn't answer — a
 * video won't play, a question about the syllabus, a complaint — and resending
 * the same link every time would read as a bot that isn't listening. Once
 * they've been told where it is, later mentions are left for a person, same as
 * every other message this webhook doesn't recognise.
 *
 * A session message, not a template — the wording here can change any time
 * without resubmitting anything to Meta.
 *
 * Returns whether it actually sent, so the caller can log accordingly.
 */
export async function maybeSendCourseInfoReply(contact: Contact): Promise<boolean> {
  const tags = await tagsFor(contact.id);
  if (tags.includes(SENT_TAG)) return false;

  const greeting = contact.display_name ? `ഹായ് ${contact.display_name} ` : "ഹായ് ";
  const body =
    `${greeting}🙏\n\n` +
    `നിങ്ങൾ വാങ്ങിയ Neuro Code ബുക്കിനൊപ്പം ലഭിക്കുന്ന NLP കോഴ്സ് ഇവിടെ തുടങ്ങാം:\n` +
    `${customerLinkBase()}/courses/nlp\n\n` +
    `ലോഗിൻ ചെയ്യാൻ നിങ്ങളുടെ മൊബൈൽ നമ്പർ മാത്രം മതി — പാസ്‌വേഡ് വേണ്ട.`;

  const result = await sendSessionText({ contact, body });
  if (!result.ok) {
    console.warn(
      "[WhatsApp] course info auto-reply not sent:",
      contact.phone,
      result.refused ? result.reason : result.error
    );
    return false;
  }

  // Tagged only on a confirmed send — a refusal (opted out, window closed)
  // must stay retryable the next time they ask, not be spent for nothing.
  await addTag(contact.id, SENT_TAG);
  return true;
}

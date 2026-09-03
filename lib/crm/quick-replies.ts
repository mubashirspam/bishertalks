import { BOOK_BONUS_COURSE_SLUG } from "@/lib/types/db";
import { siteUrl, loginPhone } from "@/lib/wa-message";

/**
 * The four replies an agent sends over and over, ready to drop into the box.
 *
 * These are the messages that were being retyped — or worse, half-remembered —
 * every time somebody asked where their parcel was or how to get into the
 * course. A chip fills the composer with one; it does not send it. That is the
 * whole design: the agent still reads it, still edits it, and still presses
 * send, because a one-tap send is how the wrong customer gets told their book
 * has shipped.
 *
 * Separate from `lib/wa-message.ts`, which builds a message from an order's
 * *stage* for the wa.me links on the Orders and Delivery screens. This module
 * answers a different question: the agent is already in a conversation and has
 * decided what to say. Same links and the same login number, though — both
 * import `siteUrl()` and `loginPhone()` rather than keeping a second copy.
 *
 * Every message exists twice, in Malayalam and in English, and neither is a
 * translation of the other in the strict sense — the Malayalam is what the
 * shop actually says, the English is for the customers who write in English.
 * The picker sends whichever the agent chose.
 */

export const REPLY_LANGUAGES = ["ml", "en"] as const;
export type ReplyLanguage = (typeof REPLY_LANGUAGES)[number];

export const REPLY_IDS = ["course", "tracking", "thanks", "feedback"] as const;
export type QuickReplyId = (typeof REPLY_IDS)[number];

export interface QuickReply {
  id: QuickReplyId;
  /** The chip's own text. English in both languages — the agent reads it. */
  label: string;
  body: string;
}

export interface QuickReplyInput {
  /** The customer's name, for the greeting. Blank is handled. */
  name?: string | null;
  /** Their number, which is also how they log in to the course. */
  phone?: string | null;
  /**
   * The order the tracking chip links to — their most recent one.
   *
   * Null drops the tracking chip entirely rather than offering a link to
   * nowhere. Somebody who has written to this number without ever buying is a
   * real case, and a "Track order" button that produces a 404 page is worse
   * than no button.
   */
  orderNumber?: string | null;
}

function courseUrl(): string {
  return `${siteUrl()}/courses/${BOOK_BONUS_COURSE_SLUG}`;
}

function trackUrl(orderNumber: string): string {
  return `${siteUrl()}/neuro-code/track?id=${orderNumber}`;
}

/** "ഹായ് Asraf 🙏" — or just "ഹായ് 🙏" for a number with no name on it. */
function greeting(name: string | null | undefined, lang: ReplyLanguage): string {
  const clean = name?.trim();
  const hi = lang === "ml" ? "ഹായ്" : "Hi";
  return clean ? `${hi} ${clean} 🙏` : `${hi} 🙏`;
}

const SIGN_OFF = "_Bisher Talks_";

/**
 * The four messages, filled in for this contact.
 *
 * Order matters — it is the order the chips appear in, and it runs from the
 * most-sent to the least: the course link is asked for daily, feedback is
 * asked for once a book has been read.
 */
export function quickReplies(
  input: QuickReplyInput,
  lang: ReplyLanguage
): QuickReply[] {
  const hi = greeting(input.name, lang);
  const login = loginPhone(input.phone);
  const replies: QuickReply[] = [];

  // ── NLP course ────────────────────────────────────────────────────────
  //
  // The login number is the part people get stuck on: access is keyed to the
  // phone number and there is no password, which nobody guesses. So the number
  // is quoted in the message rather than described.
  replies.push({
    id: "course",
    label: "NLP course link",
    body:
      lang === "ml"
        ? `${hi}

നിങ്ങളുടെ *സൗജന്യ NLP കോഴ്‌സ്* ഇവിടെ തുടങ്ങാം:
${courseUrl()}

കോഴ്‌സിൽ കയറാൻ നിങ്ങളുടെ മൊബൈൽ നമ്പർ മാത്രം മതി 👇
*${login}*
(password ഒന്നും വേണ്ട)

⏳ കോഴ്‌സ് access ഒരു വർഷം വരെ ഉപയോഗിക്കാം.

${SIGN_OFF}`
        : `${hi}

Here is your *free NLP course*:
${courseUrl()}

To get in, you only need your mobile number 👇
*${login}*
(no password needed)

⏳ Your access stays open for one year.

${SIGN_OFF}`,
  });

  // ── Order tracking ────────────────────────────────────────────────────
  //
  // Only when there is an order to track. See QuickReplyInput.orderNumber.
  if (input.orderNumber) {
    replies.push({
      id: "tracking",
      label: "Send tracking link",
      body:
        lang === "ml"
          ? `${hi}

നിങ്ങളുടെ ഓർഡർ *${input.orderNumber}* ഇവിടെ ട്രാക്ക് ചെയ്യാം:
${trackUrl(input.orderNumber)}

ഓർഡർ ഏത് ഘട്ടത്തിലാണെന്ന് ഈ പേജിൽ കാണാം.

${SIGN_OFF}`
          : `${hi}

You can track your order *${input.orderNumber}* here:
${trackUrl(input.orderNumber)}

The page shows exactly which stage your order is at.

${SIGN_OFF}`,
    });
  }

  // ── Thanks ────────────────────────────────────────────────────────────
  replies.push({
    id: "thanks",
    label: "Thank you",
    body:
      lang === "ml"
        ? `${hi}

മെസ്സേജ് ചെയ്തതിന് ഒരുപാട് നന്ദി ❤️

എന്തെങ്കിലും സംശയമുണ്ടെങ്കിൽ ഈ നമ്പറിൽ എപ്പോൾ വേണമെങ്കിലും മെസ്സേജ് ചെയ്യാം. ഞങ്ങൾ സഹായിക്കാം.

${SIGN_OFF}`
        : `${hi}

Thank you so much for writing to us ❤️

If you have any questions at all, message this number any time — we are happy to help.

${SIGN_OFF}`,
  });

  // ── Feedback ──────────────────────────────────────────────────────────
  //
  // Asks for a reply in the chat rather than linking a form. This goes to
  // somebody already in a conversation, and the answer to "how is the book"
  // belongs in the thread where the next person to open it can read it.
  replies.push({
    id: "feedback",
    label: "Ask for feedback",
    body:
      lang === "ml"
        ? `${hi}

Neuro Code വായിച്ചു തുടങ്ങിയോ? 📖

പുസ്തകം എങ്ങനെ ഉണ്ടെന്ന് നിങ്ങളുടെ അഭിപ്രായം ഒരു ചെറിയ മെസ്സേജായി അയക്കാമോ? നിങ്ങളുടെ അഭിപ്രായം ഞങ്ങൾക്ക് വളരെ വിലപ്പെട്ടതാണ് 🙏

${SIGN_OFF}`
        : `${hi}

Have you started reading Neuro Code? 📖

Could you send us a short message with what you think of it? Your feedback means a great deal to us 🙏

${SIGN_OFF}`,
  });

  return replies;
}

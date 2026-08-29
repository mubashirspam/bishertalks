import type { OrderEvent } from "@/lib/notify-events";

/**
 * The messages themselves, in Malayalam.
 *
 * Under Make.com the copy lived inside the scenario and this app knew nothing
 * about it. Sending direct means the opposite: Meta will only deliver a
 * business-initiated message if it matches a template it approved in advance,
 * so the exact text has to exist somewhere reviewable — here, next to the code
 * that fills in the blanks, and submitted to Meta from this same definition by
 * scripts/whatsapp-templates.mjs.
 *
 * Malayalam only. Every customer of this shop is messaged in Malayalam by hand
 * already (see lib/wa-message.ts); an automated English message in the middle
 * of that thread reads like it came from someone else.
 *
 * Rules these bodies are written around — each one is a rejection, not a
 * warning, and each one has bitten someone:
 *
 *   * A body may not begin or end with a variable. Every template below ends
 *     with the signature line, which is why it is there.
 *   * Two variables may not sit next to each other with nothing between them.
 *   * A parameter may not be empty. That is why the shipped message carries no
 *     courier or tracking number: we almost never have them at the moment the
 *     parcel is marked shipped, and an empty parameter fails the whole send.
 *     The tracking link covers it — that page shows whatever we do know.
 *   * A parameter may not contain a newline, a tab, or four spaces in a row.
 *     lib/whatsapp.ts sanitises every value before it goes out.
 *
 * Changing any wording below means resubmitting that template to Meta and
 * waiting for approval. The old version keeps sending until the new one is
 * approved, so a typo fix is never an outage.
 */

/** What Meta calls this kind of message. Utility is cheaper than Marketing. */
export type TemplateCategory = "UTILITY" | "MARKETING";

/** Malayalam. Must match the language of the approved template exactly. */
export const TEMPLATE_LANGUAGE = "ml";

/**
 * Everything a template can ask for, pre-formatted.
 *
 * Deliberately flat strings: the template layer must never do arithmetic or
 * date formatting, the same rule the Make payload followed. Whoever builds
 * this context owns the wording of a rupee amount or a date, and there is one
 * place to look when a message reads wrong.
 */
export interface TemplateContext {
  customerName: string;
  orderNumber: string;
  /** Rupees, already rounded, as a string. */
  amount: string;
  /** "കണ്ണൂർ, Kerala" — pre-joined, never concatenated in a template. */
  addressShort: string;
  /** A formatted date, or a phrase like "5–7 ദിവസം". */
  expectedDelivery: string;
  addressUrl: string;
  trackingUrl: string;
  courseTitle: string;
  courseUrl: string;
  /** The ten digits the customer types to get into the course. */
  loginPhone: string;
}

/**
 * The live site, spelled out rather than read from NEXT_PUBLIC_APP_URL.
 *
 * A template's button URL is fixed at the moment Meta approves it, so it
 * cannot come from an environment variable that says localhost in development.
 * Matches `metadataBase` in app/layout.tsx — no `www`.
 */
export const PUBLIC_BASE = "https://bishertalks.com";

/** Loopback in any of the forms a dev server answers on. */
const LOOPBACK = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|\/|$)/i;

/**
 * The base for a link inside a customer's message.
 *
 * The one implementation, because there were two and the second was written
 * by the person who had just fixed the first. `NEXT_PUBLIC_APP_URL` is
 * localhost on every developer machine, a local run sends real messages, and
 * four customers received a link only a developer could open.
 *
 * A configured non-local value wins, so staging links to itself. Only the
 * loopback addresses are overridden — and they are overridden everywhere a
 * customer-facing link is built.
 */
export function customerLinkBase(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!configured || LOOPBACK.test(configured)) return PUBLIC_BASE;
  return configured.replace(/\/+$/, "");
}

/**
 * A button under the message.
 *
 * Two kinds, and the difference matters:
 *
 *   * `URL` opens a link. Meta allows **one** variable per button URL and it
 *     must sit at the very end, which is why `/neuro-code/track?id={{1}}`
 *     works and the address form's `?id=…&t=<hmac>` cannot — its token comes
 *     after the order number, so there is no single tail to vary.
 *   * `QUICK_REPLY` sends text back to us. Nothing reads those yet: the
 *     webhook logs inbound messages and ignores them, and the number a
 *     customer would be replying to is the API number, which no one at the
 *     shop can open. A quick reply today is a customer talking to a wall.
 *
 * Button text is capped at 25 characters by Meta, counted in code points —
 * Malayalam runs long, so `validateTemplate` checks it.
 */
export type TemplateButton =
  | {
      type: "URL";
      text: string;
      /** Static prefix ending in `{{1}}` when the link is per-order. */
      url: string;
      /** What Meta shows the reviewer — the whole URL, filled in. */
      example: string;
      /** The value for `{{1}}`. Omitted when the URL has no variable. */
      param?: (c: TemplateContext) => string;
    }
  | { type: "QUICK_REPLY"; text: string };

export interface TemplateDef {
  /** The name as Meta holds it: lowercase, digits and underscores only. */
  name: string;
  category: TemplateCategory;
  /** Body text with {{1}}, {{2}}, … in the order `params` returns them. */
  body: string;
  /** Sample values, in the same order. Meta requires these to approve. */
  example: string[];
  /** The real values, from an order. */
  params: (c: TemplateContext) => string[];
  /** Buttons under the message. Omitted on every template that has none. */
  buttons?: TemplateButton[];
}

const SIGNATURE = "_Bisher Talks_";

/**
 * The five automated messages, one per event.
 *
 * Every one of them is something the customer asked for by placing an order —
 * no offers, no reminders about other products. That is what keeps them in
 * Meta's Utility category, which costs less and is far less likely to be
 * refused or paused for quality.
 */
export const TEMPLATES: Record<OrderEvent, TemplateDef> = {
  /**
   * `payment_received` used to live here and has been retired.
   *
   * It was the message for a customer who had paid but not yet given a
   * delivery address. That state does not occur: all 3,620 paid orders have
   * an address by the time payment is verified, so it never sent once in its
   * life, and the shop has decided it is not wanted.
   *
   * The template is still APPROVED on the WhatsApp Business Account, left
   * there rather than deleted — Meta locks a deleted template's name for 30
   * days, and an approved template nobody sends costs nothing. `list` will
   * keep showing it, correctly, as something Meta holds that this app does
   * not use.
   *
   * An order that somehow reaches payment with no address now gets no
   * automatic message at all, rather than a confirmation announcing an
   * address we do not have. The Orders screen still offers the hand-sent
   * version for that case — funnelWaMessage's `paid_no_address`.
   */
  /**
   * Paid and we have an address — the order is really on.
   *
   * The minimum possible change from a template Meta already approved:
   * `order_confirmed`'s wording, with the tracking link moved out of the body
   * and onto a button, plus a Need Help quick reply. A new name because a
   * rejected or approved name cannot be recreated — `push` skips anything Meta
   * already holds.
   *
   * What is deliberately NOT here is the course. The version that named it,
   * linked it and put "Open Course" on a button — `neuro_order_confirm_track`
   * — was auto-rejected as INCORRECT_CATEGORY in seconds: to Meta's
   * classifier, course promotion inside a receipt is marketing, whatever the
   * template is submitted as. Re-categorising it would be worse than the
   * rejection, because a MARKETING template needs marketing consent and a
   * receipt that waits for consent never sends.
   *
   * The course now gets its own message — `bonus_course_access` below — which
   * is what it always should have been.
   *
   * Button order is load-bearing: the variable URL button must come first.
   * See validateButtons().
   */
  confirmed: {
    name: "neuro_order_receipt",
    category: "UTILITY",
    body: `ഹായ് {{1}} 🙏
നിങ്ങളുടെ Neuro Code ഓർഡർ സ്ഥിരീകരിച്ചു ✅

ഓർഡർ നമ്പർ: {{2}}
അടച്ച തുക: ₹{{3}}
എത്തിക്കുന്ന സ്ഥലം: {{4}}
പ്രതീക്ഷിക്കുന്ന ഡെലിവറി: {{5}}

ഓർഡർ ട്രാക്ക് ചെയ്യാൻ താഴെയുള്ള button ഉപയോഗിക്കൂ.

${SIGNATURE}`,
    example: ["Asraf", "ORD-K3523P", "699", "കണ്ണൂർ, Kerala", "5–7 ദിവസം"],
    params: (c) => [
      c.customerName,
      c.orderNumber,
      c.amount,
      c.addressShort,
      c.expectedDelivery,
    ],
    // Both URL buttons come before the quick reply, and that ordering is
    // load-bearing rather than tidy. At send time `buttonParams` is a flat
    // list of the *variable* buttons, and Meta is given each one's position in
    // that list as its button index — so the two only agree while the variable
    // buttons occupy the first slots. Put the quick reply between them and the
    // second link is filled at the wrong index and the send is rejected.
    buttons: [
      {
        type: "URL",
        text: "Track Order",
        url: `${PUBLIC_BASE}/neuro-code/track?id={{1}}`,
        example: `${PUBLIC_BASE}/neuro-code/track?id=ORD-K3523P`,
        param: (c) => c.orderNumber,
      },
      {
        type: "URL",
        text: "Order Details",
        // `view=details` exists so the two URLs differ, which Meta requires of
        // two buttons on one template. The track page ignores the parameter
        // today and renders the same thing — status, address, courier and
        // amount are all already on it — so these two buttons currently land
        // in the same place. Worth making the page render a fuller view if
        // that difference is meant to be real.
        url: `${PUBLIC_BASE}/neuro-code/track?view=details&id={{1}}`,
        example: `${PUBLIC_BASE}/neuro-code/track?view=details&id=ORD-K3523P`,
        param: (c) => c.orderNumber,
      },
      { type: "QUICK_REPLY", text: "Need Help" },
    ],
  },

  /**
   * The parcel has gone out.
   *
   * No courier name and no tracking number in the copy, on purpose — see the
   * empty-parameter rule at the top. Of every parcel shipped so far, none had
   * either field filled at the moment it was marked shipped.
   */
  shipped: {
    name: "order_shipped",
    category: "UTILITY",
    body: `ഹായ് {{1}} 📦
നിങ്ങളുടെ ഓർഡർ {{2}} അയച്ചു കഴിഞ്ഞു.

പ്രതീക്ഷിക്കുന്ന ഡെലിവറി: {{3}}
ട്രാക്ക് ചെയ്യാൻ: {{4}}

${SIGNATURE}`,
    example: [
      "Asraf",
      "ORD-K3523P",
      "3–5 ദിവസം",
      "https://bishertalks.com/neuro-code/track?id=ORD-K3523P",
    ],
    params: (c) => [
      c.customerName,
      c.orderNumber,
      c.expectedDelivery,
      c.trackingUrl,
    ],
  },

  /** It arrived. The one place a nudge back to the course belongs. */
  delivered: {
    name: "order_delivered",
    category: "UTILITY",
    body: `ഹായ് {{1}} ✅
നിങ്ങളുടെ ഓർഡർ {{2}} ഡെലിവർ ചെയ്തു.

Neuro Code വായിച്ച് ആസ്വദിക്കൂ ❤️
ഒപ്പം ലഭിച്ച സൗജന്യ കോഴ്‌സ് ഇവിടെ തുടങ്ങാം: {{3}}

${SIGNATURE}`,
    example: [
      "Asraf",
      "ORD-K3523P",
      "https://bishertalks.com/courses/nlp",
    ],
    params: (c) => [c.customerName, c.orderNumber, c.courseUrl],
    /**
     * Order Details rather than a course button, deliberately.
     *
     * A URL button pointing at the course is the exact shape Meta refused five
     * times as INCORRECT_CATEGORY, and this template is already approved — an
     * edit that reads as a course promotion risks the approval it has. The
     * details page carries the course link and the login steps anyway, so the
     * customer still gets there, by a route the classifier has no argument
     * with.
     */
    buttons: [
      {
        type: "URL",
        text: "Order Details",
        url: `${PUBLIC_BASE}/neuro-code/track?view=details&id={{1}}`,
        example: `${PUBLIC_BASE}/neuro-code/track?view=details&id=ORD-K3523P`,
        param: (c) => c.orderNumber,
      },
      { type: "QUICK_REPLY", text: "Need Help" },
    ],
  },

  /**
   * The bonus course is open.
   *
   * Sent on its own key, not the order's: access is also granted by an admin
   * and by CSV import, where there is no order at all. That is also why the
   * order number is absent from the body — notifyCourseAccess sends
   * `order: null`, so templateContext resolves orderNumber to "" and the
   * parameter would render as the "—" fallback.
   *
   * Meta rejected the first wording as INCORRECT_CATEGORY, reading "your
   * course is activated" plus a course link as product promotion rather than
   * an update on something already bought. The body now leads with the
   * purchase it belongs to and calls the link what it is (access, not
   * "start here"), which is what keeps it Utility rather than Marketing.
   * Do not reintroduce a standalone course pitch here.
   *
   * That rewording was never resubmitted, which is why course access has been
   * failing this whole time: `course_access` is still REJECTED at Meta, and
   * `push` skips any name Meta already holds, so the fix sat in this file
   * doing nothing.
   *
   * Resubmitted under this name on 2026-08-29. **Rejected again, in seconds,
   * INCORRECT_CATEGORY.** Two attempts, a careful rewording between them, same
   * verdict — so it is not the wording. Meta's classifier reads "here is a
   * course and a link" as marketing whatever frames it, and the same
   * classifier rejected the receipt that merely mentioned the course.
   *
   * Do not submit a third variation. Guessing at a classifier by resubmitting
   * is how an account collects rejections, and three near-identical templates
   * would look like exactly that. The way out is a human: appeal the rejection
   * in Meta Business Manager, where a post-purchase fulfilment message has a
   * real case that an automated check cannot hear. If the appeal fails, the
   * choice is to accept MARKETING for this one message — with the consent that
   * implies — or to deliver course access off WhatsApp entirely.
   *
   * No buttons on purpose. A URL button to the course is exactly the shape
   * that got the receipt rejected; the link is in the body, where it reads as
   * access to a thing already bought.
   */
  course_access: {
    name: "bonus_course_access",
    category: "UTILITY",
    body: `ഹായ് {{1}} 🙏
നിങ്ങൾ വാങ്ങിയ ബുക്കിനൊപ്പം ലഭിക്കുന്ന കോഴ്‌സിന്റെ ആക്‌സസ് തയ്യാറായി ✅

കോഴ്‌സ്: {{2}}
ആക്‌സസ് ലിങ്ക്: {{3}}

ലോഗിൻ ചെയ്യാൻ നിങ്ങളുടെ മൊബൈൽ നമ്പർ {{4}} മാത്രം മതി — പാസ്‌വേഡ് വേണ്ട.

${SIGNATURE}`,
    example: [
      "Asraf",
      "Neuro Linguistic Programming",
      "https://bishertalks.com/courses/nlp",
      "9847759381",
    ],
    params: (c) => [
      c.customerName,
      c.courseTitle,
      c.courseUrl,
      c.loginPhone,
    ],
  },
};

/**
 * Drafts — written, reviewed, and deliberately not submitted.
 *
 * Separate from TEMPLATES for one reason: `push` walks TEMPLATES, so anything
 * here cannot reach Meta by accident. Nothing sends these either — they are
 * not keyed by OrderEvent and lib/notify.ts has no branch for them.
 *
 * To finalise one: move it into TEMPLATES under a new OrderEvent (which means
 * lib/notify-events.ts, WIRE_EVENT and a notify* function), or push it on its
 * own if it is only ever going to be sent by hand from the admin.
 */
export const DRAFT_TEMPLATES: Record<string, TemplateDef> = {
  /**
   * The course, written as an order confirmation rather than as a course.
   *
   * The fourth attempt at getting course access past Meta, and deliberately a
   * different shape from the three that failed. `course_access`,
   * `bonus_course_access` and `neuro_order_confirm_track` were all rejected
   * INCORRECT_CATEGORY within seconds, and they had one thing in common: they
   * read as "here is a course, go and open it". That is a promotion to a
   * classifier, whatever the wording around it.
   *
   * This one is a receipt. It has an order number, a line item, a price and a
   * validity — the same furniture as the book's confirmation, which Meta
   * approved twice. The course is what was ordered, not what is being offered,
   * and ₹0 says plainly that nothing is being sold here.
   *
   * It was not enough. Submitted 2026-08-29, **rejected in seconds,
   * INCORRECT_CATEGORY** — the fourth time, and the fourth identical verdict.
   *
   * That settles it. Four framings have now been tried: "your course is
   * activated", "access ready, tied to the purchase", the course folded into
   * the book's receipt, and this one — a receipt with an order number, a line
   * item, ₹0 and a validity. Every one auto-rejected without human review, and
   * the only thing they share is a course and a link inside a UTILITY
   * template. Meta's classifier will not read that as utility, and no fifth
   * wording is going to change its mind.
   *
   * **Do not submit a fifth.** Four rejections is already a pattern on this
   * account. What is left is a person (appeal in Business Manager), a
   * different category (MARKETING, which needs consent nobody has), or a
   * different channel — email is configured and works today.
   *
   * Kept here rather than deleted: whoever appeals will want the exact wording
   * that was refused.
   *
   * Validity is text, not a variable — there is no expiry on the order and one
   * fewer variable is one fewer thing for a reviewer to object to. If access
   * ever really does lapse at a year, this needs a real date.
   */
  /**
   * The same message, in the category Meta says it belongs to.
   *
   * Submitted as MARKETING on the theory that INCORRECT_CATEGORY meant "this
   * is marketing, not utility". **Rejected in seconds, INCORRECT_CATEGORY
   * again** — the same code, for the opposite category.
   *
   * So the code does not mean what it appears to. A refusal that is identical
   * whether the template claims UTILITY or MARKETING is not a statement about
   * the category at all: either the classifier cannot place this content, or
   * near-identical text that has already been refused four times is being
   * turned away on sight. Both readings say the same thing — resubmitting
   * variations of this message is finished as a strategy.
   *
   * Five rejected course templates now sit on this account. Do not add a
   * sixth. The remaining routes are an appeal, or another channel entirely.
   *
   * Kept rather than deleted so whoever appeals has the exact wording and the
   * exact history: same body, two categories, one verdict.
   */
  course_order_confirmation_v2: {
    name: "course_order_confirmation_v2",
    category: "MARKETING",
    body: `ഹായ് {{1}} 🙏
നിങ്ങളുടെ കോഴ്‌സ് ഓർഡർ സ്ഥിരീകരിച്ചു ✅

ഓർഡർ നമ്പർ: {{2}}
കോഴ്‌സ്: {{3}}
തുക: ₹0 — Neuro Code ബുക്കിനൊപ്പം സൗജന്യം
വാലിഡിറ്റി: 1 വർഷം

ലോഗിൻ ചെയ്യാൻ നിങ്ങളുടെ മൊബൈൽ നമ്പർ {{4}} മാത്രം മതി — പാസ്‌വേഡ് വേണ്ട.

${SIGNATURE}`,
    example: [
      "Asraf",
      "ORD-K3523P",
      "Neuro Linguistic Programming",
      "9847759381",
    ],
    params: (c) => [c.customerName, c.orderNumber, c.courseTitle, c.loginPhone],
    buttons: [
      {
        type: "URL",
        text: "View Now",
        url: `${PUBLIC_BASE}/courses/nlp`,
        example: `${PUBLIC_BASE}/courses/nlp`,
      },
      { type: "QUICK_REPLY", text: "Need Help" },
    ],
  },

  course_order_confirmation: {
    name: "course_order_confirmation",
    category: "UTILITY",
    body: `ഹായ് {{1}} 🙏
നിങ്ങളുടെ കോഴ്‌സ് ഓർഡർ സ്ഥിരീകരിച്ചു ✅

ഓർഡർ നമ്പർ: {{2}}
കോഴ്‌സ്: {{3}}
തുക: ₹0 — Neuro Code ബുക്കിനൊപ്പം സൗജന്യം
വാലിഡിറ്റി: 1 വർഷം

ലോഗിൻ ചെയ്യാൻ നിങ്ങളുടെ മൊബൈൽ നമ്പർ {{4}} മാത്രം മതി — പാസ്‌വേഡ് വേണ്ട.

${SIGNATURE}`,
    example: [
      "Asraf",
      "ORD-K3523P",
      "Neuro Linguistic Programming",
      "9847759381",
    ],
    params: (c) => [c.customerName, c.orderNumber, c.courseTitle, c.loginPhone],
    buttons: [
      {
        type: "URL",
        text: "View Now",
        url: `${PUBLIC_BASE}/courses/nlp`,
        example: `${PUBLIC_BASE}/courses/nlp`,
      },
      { type: "QUICK_REPLY", text: "Need Help" },
    ],
  },

  /**
   * A delivery held up by something wrong with the address.
   *
   * Sent by a person, not by a status change: only someone reading a courier's
   * exception knows the address is the problem. That is why it is a draft
   * rather than a sixth OrderEvent — there is no automatic trigger for it.
   *
   * The wording is the customer's own, variablised and nothing else. Two
   * things in it are worth a second look before this goes to Meta, both
   * flagged rather than silently fixed:
   *
   *   * "ഡെലിവറിയിൽ" appears twice in the first sentence.
   *   * The third and fifth paragraphs both promise to get back in touch.
   *
   * One button, not the two originally sketched. "View order details" has no
   * destination that "Track my order" does not already reach — /neuro-code/track
   * is the only customer-facing order page there is — and two URL buttons on
   * the same link is a rejection, not a nicety.
   */
  /**
   * The order is on. A button-led rewrite of `order_confirmed`.
   *
   * Same message as the approved `confirmed` template, with one difference:
   * the tracking link comes out of the body and becomes a button. That drops
   * the body from six variables to five and takes a bare URL out of the middle
   * of the Malayalam, which is the line customers most often mistake for spam.
   *
   * Two buttons, as asked. They land on the same page — /neuro-code/track is
   * the only customer-facing order page there is, and it shows the status,
   * the address, the courier and the amount together. The second carries
   * `view=details` purely so the two URLs differ, which Meta requires; the
   * page ignores the parameter today and renders identically.
   */
  confirm_order_1: {
    name: "confirm_order_1",
    category: "UTILITY",
    body: `ഹായ് {{1}} 🙏
നിങ്ങളുടെ ഓർഡർ സ്ഥിരീകരിച്ചു ✅

ഓർഡർ നമ്പർ: {{2}}
അടച്ച തുക: ₹{{3}}
എത്തിക്കുന്ന സ്ഥലം: {{4}}
പ്രതീക്ഷിക്കുന്ന ഡെലിവറി: {{5}}

${SIGNATURE}`,
    example: ["Asraf", "ORD-K3523P", "699", "കണ്ണൂർ, Kerala", "5–7 ദിവസം"],
    params: (c) => [
      c.customerName,
      c.orderNumber,
      c.amount,
      c.addressShort,
      c.expectedDelivery,
    ],
    buttons: [
      {
        type: "URL",
        text: "ഓർഡർ ട്രാക്ക് ചെയ്യുക",
        url: `${PUBLIC_BASE}/neuro-code/track?id={{1}}`,
        example: `${PUBLIC_BASE}/neuro-code/track?id=ORD-K3523P`,
        param: (c) => c.orderNumber,
      },
      {
        type: "URL",
        text: "ഓർഡർ വിവരങ്ങൾ",
        url: `${PUBLIC_BASE}/neuro-code/track?view=details&id={{1}}`,
        example: `${PUBLIC_BASE}/neuro-code/track?view=details&id=ORD-K3523P`,
        param: (c) => c.orderNumber,
      },
    ],
  },

  order_delay_1: {
    name: "order_delay_1",
    category: "UTILITY",
    body: `ഹായ് {{1}},
നിങ്ങളുടെ ഓർഡർ {{2}}-ന്റെ ഡെലിവറിയിൽ വിലാസവുമായി ബന്ധപ്പെട്ട പ്രശ്നം ഉണ്ടായതിനാൽ ഡെലിവറിയിൽ കാലതാമസം നേരിടുകയാണ്.

എത്രയും വേഗം പ്രശ്നം പരിഹരിക്കാൻ ഞങ്ങൾ ശ്രമിച്ചുകൊണ്ടിരിക്കുകയാണ്.

പരിഹാരം ലഭിക്കുന്നതനുസരിച്ച് ഞങ്ങൾ നിങ്ങളെ വീണ്ടും അറിയിക്കുന്നതാണ്.

ഇതിനാൽ ഉണ്ടായ അസൗകര്യത്തിൽ ഞങ്ങൾ ക്ഷമ ചോദിക്കുന്നു.

പുതിയ ഡെലിവറി വിവരങ്ങൾ ലഭിക്കുന്ന മുറയ്ക്ക് നിങ്ങളെ അറിയിക്കുന്നതാണ്.

${SIGNATURE}`,
    example: ["Asraf", "ORD-K3523P"],
    params: (c) => [c.customerName, c.orderNumber],
    buttons: [
      {
        type: "URL",
        text: "ഓർഡർ ട്രാക്ക് ചെയ്യുക",
        url: `${PUBLIC_BASE}/neuro-code/track?id={{1}}`,
        example: `${PUBLIC_BASE}/neuro-code/track?id=ORD-K3523P`,
        param: (c) => c.orderNumber,
      },
    ],
  },
};

/**
 * What a campaign template is given.
 *
 * Deliberately two fields. A campaign message goes to someone chosen by a
 * segment, not by an order event, and the only things reliably true about
 * every member of a segment are who they are and which order put them in it.
 * Anything richer would be a template that works for one segment and renders
 * "—" for the next.
 */
export interface CampaignContext {
  customerName: string;
  orderNumber: string;
}

export interface CampaignTemplateDef {
  name: string;
  category: TemplateCategory;
  body: string;
  example: string[];
  params: (c: CampaignContext) => string[];
  buttons?: TemplateButton[];
}

/**
 * Templates a campaign may use. Not order events — nothing sends these
 * automatically, and nothing sends them at all until Meta approves them.
 *
 * Both are MARKETING, submitted that way on purpose. A nudge to finish a
 * payment is a nudge to buy however carefully it is worded, and Meta has
 * already rejected one of this account's templates for reading as promotion
 * when it was submitted as utility. Arguing the category costs a rejection;
 * accepting it costs a fraction of a rupee.
 *
 * Both carry their own opt-out line in the body, in Malayalam. Meta expects a
 * way out of a marketing message, and retrofitting one later means a second
 * review round on a template that is already live.
 */
export const CAMPAIGN_TEMPLATES: Record<string, CampaignTemplateDef> = {
  /**
   * Started paying and stopped. The largest recoverable segment, and the one
   * with the strongest claim to be worth a message: they chose the book, they
   * opened the payment page, and something interrupted them.
   */
  payment_reminder_1: {
    name: "payment_reminder_1",
    category: "MARKETING",
    // The shop's own wording, in full. The one line added is the last
    // sentence: theirs ends on "if you want to know more about the book",
    // which is a lead-in with nothing to lead to — it has to point at the
    // button or it reads as a message that was cut off.
    body: `ഹായ് {{1}} 🙏
Neuro code വാങ്ങാൻ തടസ്സം നേരിട്ടതിൽ ഖേദം പ്രകടിപ്പിക്കുന്നു

Neuro code വാങ്ങാൻ താല്പര്യം കാണിച്ചതിലുള്ള നന്ദി അറിയിക്കുന്നു.

പുസ്തകവുമായി ബന്ധപ്പെട്ട കൂടുതൽ കാര്യങ്ങൾ അറിയാനുണ്ടെങ്കിൽ താഴെയുള്ള button ഉപയോഗിക്കൂ.

ഇനി ഇത്തരം മെസ്സേജുകൾ വേണ്ടെങ്കിൽ "വേണ്ട" എന്ന് മറുപടി അയക്കുക.

${SIGNATURE}`,
    // One variable now. The order number left with the old wording, which
    // referred to it; a variable a template does not mention cannot stay,
    // because Meta requires them to run 1..n with nothing skipped.
    example: ["Asraf"],
    params: (c) => [c.customerName],
    // Malayalam throughout, matching the body. The other templates keep
    // English button text — that was the original brief — but a fully
    // Malayalam message with English buttons under it reads as two messages.
    //
    // Counted in code points by validateButtons(), which is what Meta counts:
    // the longest of these is 19 of the 25 allowed.
    buttons: [
      {
        type: "URL",
        text: "ഓർഡർ പൂർത്തിയാക്കാൻ",
        url: `${PUBLIC_BASE}/neuro-code`,
        example: `${PUBLIC_BASE}/neuro-code`,
      },
      { type: "QUICK_REPLY", text: "കൂടുതൽ അറിയാൻ" },
      { type: "QUICK_REPLY", text: "സഹായം വേണം" },
    ],
  },

  /**
   * The payment was actually attempted and refused. Different message from the
   * one above: nothing they did was wrong, and saying so is the whole point.
   */
  payment_failed_1: {
    name: "payment_failed_1",
    category: "MARKETING",
    // Same wording as the reminder above, as asked. The two used to differ —
    // "your payment failed, the bank will refund it" against "you did not
    // finish" — and that distinction is now carried only by which segment
    // each campaign targets, not by the copy.
    body: `ഹായ് {{1}} 🙏
Neuro code വാങ്ങാൻ തടസ്സം നേരിട്ടതിൽ ഖേദം പ്രകടിപ്പിക്കുന്നു

Neuro code വാങ്ങാൻ താല്പര്യം കാണിച്ചതിലുള്ള നന്ദി അറിയിക്കുന്നു.

പുസ്തകവുമായി ബന്ധപ്പെട്ട കൂടുതൽ കാര്യങ്ങൾ അറിയാനുണ്ടെങ്കിൽ താഴെയുള്ള button ഉപയോഗിക്കൂ.

ഇനി ഇത്തരം മെസ്സേജുകൾ വേണ്ടെങ്കിൽ "വേണ്ട" എന്ന് മറുപടി അയക്കുക.

${SIGNATURE}`,
    example: ["Asraf"],
    params: (c) => [c.customerName],
    buttons: [
      {
        type: "URL",
        text: "വീണ്ടും ശ്രമിക്കാൻ",
        url: `${PUBLIC_BASE}/neuro-code`,
        example: `${PUBLIC_BASE}/neuro-code`,
      },
      { type: "QUICK_REPLY", text: "കൂടുതൽ അറിയാൻ" },
      { type: "QUICK_REPLY", text: "സഹായം വേണം" },
    ],
  },
};

/**
 * The Neuro Code flow templates.
 *
 * Eight templates that start or continue a conversation, each ending in
 * buttons the customer taps. What happens next lives in `lib/crm/flows.ts`,
 * keyed on the button id — not on the button text, which is repeated across
 * flows ("Need Help" appears in three) and would route three different
 * conversations to the same place.
 *
 * Bodies are **verbatim** from the approved brief and must stay that way: what
 * is in this file has to equal what Meta approved, character for character, or
 * the send is rejected at the wire. That is also why no signature is appended
 * here, unlike CAMPAIGN_TEMPLATES above.
 *
 * Language is `ml`. There is no `ml_IN` in Meta's list, whatever a brief says.
 *
 * Six of the eight are MARKETING, which the gate refuses to anyone without
 * `marketing_opt_in_at`. `lib/crm/tags.ts` sets that when somebody taps a
 * button only an interested person taps — see noteMarketingOptIn().
 */
export const FLOW_TEMPLATES: Record<string, CampaignTemplateDef> = {
  /** First contact. The only template that opens a conversation cold. */
  neuro_interest_intro: {
    name: "neuro_interest_intro",
    category: "MARKETING",
    body: `ഹായ് {{1}}, Neuro Code പുസ്തകത്തിൽ താല്പര്യം കാണിച്ചതിന് നന്ദി.

ഈ പുസ്തകത്തെ കുറിച്ച് കൂടുതൽ അറിയാനോ order ചെയ്യാനോ താഴെയുള്ള option തിരഞ്ഞെടുക്കൂ.

Reply STOP to opt out.`,
    example: ["രാഹുൽ"],
    params: (c) => [c.customerName],
    buttons: [
      { type: "QUICK_REPLY", text: "More Details" },
      { type: "QUICK_REPLY", text: "Buy Now" },
      { type: "QUICK_REPLY", text: "Later" },
    ],
  },

  /** Three days after they tapped Later. Scheduled, never sent by hand. */
  neuro_later_reminder: {
    name: "neuro_later_reminder",
    category: "MARKETING",
    body: `ഹായ് {{1}}, Neuro Code പുസ്തകത്തെ കുറിച്ച് നിങ്ങൾ പിന്നീട് അറിയിക്കാമെന്ന് പറഞ്ഞിരുന്നു.

ഇപ്പോൾ order ചെയ്യണോ, അല്ലെങ്കിൽ കൂടുതൽ details വേണോ?

Reply STOP to opt out.`,
    example: ["രാഹുൽ"],
    params: (c) => [c.customerName],
    buttons: [
      { type: "QUICK_REPLY", text: "Buy Now" },
      { type: "QUICK_REPLY", text: "More Details" },
      { type: "QUICK_REPLY", text: "Not Now" },
    ],
  },

  /**
   * Did it actually arrive?
   *
   * The one template that earns its place twice over: a courier scan says a
   * parcel was delivered, and this is the only thing that asks the person
   * holding it.
   */
  neuro_delivery_confirmed: {
    name: "neuro_delivery_confirmed",
    category: "UTILITY",
    body: `ഹായ് {{1}}, നിങ്ങളുടെ Neuro Code book delivery completed ആയി എന്ന് ഞങ്ങൾ കാണുന്നു.

Book ലഭിച്ചോ എന്ന് confirm ചെയ്യാമോ?`,
    example: ["രാഹുൽ"],
    params: (c) => [c.customerName],
    buttons: [
      { type: "QUICK_REPLY", text: "Received" },
      { type: "QUICK_REPLY", text: "Not Received" },
      { type: "QUICK_REPLY", text: "Need Help" },
    ],
  },

  neuro_reading_followup_10d: {
    name: "neuro_reading_followup_10d",
    category: "MARKETING",
    body: `ഹായ് {{1}}, Neuro Code book ലഭിച്ചിട്ട് ഏകദേശം 10 ദിവസം കഴിഞ്ഞു.

വായന നന്നായി പുരോഗമിക്കുന്നുണ്ടെന്ന് വിശ്വസിക്കുന്നു. Course കേൾക്കാനും activities ചെയ്യാനും സമയം കണ്ടെത്തുമല്ലോ.

Reading status അറിയിക്കൂ.`,
    example: ["രാഹുൽ"],
    params: (c) => [c.customerName],
    buttons: [
      { type: "QUICK_REPLY", text: "Going Good" },
      { type: "QUICK_REPLY", text: "Read Little" },
      { type: "QUICK_REPLY", text: "Not Started" },
    ],
  },

  neuro_reading_encouragement: {
    name: "neuro_reading_encouragement",
    category: "MARKETING",
    body: `ഹായ് {{1}}, Neuro Code വായന എങ്ങനെയാണ് പോകുന്നത്?

ദിവസവും കുറച്ച് സമയം മാത്രം മാറ്റിവെച്ചാലും നല്ല progress ഉണ്ടാകും.`,
    example: ["രാഹുൽ"],
    params: (c) => [c.customerName],
    buttons: [
      { type: "QUICK_REPLY", text: "Started" },
      { type: "QUICK_REPLY", text: "Need Help" },
      { type: "QUICK_REPLY", text: "Later" },
    ],
  },

  /** Thirty days on, in Bisher's own voice. The only one that says who it is from. */
  neuro_feedback_30d: {
    name: "neuro_feedback_30d",
    category: "MARKETING",
    body: `ഹായ് {{1}}, ബിഷർ സർ ആണ്.

Neuro Code വായന എങ്ങനെയുണ്ട്? നിങ്ങൾ നൽകിയ തുകയ്ക്ക് value ഉണ്ടെന്ന് തോന്നിയോ? ജീവിതത്തിൽ എന്തെങ്കിലും positive മാറ്റം അനുഭവപ്പെട്ടോ?

നിങ്ങളുടെ honest feedback അറിയാൻ ആഗ്രഹിക്കുന്നു.`,
    example: ["രാഹുൽ"],
    params: (c) => [c.customerName],
    buttons: [
      { type: "QUICK_REPLY", text: "Give Feedback" },
      { type: "QUICK_REPLY", text: "Recommend" },
      { type: "QUICK_REPLY", text: "Still Reading" },
    ],
  },

  neuro_referral_followup: {
    name: "neuro_referral_followup",
    category: "MARKETING",
    body: `ഹായ് {{1}}, Neuro Code മറ്റൊരാൾക്ക് recommend ചെയ്യാൻ നിങ്ങൾ താല്പര്യം കാണിച്ചിരുന്നു.

Referral details അയക്കാമോ?`,
    example: ["രാഹുൽ"],
    params: (c) => [c.customerName],
    buttons: [
      { type: "QUICK_REPLY", text: "Send Details" },
      { type: "QUICK_REPLY", text: "Share Link" },
      { type: "QUICK_REPLY", text: "Not Now" },
    ],
  },
};

/**
 * The Meta creation payload for one template.
 *
 * What `POST /<WABA_ID>/message_templates` wants. Generated rather than
 * hand-written so the JSON submitted for approval and the text this app sends
 * cannot drift — which is the failure that ends with Meta approving one
 * wording and the app sending another.
 */
export function metaTemplatePayload(def: CampaignTemplateDef): Record<string, unknown> {
  const components: Record<string, unknown>[] = [
    {
      type: "BODY",
      text: def.body,
      // Meta rejects a template with variables and no example, without review.
      ...(variableCount(def.body) > 0
        ? { example: { body_text: [def.example] } }
        : {}),
    },
  ];

  if (def.buttons?.length) {
    components.push({
      type: "BUTTONS",
      // `example` is the whole URL filled in, and belongs only on a button
      // whose URL actually varies — the same rule componentsFor() in
      // scripts/whatsapp-templates.ts follows. An example on a static button
      // is a rejection nobody enjoys diagnosing.
      buttons: def.buttons.map((b) =>
        b.type === "QUICK_REPLY"
          ? { type: "QUICK_REPLY", text: b.text }
          : {
              type: "URL",
              text: b.text,
              url: b.url,
              ...(b.param ? { example: [b.example] } : {}),
            }
      ),
    });
  }

  return {
    name: def.name,
    language: TEMPLATE_LANGUAGE,
    category: def.category,
    components,
  };
}

/** How many {{n}} placeholders a body actually contains. */
export function variableCount(body: string): number {
  return new Set(body.match(/\{\{\d+\}\}/g) ?? []).size;
}

/**
 * Catch the mistakes Meta would catch, before submitting anything.
 *
 * Returns a list of problems, empty when the definition is sound. Used by the
 * submission script and worth running in CI: a template rejected by Meta takes
 * hours to find out about, and the account's quality rating remembers.
 */
export function validateTemplate(def: TemplateDef): string[] {
  const problems: string[] = [];
  const body = def.body.trim();

  if (!/^[a-z0-9_]+$/.test(def.name)) {
    problems.push(`${def.name}: name must be lowercase letters, digits and underscores`);
  }
  if (body.length > 1024) {
    problems.push(`${def.name}: body is ${body.length} characters, Meta's limit is 1024`);
  }
  if (/^\{\{\d+\}\}/.test(body)) {
    problems.push(`${def.name}: body starts with a variable, which Meta rejects`);
  }
  if (/\{\{\d+\}\}$/.test(body)) {
    problems.push(`${def.name}: body ends with a variable, which Meta rejects`);
  }
  if (/\{\{\d+\}\}\s*\{\{\d+\}\}/.test(body)) {
    problems.push(`${def.name}: two variables sit next to each other`);
  }

  const count = variableCount(body);
  if (def.example.length !== count) {
    problems.push(
      `${def.name}: ${count} variables but ${def.example.length} example values`
    );
  }

  // The numbers have to run 1..n with nothing skipped, or Meta reads the
  // parameters in an order nobody intended.
  for (let i = 1; i <= count; i++) {
    if (!body.includes(`{{${i}}}`)) {
      problems.push(`${def.name}: {{${i}}} is missing — variables must run 1 to ${count}`);
    }
  }

  problems.push(...validateButtons(def));

  return problems;
}

/**
 * The button rules, which are their own small pile of rejections.
 *
 * Counted in code points rather than UTF-16 units: `.length` on a Malayalam
 * string is longer than what Meta measures, and a false failure here would
 * send someone rewriting copy that was already fine.
 */
function validateButtons(def: TemplateDef): string[] {
  const problems: string[] = [];
  const buttons = def.buttons ?? [];
  if (!buttons.length) return problems;

  if (buttons.length > 3) {
    problems.push(`${def.name}: ${buttons.length} buttons, Meta allows 3`);
  }

  const urls = new Set<string>();
  const labels = new Set<string>();

  for (const b of buttons) {
    const label = [...b.text];
    if (!label.length) {
      problems.push(`${def.name}: a button has no text`);
    } else if (label.length > 25) {
      problems.push(
        `${def.name}: button "${b.text}" is ${label.length} characters, Meta's limit is 25`
      );
    }
    if (labels.has(b.text)) {
      problems.push(`${def.name}: two buttons both read "${b.text}"`);
    }
    labels.add(b.text);

    if (b.type !== "URL") continue;

    if (urls.has(b.url)) {
      problems.push(`${def.name}: two buttons point at ${b.url}`);
    }
    urls.add(b.url);

    if (!b.url.startsWith("https://")) {
      problems.push(`${def.name}: button "${b.text}" must use https`);
    }

    // One variable, at the very end. Meta appends the parameter to a static
    // prefix; a placeholder anywhere else is not substituted.
    const vars = b.url.match(/\{\{\d+\}\}/g) ?? [];
    if (vars.length > 1) {
      problems.push(
        `${def.name}: button "${b.text}" has ${vars.length} variables, Meta allows 1`
      );
    }
    if (vars.length === 1) {
      if (!b.url.endsWith("{{1}}")) {
        problems.push(
          `${def.name}: button "${b.text}" must end with {{1}} — Meta only varies the tail`
        );
      }
      if (!b.param) {
        problems.push(`${def.name}: button "${b.text}" has {{1}} but no param()`);
      }
    } else if (b.param) {
      problems.push(`${def.name}: button "${b.text}" has a param() but a static URL`);
    }

    if (!b.example) {
      problems.push(`${def.name}: button "${b.text}" needs an example URL`);
    }
  }

  /**
   * A variable URL button must come before any static one.
   *
   * This guards a real trap rather than a Meta rule. At send time each
   * variable button needs a component carrying its index, and `buttonParams`
   * is a flat list of the variable ones — so the index sent is the button's
   * position among *variable* buttons, not its position in the template. With
   * the variable button first those two numbers agree. Put a static button in
   * front of it and they stop agreeing, Meta is told to fill button 0 when the
   * variable is on button 1, and the send is rejected outright.
   *
   * Cheap to obey, and the failure it prevents looks like "the template is
   * broken" rather than "the buttons are in the wrong order".
   */
  const urlButtons = buttons.filter((b) => b.type === "URL");
  const firstStatic = urlButtons.findIndex((b) => b.type === "URL" && !b.param);
  const lastVariable = urlButtons
    .map((b) => b.type === "URL" && !!b.param)
    .lastIndexOf(true);
  if (firstStatic !== -1 && lastVariable > firstStatic) {
    problems.push(
      `${def.name}: a URL button with a variable must come before any static ` +
        `URL button — otherwise the wrong button index is sent`
    );
  }

  return problems;
}

/**
 * Every problem across every template — what the script prints and refuses on.
 *
 * Drafts are checked too. They are not submitted, but a draft carrying a
 * mistake is worth knowing about while it is still cheap to fix, rather than
 * on the day someone promotes it into TEMPLATES and pushes.
 */
export function validateAllTemplates(): string[] {
  return [
    ...Object.values(TEMPLATES),
    ...Object.values(DRAFT_TEMPLATES),
    // Campaign templates share the shape, so they share the rules. A campaign
    // body that starts with a variable is rejected exactly as an order one is.
    ...Object.values(CAMPAIGN_TEMPLATES).map(
      (c): TemplateDef => ({ ...c, params: () => c.example })
    ),
    // Same shape, same rules. Their button text is checked against the 25
    // character template limit here; the 20-character limit on an interactive
    // reply button is a different rule and lives in lib/crm/flows.ts.
    ...Object.values(FLOW_TEMPLATES).map(
      (c): TemplateDef => ({ ...c, params: () => c.example })
    ),
  ].flatMap(validateTemplate);
}

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
const PUBLIC_BASE = "https://bishertalks.com";

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
   * Paid, but we still don't know where to send the book.
   *
   * The most valuable message in the system: on the standard checkout the
   * address form comes after payment, so anyone whose connection dropped at
   * that moment is a paid customer we cannot ship to. This is how they get
   * back to the form.
   */
  payment_received: {
    name: "payment_received",
    category: "UTILITY",
    body: `ഹായ് {{1}} 🙏
നിങ്ങളുടെ പേയ്‌മെന്റ് ലഭിച്ചു ✅

ഓർഡർ നമ്പർ: {{2}}
അടച്ച തുക: ₹{{3}}

ഇനി ഒരു കാര്യം മാത്രം — ബുക്ക് എവിടേക്ക് അയക്കണമെന്ന് ഈ ലിങ്കിൽ നൽകൂ:
{{4}}

വിലാസം ലഭിച്ചാൽ ഉടൻ ബുക്ക് അയക്കുന്നതാണ്.

${SIGNATURE}`,
    example: ["Asraf", "ORD-K3523P", "699", "https://bishertalks.com/a/abc123"],
    params: (c) => [c.customerName, c.orderNumber, c.amount, c.addressUrl],
  },

  /** Paid and we have an address — the order is really on. */
  confirmed: {
    name: "order_confirmed",
    category: "UTILITY",
    body: `ഹായ് {{1}} 🙏
നിങ്ങളുടെ ഓർഡർ സ്ഥിരീകരിച്ചു ✅

ഓർഡർ നമ്പർ: {{2}}
അടച്ച തുക: ₹{{3}}
എത്തിക്കുന്ന സ്ഥലം: {{4}}
പ്രതീക്ഷിക്കുന്ന ഡെലിവറി: {{5}}

ഓർഡർ ട്രാക്ക് ചെയ്യാൻ: {{6}}

${SIGNATURE}`,
    example: [
      "Asraf",
      "ORD-K3523P",
      "699",
      "കണ്ണൂർ, Kerala",
      "5–7 ദിവസം",
      "https://bishertalks.com/neuro-code/track?id=ORD-K3523P",
    ],
    params: (c) => [
      c.customerName,
      c.orderNumber,
      c.amount,
      c.addressShort,
      c.expectedDelivery,
      c.trackingUrl,
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
   */
  course_access: {
    name: "course_access",
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

  /**
   * The replacement for `payment_received`, whose address ask is wrong.
   *
   * A new name rather than an edit to the approved one, so TEMPLATES keeps
   * describing what Meta actually holds. Nothing is lost by waiting: the
   * event is in HELD_EVENTS and sends nothing at all today.
   *
   * Modelled on funnelWaMessage's `paid_no_address` case in lib/wa-message.ts
   * — the message the team already hand-sends in exactly this situation, and
   * therefore the best available evidence of what the ask should say. Three
   * things it has that the approved template does not:
   *
   *   * The product is named. "Your payment was received" with an order
   *     number reads like a bank alert; "thank you for ordering Neuro Code"
   *     reads like the shop.
   *   * The ask is bounded — the address is the ONLY thing still needed —
   *     which is what stops someone assuming a form full of questions is
   *     waiting behind the link.
   *   * The free course and the login number come too. Half these buyers gave
   *     no email address, so this is their only route to the thing they can
   *     use immediately, while the book is still being printed.
   *
   * Deliberately carries NO delivery estimate. The approved template promises
   * the book goes out "immediately" once the address arrives, and the hand-
   * sent one says 5–7 days — both were written before the third edition ran
   * out. paidThankYouMessage already tells buyers the fourth edition ships
   * from a named date. Rather than add a third answer, this one makes no
   * promise; see the note in PENDING before adding one back.
   */
  payment_received_2: {
    name: "payment_received_2",
    category: "UTILITY",
    body: `ഹായ് {{1}} 🙏
Neuro Code ഓർഡർ ചെയ്തതിന് ഒരുപാട് നന്ദി ❤️
നിങ്ങളുടെ പേയ്‌മെന്റ് ലഭിച്ചു ✅

ഓർഡർ നമ്പർ: {{2}}
അടച്ച തുക: ₹{{3}}

📮 ബുക്ക് അയക്കാൻ ഇനി നിങ്ങളുടെ ഡെലിവറി വിലാസം മാത്രം മതി. ദയവായി ഇവിടെ നൽകൂ:
{{4}}

🎁 ഒപ്പം ലഭിക്കുന്ന സൗജന്യ NLP കോഴ്‌സ് ഇപ്പോൾ തന്നെ തുടങ്ങാം:
{{5}}
ലോഗിൻ ചെയ്യാൻ നിങ്ങളുടെ മൊബൈൽ നമ്പർ {{6}} മാത്രം മതി — പാസ്‌വേഡ് വേണ്ട.

${SIGNATURE}`,
    example: [
      "Asraf",
      "ORD-K3523P",
      "699",
      "https://bishertalks.com/neuro-code/address?id=ORD-K3523P&t=abc123",
      "https://bishertalks.com/courses/nlp",
      "9847759381",
    ],
    params: (c) => [
      c.customerName,
      c.orderNumber,
      c.amount,
      c.addressUrl,
      c.courseUrl,
      c.loginPhone,
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
    body: `ഹായ് {{1}} 🙏
നിങ്ങളുടെ Neuro Code ഓർഡർ {{2}} പൂർത്തിയായിട്ടില്ല എന്ന് കാണുന്നു.

പേയ്‌മെന്റ് പൂർത്തിയാക്കാൻ സഹായം വേണമെങ്കിൽ ഈ മെസ്സേജിന് മറുപടി അയച്ചാൽ മതി.

ഇനി ഇത്തരം മെസ്സേജുകൾ വേണ്ടെങ്കിൽ "വേണ്ട" എന്ന് മറുപടി അയക്കുക.

${SIGNATURE}`,
    example: ["Asraf", "ORD-K3523P"],
    params: (c) => [c.customerName, c.orderNumber],
  },

  /**
   * The payment was actually attempted and refused. Different message from the
   * one above: nothing they did was wrong, and saying so is the whole point.
   */
  payment_failed_1: {
    name: "payment_failed_1",
    category: "MARKETING",
    body: `ഹായ് {{1}} 🙏
നിങ്ങളുടെ ഓർഡർ {{2}}-ന്റെ പേയ്‌മെന്റ് പരാജയപ്പെട്ടതായി കണ്ടു. പണം കുറഞ്ഞിട്ടുണ്ടെങ്കിൽ അത് ബാങ്ക് തിരികെ നൽകുന്നതാണ്.

വീണ്ടും ശ്രമിക്കാൻ സഹായം വേണമെങ്കിൽ ഈ മെസ്സേജിന് മറുപടി അയക്കൂ.

ഇനി ഇത്തരം മെസ്സേജുകൾ വേണ്ടെങ്കിൽ "വേണ്ട" എന്ന് മറുപടി അയക്കുക.

${SIGNATURE}`,
    example: ["Asraf", "ORD-K3523P"],
    params: (c) => [c.customerName, c.orderNumber],
  },
};

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
  ].flatMap(validateTemplate);
}

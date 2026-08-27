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

  return problems;
}

/** Every problem across every template — what the script prints and refuses on. */
export function validateAllTemplates(): string[] {
  return Object.values(TEMPLATES).flatMap(validateTemplate);
}

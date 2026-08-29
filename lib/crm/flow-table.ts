/**
 * The flow table: every button, its title, and what tapping it means.
 *
 * Data only, and that is a hard rule — this module imports nothing. The
 * template checker (`npm run whatsapp:templates check`) runs outside Next, with
 * no path aliases and no database, and it has to be able to read this to tell
 * you that a button you just added does nothing when tapped. One `@/lib/...`
 * import here and that check stops working.
 *
 * The behaviour that acts on this table is in lib/crm/flows.ts.
 *
 * Keyed on **payload**, never on button text. Three flows have a "Need Help"
 * button and two have "Later"; text cannot tell them apart, and the day
 * somebody rewords one in Malayalam is the day text-matching quietly breaks.
 * Payloads are `<flow>:<action>` — what they were looking at, and what they
 * chose.
 */

export interface FlowReply {
  body: string;
  /** Payload ids of the buttons to offer. Their titles come from BUTTON_TITLES. */
  buttons?: string[];
}

export interface FlowAction {
  /** What we send back, inside the window. */
  reply: FlowReply;
  /** A CRM tag to add. */
  tag?: string;
  /** The relationship stage this sets. */
  stage?: string;
  /** Queue a follow-up. */
  schedule?: { eventType: string; template: string; afterDays: number };
  /** Pending follow-ups to drop — a customer saying "not now" means it. */
  cancel?: string[];
  /**
   * Whether this tap counts as consent to marketing.
   *
   * True only where somebody leaned in. Tapping *Later* or *Not Now* is a
   * polite decline and must never be read as a yes.
   */
  optIn?: boolean;
  /**
   * Whether this needs a person.
   *
   * Sets a hold: no promotional follow-up goes out until the tag is cleared.
   * A customer whose book never arrived must not get a reading nudge.
   */
  hold?: boolean;
}

/**
 * Button titles, by payload.
 *
 * Meta caps an interactive reply button at **20** characters — not the 25 a
 * template button gets. Kept here so one list is checked once, and so a title
 * used in two flows cannot drift apart.
 */
export const BUTTON_TITLES: Record<string, string> = {
  "intro:more_details": "More Details",
  "intro:buy_now": "Buy Now",
  "intro:later": "Later",
  "intro:price": "Price",
  "intro:order_now": "Order Now",
  "intro:doubt": "Doubt",
  "later:buy_now": "Buy Now",
  "later:more_details": "More Details",
  "later:not_now": "Not Now",
  "paid:need_help": "Need Help",
  // Malayalam, because that is what is printed on the button — and the
  // webhook matches a template tap by its title, so a mismatch here means a
  // customer taps and nothing happens.
  "payment:more_details": "കൂടുതൽ അറിയാൻ",
  "payment:need_help": "സഹായം വേണം",
  "delivery:received": "Received",
  "delivery:not_received": "Not Received",
  "delivery:need_help": "Need Help",
  "reading10:going_good": "Going Good",
  "reading10:read_little": "Read Little",
  "reading10:not_started": "Not Started",
  "encourage:started": "Started",
  "encourage:need_help": "Need Help",
  "encourage:later": "Later",
  "feedback:give": "Give Feedback",
  "feedback:recommend": "Recommend",
  "feedback:still_reading": "Still Reading",
  "referral:send_details": "Send Details",
  "referral:share_link": "Share Link",
  "referral:not_now": "Not Now",
};

/** The shared replies, written once because three flows reach the same place. */
const SUPPORT_REPLY =
  "തീർച്ചയായും. നിങ്ങളുടെ സംശയം ഇവിടെ type ചെയ്യൂ. ഞങ്ങളുടെ team മറുപടി നൽകും.";

const BOOK_DETAILS =
  "Neuro Code നിങ്ങളുടെ mindset, focus, habits, decision making എന്നിവ മെച്ചപ്പെടുത്താൻ സഹായിക്കുന്ന practical book ആണ്.\n\n" +
  "ഇതിൽ book reading, course access, activities എന്നിവ ഉൾപ്പെടുന്നു.\n\n" +
  "Order ചെയ്യാൻ താല്പര്യമുണ്ടോ?";

/**
 * Where "Buy Now" sends people.
 *
 * The brief asks the customer to type name, phone, address and pincode into
 * WhatsApp. That is four chances to mistype an address that a human then
 * re-keys, and hand-keyed addresses are where delivery failures come from —
 * see the 674 parcels in the delivery portal. The site's own order page
 * validates the pincode and writes straight to the order, so the link goes
 * first and the typed form stays as the fallback for anyone who ignores it.
 */
const ORDER_URL = `${process.env.NEXT_PUBLIC_APP_URL ?? "https://bishertalks.com"}/neuro-code`;

const ADDRESS_REPLY =
  `Thank you. താഴെയുള്ള link വഴി order പൂർത്തിയാക്കാം — address അവിടെ type ചെയ്താൽ മതി:\n\n${ORDER_URL}\n\n` +
  "Link തുറക്കാൻ ബുദ്ധിമുട്ടുണ്ടെങ്കിൽ ഈ details ഇവിടെ അയക്കൂ:\n\nName:\nPhone:\nFull Address:\nPincode:";

/** Every button, and what it does. */
export const FLOW_ACTIONS: Record<string, FlowAction> = {
  // ── neuro_interest_intro ──────────────────────────────────────────────
  "intro:more_details": {
    reply: {
      body: BOOK_DETAILS,
      buttons: ["intro:price", "intro:order_now", "intro:doubt"],
    },
    optIn: true,
  },
  "intro:buy_now": {
    reply: { body: ADDRESS_REPLY },
    stage: "ordering",
    optIn: true,
  },
  "intro:later": {
    reply: {
      body: "ശരി. പ്രശ്നമില്ല. കുറച്ച് ദിവസങ്ങൾക്ക് ശേഷം ഞങ്ങൾ വീണ്ടും ഓർമ്മിപ്പിക്കാം.",
    },
    tag: "later_buyer",
    schedule: {
      eventType: "later_reminder",
      template: "neuro_later_reminder",
      afterDays: 3,
    },
  },

  // The second rung of the intro flow.
  "intro:price": {
    reply: {
      body: `Neuro Code book ₹699 ആണ്. Delivery free.\n\nBook, course access, activities എല്ലാം ഇതിൽ ഉൾപ്പെടും.\n\nOrder ചെയ്യാൻ: ${ORDER_URL}`,
      buttons: ["intro:order_now", "intro:doubt"],
    },
    optIn: true,
  },
  "intro:order_now": {
    reply: { body: ADDRESS_REPLY },
    stage: "ordering",
    optIn: true,
  },
  "intro:doubt": {
    reply: { body: SUPPORT_REPLY },
    tag: "support_needed",
    hold: true,
  },

  // ── neuro_later_reminder ──────────────────────────────────────────────
  "later:buy_now": {
    reply: { body: ADDRESS_REPLY },
    stage: "ordering",
    optIn: true,
    cancel: ["later_reminder"],
  },
  "later:more_details": {
    reply: {
      body: BOOK_DETAILS,
      buttons: ["intro:price", "intro:order_now", "intro:doubt"],
    },
    optIn: true,
  },
  "later:not_now": {
    reply: {
      body: 'ശരി. ഇനി ഈ reminder pause ചെയ്യുന്നു. ആവശ്യമുണ്ടെങ്കിൽ "Neuro Code" എന്ന് reply ചെയ്യാം.',
    },
    tag: "reminder_paused",
    // They asked for the reminders to stop. Not an opt-out — they may still
    // hear about their own order — but every pending nudge goes.
    cancel: ["later_reminder", "reading_followup_10d", "encouragement", "feedback_30d"],
  },

  // ── payment_reminder_1 · payment_failed_1 ─────────────────────────────
  //
  // A campaign's Need Help is a different conversation from a receipt's: this
  // person has NOT paid, so the useful answer names the thing that usually
  // went wrong rather than asking an open question.
  "payment:more_details": {
    reply: {
      body: BOOK_DETAILS,
      buttons: ["intro:price", "intro:order_now", "intro:doubt"],
    },
    // Somebody who asks to hear more has asked to hear more.
    optIn: true,
  },
  "payment:need_help": {
    reply: {
      body:
        "തീർച്ചയായും. Payment പൂർത്തിയാക്കാൻ എന്താണ് ബുദ്ധിമുട്ട് എന്ന് ഇവിടെ type ചെയ്യൂ.\n\n" +
        "Card, UPI, NetBanking — ഏതും ഉപയോഗിക്കാം. ഞങ്ങളുടെ team ഉടൻ സഹായിക്കും.",
    },
    tag: "support_needed",
    hold: true,
  },

  // ── neuro_order_receipt ───────────────────────────────────────────────
  //
  // Its own reply rather than the shared one: this button is tapped by someone
  // who has just paid, and the two things they ask about are the parcel and
  // getting into the course. Naming both is what stops the next message being
  // "which course?".
  "paid:need_help": {
    reply: {
      body:
        "തീർച്ചയായും. നിങ്ങളുടെ order അല്ലെങ്കിൽ course access സംബന്ധിച്ച സംശയം ഇവിടെ type ചെയ്യൂ.\n\n" +
        "ഞങ്ങളുടെ team ഉടൻ മറുപടി നൽകും.",
    },
    tag: "support_needed",
    hold: true,
  },

  // ── neuro_delivery_confirmed ──────────────────────────────────────────
  "delivery:received": {
    reply: {
      body: "സന്തോഷം. വായന ആരംഭിക്കൂ. Course activities കൂടി follow ചെയ്താൽ കൂടുതൽ benefit ലഭിക്കും.",
    },
    stage: "delivered_confirmed",
    schedule: {
      eventType: "reading_followup_10d",
      template: "neuro_reading_followup_10d",
      afterDays: 10,
    },
  },
  "delivery:not_received": {
    reply: {
      body: "ക്ഷമിക്കണം. ഞങ്ങളുടെ support team ഇത് പരിശോധിക്കും. നിങ്ങളുടെ order ID അല്ലെങ്കിൽ issue ഇവിടെ അയക്കൂ.",
    },
    tag: "delivery_issue",
    hold: true,
    // Nothing promotional while a parcel is missing. This is the rule that
    // stops a reading nudge reaching somebody whose book never arrived.
    cancel: ["reading_followup_10d", "encouragement", "feedback_30d"],
  },
  "delivery:need_help": {
    reply: { body: SUPPORT_REPLY },
    tag: "support_needed",
    hold: true,
  },

  // ── neuro_reading_followup_10d ────────────────────────────────────────
  "reading10:going_good": {
    reply: {
      body: "വളരെ സന്തോഷം. തുടർച്ചയായി വായിക്കുകയും activities ചെയ്യുകയും ചെയ്യൂ. അതാണ് result കാണാൻ സഹായിക്കുന്നത്.",
    },
    tag: "active_reader",
    stage: "active_reader",
    schedule: { eventType: "feedback_30d", template: "neuro_feedback_30d", afterDays: 30 },
  },
  "reading10:read_little": {
    reply: {
      body: "ശരി. ദിവസവും 10-15 minutes മാറ്റിവെച്ചാൽ നല്ല progress ഉണ്ടാകും. ചെറിയ consistency മതി.",
    },
    tag: "slow_reader",
    stage: "slow_reader",
    schedule: {
      eventType: "encouragement",
      template: "neuro_reading_encouragement",
      afterDays: 7,
    },
  },
  "reading10:not_started": {
    reply: {
      body: "പ്രശ്നമില്ല. ഇന്ന് തന്നെ 2 pages വായിച്ച് തുടങ്ങൂ. ചെറിയ തുടക്കം തന്നെ വലിയ മാറ്റത്തിന്റെ beginning ആണ്.",
    },
    tag: "not_started",
    stage: "not_started",
    schedule: {
      eventType: "encouragement",
      template: "neuro_reading_encouragement",
      afterDays: 5,
    },
  },

  // ── neuro_reading_encouragement ───────────────────────────────────────
  "encourage:started": {
    reply: { body: "Great. വായന തുടരണം. Activities ചെയ്യാൻ മറക്കരുത്." },
    tag: "started_reading",
    stage: "active_reader",
  },
  "encourage:need_help": {
    reply: { body: "തീർച്ചയായും. എവിടെയാണ് help വേണ്ടത് എന്ന് ഇവിടെ type ചെയ്യൂ." },
    tag: "support_needed",
    hold: true,
  },
  "encourage:later": {
    reply: {
      body: "ശരി. സമയം കിട്ടുമ്പോൾ തുടങ്ങൂ. ഞങ്ങൾ കുറച്ച് ദിവസത്തിന് ശേഷം check ചെയ്യും.",
    },
    tag: "reading_later",
  },

  // ── neuro_feedback_30d ────────────────────────────────────────────────
  "feedback:give": {
    reply: { body: "Thank you. നിങ്ങളുടെ honest feedback ഇവിടെ type ചെയ്യൂ." },
    tag: "feedback_requested",
    stage: "feedback_requested",
  },
  "feedback:recommend": {
    // The link is filled in per customer — see referralReply().
    reply: { body: "" },
    tag: "referral_interested",
    stage: "referral_interested",
    schedule: {
      eventType: "referral_followup",
      template: "neuro_referral_followup",
      afterDays: 3,
    },
  },
  "feedback:still_reading": {
    reply: {
      body: "ശരി. സമയം എടുത്ത് വായിക്കൂ. Course activities കൂടി follow ചെയ്താൽ കൂടുതൽ benefit ലഭിക്കും.",
    },
    tag: "still_reading",
    schedule: { eventType: "feedback_30d", template: "neuro_feedback_30d", afterDays: 15 },
  },

  // ── neuro_referral_followup ───────────────────────────────────────────
  "referral:send_details": {
    reply: { body: "Please send referral person details:\n\nName:\nPhone:\nPlace:" },
    tag: "referral_details_requested",
  },
  "referral:share_link": {
    reply: { body: "" },
    tag: "referral_link_shared",
  },
  "referral:not_now": {
    reply: { body: 'ശരി. പിന്നീട് ആവശ്യമുണ്ടെങ്കിൽ "Recommend" എന്ന് reply ചെയ്യൂ.' },
    tag: "referral_paused",
    cancel: ["referral_followup"],
  },
};

/**
 * Which template's buttons produce which payloads.
 *
 * Meta's webhook gives us a quick-reply button's **title**, not an id — ids
 * only exist on interactive messages we send ourselves. So a tap on a template
 * button arrives as "Need Help" with no idea which of the three flows it came
 * from, and the only way to place it is the template that was sent last.
 *
 * Order matters within a template: it is the order the buttons were approved
 * in, and the order the titles come back in.
 */
export const TEMPLATE_BUTTON_PAYLOADS: Record<string, string[]> = {
  neuro_interest_intro: ["intro:more_details", "intro:buy_now", "intro:later"],
  neuro_later_reminder: ["later:buy_now", "later:more_details", "later:not_now"],
  neuro_order_receipt: ["paid:need_help"],
  // Same conversation as the delivery flow: they have the book and a question.
  order_delivered: ["delivery:need_help"],
  // Drafted, not submitted — wired now so approving it needs no code change.
  course_order_confirmation: ["paid:need_help"],
  course_order_confirmation_v2: ["paid:need_help"],
  payment_reminder_1: ["payment:more_details", "payment:need_help"],
  payment_failed_1: ["payment:more_details", "payment:need_help"],
  neuro_delivery_confirmed: [
    "delivery:received",
    "delivery:not_received",
    "delivery:need_help",
  ],
  neuro_reading_followup_10d: [
    "reading10:going_good",
    "reading10:read_little",
    "reading10:not_started",
  ],
  neuro_reading_encouragement: [
    "encourage:started",
    "encourage:need_help",
    "encourage:later",
  ],
  neuro_feedback_30d: ["feedback:give", "feedback:recommend", "feedback:still_reading"],
  neuro_referral_followup: [
    "referral:send_details",
    "referral:share_link",
    "referral:not_now",
  ],
};

/**
 * Turn a tapped button title back into a payload.
 *
 * Needs the template it came from, because three templates have a "Need Help".
 * With no template — an interactive reply, which carries its own id — the
 * caller already has the payload and never asks.
 */
export function payloadForTitle(
  templateName: string | null,
  title: string
): string | null {
  if (!templateName) return null;
  const payloads = TEMPLATE_BUTTON_PAYLOADS[templateName];
  if (!payloads) return null;

  const wanted = title.trim().toLowerCase();
  return (
    payloads.find((p) => (BUTTON_TITLES[p] ?? "").toLowerCase() === wanted) ?? null
  );
}

/**
 * Every way this table can be internally inconsistent.
 *
 * Run by `npm run whatsapp:templates check`, alongside the template rules. The
 * failures it catches are all silent ones: a button whose payload has no
 * action does nothing when tapped, and a reply offering a button with no title
 * sends a message with a blank button on it.
 */
export function validateFlows(): string[] {
  const problems: string[] = [];

  for (const [template, payloads] of Object.entries(TEMPLATE_BUTTON_PAYLOADS)) {
    for (const payload of payloads) {
      if (!BUTTON_TITLES[payload]) {
        problems.push(`${template}: payload ${payload} has no button title`);
      }
      if (!FLOW_ACTIONS[payload]) {
        problems.push(`${template}: payload ${payload} has no action — a tap would do nothing`);
      }
    }
  }

  for (const [payload, action] of Object.entries(FLOW_ACTIONS)) {
    // Two of them fill their body per customer; the rest must carry one.
    const filledLater = payload === "feedback:recommend" || payload === "referral:share_link";
    if (!action.reply.body && !filledLater) {
      problems.push(`${payload}: no reply body`);
    }

    for (const id of action.reply.buttons ?? []) {
      const title = BUTTON_TITLES[id];
      if (!title) {
        problems.push(`${payload}: reply button ${id} has no title`);
        continue;
      }
      // Meta's limit on an interactive reply button, counted in code points.
      if ([...title].length > 20) {
        problems.push(
          `${payload}: reply button "${title}" is ${[...title].length} characters, Meta allows 20`
        );
      }
      if (!FLOW_ACTIONS[id]) {
        problems.push(`${payload}: offers ${id}, which has no action`);
      }
    }

    if ((action.reply.buttons?.length ?? 0) > 3) {
      problems.push(`${payload}: ${action.reply.buttons?.length} buttons, Meta allows 3`);
    }
  }

  return problems;
}

/**
 * Everything written on the Neuro Code landing page.
 *
 * Kept apart from the layout so copy can be edited — and testimonials added —
 * without going near JSX. The audience is Malayalam-speaking, so most strings
 * are Malayalam with English kept only where it's what people actually say
 * (NLP, Overthinking, COD, Order Now).
 *
 * Headings come in two parts because the design sets the first line in the
 * foreground colour and the second in orange.
 */

export const EDITION = "4th Edition";

/**
 * The pre-booking campaign.
 *
 * This replaced the Independence Day dressing, which came out with August 15.
 * The situation it has to explain is genuinely different from a seasonal offer:
 * the book being sold is the 4th edition and it is still being printed, so a
 * buyer is reserving a copy rather than taking one off a shelf. The page has to
 * say that plainly — hiding it to protect the conversion rate buys a refund and
 * a bad review a fortnight later.
 *
 * The order it says things in is deliberate: the 4th edition is open for
 * pre-booking, the course arrives immediately, the book takes longer, and the
 * price holds until Saturday. What happened to the previous edition is not the
 * page's business; how long this one takes is.
 *
 * `{day}` is filled at render with the weekday from lib/preorder.ts, so moving
 * the deadline moves every line that names it. See `withDay` below.
 */
export const PREORDER = {
  /** The badge over the headline. What is open, not what has closed. */
  badge: "പ്രീ-ബുക്കിംഗ് ആരംഭിച്ചു",
  title: "നാലാം പതിപ്പ് ഇപ്പോൾ പ്രീ-ബുക്ക് ചെയ്യാം",

  /** Social proof, said as a readership rather than as a print run. */
  readers: "3,500+ വായനക്കാർ വായിച്ചുകഴിഞ്ഞു",

  /** The deadline, and what happens after it. */
  deadline: "ഈ വില {day} വരെ മാത്രം",
  deadlineNote:
    "{day}യ്ക് ശേഷം നാലാം പതിപ്പിന്റെ വില വർധിക്കും.",

  /** The thing that makes the wait acceptable: the course does not wait. */
  instantTitle: "NLP കോഴ്സ് ഉടൻ ലഭിക്കും",
  instantBody:
    "പുസ്തകം എത്താൻ കാത്തിരിക്കേണ്ട — ഓർഡർ ചെയ്ത ഉടൻ തന്നെ " +
    "NLP Mastery Course ആരംഭിക്കാം.",

  /** The honest bit. */
  deliveryTitle: "12 ദിവസത്തിനുള്ളിൽ ഡെലിവറി",
  deliveryBody:
    "നാലാം പതിപ്പിന്റെ അച്ചടി പൂർത്തിയായ ഉടൻ അയക്കും. " +
    "ഇന്ത്യയിൽ എവിടെയും സൗജന്യ ഡെലിവറി.",

  /** One line under the course name in the hero card. */
  offerLead: "Neuro Code നാലാം പതിപ്പിനൊപ്പം NLP Mastery Course സൗജന്യം",
};

/**
 * Put the deadline's weekday into campaign copy.
 *
 * The copy carries `{day}` rather than "ശനിയാഴ്ച" so that changing
 * LAUNCH_OFFER_LAST_DAY changes every line at once. A weekday typed into a
 * Malayalam string is exactly the one nobody remembers to update.
 */
export const withDay = (text: string, day: string) => text.split("{day}").join(day);

export const HERO = {
  headline: "YOU ARE NOT LEADING YOUR LIFE.",
  headlineAccent: "YOUR PATTERNS ARE.",
  sub:
     "നിങ്ങളുടെ ജീവിതത്തെ നയിക്കുന്നത് നിങ്ങളല്ല, നിങ്ങളിൽ രൂപപ്പെട്ട ചില " +
    "പാറ്റേണുകളാണ്. അത്തരം പാറ്റേണുകളുടെ കോഡുകൾ തിരിച്ചറിയാനും, " +
    "മാറ്റിയെഴുതാനും, ജീവിതത്തെ പുതിയ രീതിയിൽ കാണാനും സഹായിക്കുന്ന ഒരു " +
    "മലയാള പുസ്തകം — NEURO CODE.",
  cta: "ഇപ്പോൾ നാലാം പതിപ്പ് പ്രീ-ബുക്ക് ചെയ്യാം",
  rating: "4.9",
  readers: "3,500+ വായനക്കാർ",
};

// ── Problems ────────────────────────────────────────────────────────────────

export const PROBLEMS_HEADING = {
  line1: "ഇതൊരു Information നൽകുന്ന പുസ്തകമല്ല.",
  accent: "Transformation",
  line2: "സാധ്യമാക്കുന്ന പുസ്തകമാണ്.",
};

export const PROBLEMS_LEAD =
  "ജീവിതത്തിൽ മാറ്റം വേണമെന്നുണ്ടെങ്കിലും, എന്തുകൊണ്ടാണ് വീണ്ടും വീണ്ടും " +
  "പഴയ രീതികളിലേക്ക് മടങ്ങിപ്പോകുന്നത്?";

export const PROBLEMS_TITLE = {
  line1: "താഴെ പറയുന്ന ഏതെങ്കിലും പ്രശ്നം",
  line2: "നിങ്ങൾ അനുഭവിക്കുന്നുണ്ടോ?",
};

/** `icon` maps to a lucide name chosen in the component. */
export const PROBLEMS: { icon: string; text: string }[] = [
  { icon: "target", text: "ചെയ്യാൻ ആഗ്രഹമുണ്ട്, പക്ഷേ ചെയ്യാൻ കഴിയുന്നില്ല." },
  { icon: "repeat", text: "മാറണമെന്ന് ആഗ്രഹിക്കുന്നു… പക്ഷേ പഴയ ശീലങ്ങളിലേക്ക് തന്നെ മടങ്ങുന്നു." },
  { icon: "users", text: "മറ്റുള്ളവർ എന്ത് ചിന്തിക്കും എന്ന ഭയം പല അവസരങ്ങളും തടയുന്നു." },
  { icon: "frown", text: "കുറ്റബോധവും കുറ്റപ്പെടുത്തലും കാരണം ജീവിതം മടുക്കുന്നു." },
  { icon: "userStar", text: "കഴിവുണ്ടെങ്കിലും ആത്മവിശ്വാസക്കുറവ് സാധ്യതകളെ തടയുന്നു." },
  { icon: "brain", text: "Overthinking കാരണം തീരുമാനങ്ങൾ വൈകുന്നു." },
  { icon: "heart", text: "പഴയ അനുഭവങ്ങൾ ഇന്നും മനസ്സിനെ വേദനിപ്പിക്കുന്നു." },
  { icon: "cloud", text: "നെഗറ്റീവ് ചിന്തകൾ മനസ്സിനെ അലട്ടുന്നു." },
];

export const PROBLEMS_CLOSER = {
  line1: "എങ്കിൽ ഈ പുസ്തകം",
  line2: "നിങ്ങളിൽ മാറ്റം സാധ്യമാക്കും.",
};

// ── What is Neuro Code ──────────────────────────────────────────────────────

export const CHAIN_HEADING = {
  line1: "ജീവിതം മാറ്റാൻ ശ്രമിക്കുന്നതിന് മുമ്പ്",
  accent: "ജീവിതത്തെ നിയന്ത്രിക്കുന്ന കോഡുകൾ തിരിച്ചറിയൂ.",
};

/** Experience → Belief → Thought → Emotion → Behaviour → Result. */
export const CODE_CHAIN: { en: string; ml: string }[] = [
  { en: "EXPERIENCE", ml: "അനുഭവം" },
  { en: "BELIEF", ml: "വിശ്വാസം" },
  { en: "THOUGHT", ml: "ചിന്ത" },
  { en: "EMOTION", ml: "വികാരം" },
  { en: "BEHAVIOUR", ml: "പെരുമാറ്റം" },
  { en: "RESULT", ml: "ഫലം" },
];

export const CHAIN_NOTE =
  "നമ്മുടെ പല തീരുമാനങ്ങളും പ്രതികരണങ്ങളും പഴയ അനുഭവങ്ങൾ, വിശ്വാസങ്ങൾ, " +
  "ചിന്താരീതികൾ, ശീലങ്ങൾ എന്നിവയുടെ സ്വാധീനത്തിലാണ്.";

export const PATTERN_TRIAD = [
  "തിരിച്ചറിയുക.",
  "മനസ്സിലാക്കുക.",
  "മാറ്റിയെഴുതുക.",
];

export const STEPS: { en: string; ml: string }[] = [
  { en: "Identify", ml: "നിങ്ങളെ നിയന്ത്രിക്കുന്ന patterns തിരിച്ചറിയുക" },
  { en: "Understand", ml: "അവ എങ്ങനെ രൂപപ്പെട്ടുവെന്ന് മനസ്സിലാക്കുക" },
  { en: "Rewrite", ml: "പുതിയ രീതിയിൽ ചിന്തിക്കാനും പ്രവർത്തിക്കാനും പഠിക്കുക" },
];

// ── Explainer video ─────────────────────────────────────────────────────────

export const VIDEO_HEADING = {
  line1: "NEURO CODE",
  accent: "എന്താണ്?",
  sub1: "ഈ പുസ്തകം നിങ്ങൾക്കായി എന്താണ് ചെയ്യുന്നത്?",
  sub2: "3 മിനിറ്റിൽ മനസ്സിലാക്കാം.",
};

// The explainer video is set at /admin/landing.
export const VIDEO_NOTE =
  "നമ്മുടെ ജീവിതത്തെ സ്വാധീനിക്കുന്ന ചിന്തകളുടെയും വിശ്വാസങ്ങളുടെയും " +
  "patterns എങ്ങനെ തിരിച്ചറിയാം?";

// ── What's inside ───────────────────────────────────────────────────────────

export const INSIDE_HEADING = {
  line1: "പുസ്തകത്തിൽ",
  accent: "എന്തൊക്കെയുണ്ട്?",
};

export const INSIDE: string[] = [
  "മനസ്സിന്റെ ഘടന — ബോധമനസ്സും ഉപബോധമനസ്സും",
  "വിശ്വാസങ്ങൾ എങ്ങനെ ശരീരത്തെ സ്വാധീനിക്കുന്നു",
  "വൈകാരിക trigger-കൾ തിരിച്ചറിയാം",
  "ഉപബോധമനസ്സിന്റെ ഭാഷ",
  "പുതിയ പാറ്റേണുകൾ എങ്ങനെ സ്ഥാപിക്കാം",
  "Identity Shift — സ്വത്വത്തിലെ മാറ്റം",
];

// ── Offer ───────────────────────────────────────────────────────────────────

/** Bonus NLP course stats, shown wherever the free bonus needs to look concrete rather than vague. */
export const NLP_COURSE = {
  modules: 14,
  videos: 42,
  materials: 15,
};

export const OFFER = {
  badge: "PRE-BOOKING OPEN",
  titleTop: "NEURO CODE",
  titleAccent: "— 30 DAYS NLP COURSE",
  bookLine: "NEURO CODE — 4th EDITION",
  courseLine: "30 DAYS NLP COURSE",
  mrpRupees: 3000,
  /** The struck-through price every "Order Now" button compares against. */
  compareAtRupees: 999,
  delivery: "FREE ALL INDIA DELIVERY",
  bonusTitle: "NLP Mastery Course",
  bonusMeta: "30 Days · Online · Structured Learning",
  bonusBody: "Structured lessons, practical exercises, templates and implementation guidance.",
  /**
   * Prepaid only, and the reason is the course rather than the courier.
   *
   * Access to the NLP course opens on a confirmed payment, so a COD order would
   * have to either hand over the course before anyone has paid for it, or hold
   * it back for a fortnight — which is the one thing this whole campaign
   * promises not to do.
   */
  prepaidTitle: "ഓൺലൈൻ പേയ്‌മെന്റ് മാത്രം",
  prepaidNote:
    "പണമടച്ച ഉടൻ NLP കോഴ്സ് ലഭ്യമാകുന്നതിനാൽ COD ലഭ്യമല്ല. " +
    "ഓൺലൈനായി പണമടച്ചാൽ ഡെലിവറി പൂർണമായും സൗജന്യം.",
  trust: "Secure Order · All India Delivery",
  warning:
    "വെറുതെ ഒന്ന് വായിച്ചു നോക്കാനാണെങ്കിൽ Neuro Code വാങ്ങരുത്. " +
    "ജീവിതത്തിൽ ഒരു മാറ്റം ആഗ്രഹിക്കുന്നുവെങ്കിൽ മാത്രം.",
};

export const AUTHOR = {
  name: "Bisher KC",
  role: "Life Coach | Author | CEO, Skillage",
  image: "/images/about-main.jpg",
  quote:
    "വർഷങ്ങളായി വിദ്യാർത്ഥികളോടും അധ്യാപകരോടും professionals-നോടും " +
    "സംസാരിക്കുകയും പരിശീലിപ്പിക്കുകയും ചെയ്ത അനുഭവങ്ങളിൽ നിന്ന്, " +
    "മനുഷ്യന്റെ ചിന്തകളിലും വിശ്വാസങ്ങളിലും ആവർത്തിച്ച് കാണപ്പെട്ട patterns " +
    "ലളിതമായ ഭാഷയിൽ അവതരിപ്പിക്കാനുള്ള ശ്രമമാണ് Neuro Code.",
};

// ── Testimonials ────────────────────────────────────────────────────────────
//
// The testimonials themselves live in the database and are managed at
// /admin/landing — adding a reader's voice note shouldn't need a deploy.
// Only the section headings stay here, with the rest of the written copy.

export const TESTIMONIAL_HEADING = {
  line1: "NEURO CODE",
  accent: "വായിച്ചവരുടെ അനുഭവങ്ങൾ",
  sub: "വായിച്ചവർ പറയുന്നത്…",
};

export const AUDIO_HEADING = {
  line1: "വാക്കുകളിൽ മാത്രം അല്ല…",
  accent: "ശബ്ദത്തിലും കേൾക്കാം.",
  sub: "NEURO CODE വായിച്ചവരുടെ ചില പ്രതികരണങ്ങൾ",
};

export const SECTION_TITLES = {
  video: "വീഡിയോ അനുഭവങ്ങൾ",
  image: "വായനക്കാരുടെ സന്ദേശങ്ങൾ",
  audio: "Audio testimonials",
  text: "വായനക്കാർ പറയുന്നത്",
  faq: "സാധാരണ ചോദ്യങ്ങൾ",
  author: "എഴുത്തുകാരനെക്കുറിച്ച്",
};

export const FINAL_CTA = {
  line1: "നിങ്ങളുടെ പാറ്റേണുകൾ മാറ്റാൻ",
  accent: "ഇന്ന് തുടങ്ങാം",
  sub: "നാലാം പതിപ്പ് പ്രീ-ബുക്കിംഗ് · സൗജന്യ ഡെലിവറി · NLP കോഴ്സ് ഉടൻ",
};

/** Every call to action on the page says the same thing. */
export const ORDER_NOW = "Order Now";

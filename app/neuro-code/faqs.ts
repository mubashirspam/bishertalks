/**
 * The /neuro-code FAQ, in Malayalam — the audience the book is written for.
 *
 * Its own plain module because both sides need it: the client landing page
 * renders it, and the server page emits it as FAQPage structured data. (It
 * can't live in the landing component — exports of a "use client" module
 * become client references when a server component imports them, and mapping
 * over one throws at request time.)
 *
 * Answers are written as complete standalone paragraphs on purpose: this is
 * the block Google and AI assistants quote, and a "see above" quotes badly.
 */

import { PREORDER_DELIVERY_RANGE, launchOfferDayLabelMl } from "@/lib/preorder";

const DAYS = PREORDER_DELIVERY_RANGE;

/**
 * The FAQ, built around whichever deadline is in force.
 *
 * A function rather than a constant because the deadline now comes from the
 * database — the moment the price is scheduled to change (0048) — and a module
 * constant cannot await. Exactly one of these answers names the day, but that
 * one is the answer about the price, which is the one it is most expensive to
 * have wrong.
 *
 * `day` is the Malayalam weekday the caller already holds: both callers build
 * it from the same instant they build the countdown from, so the FAQ cannot
 * name a different deadline than the clock above it.
 */
export function buildFaqs(day: string = launchOfferDayLabelMl()) {
  return [
    {
      q: "ഈ പുസ്തകം ആർക്കുവേണ്ടിയാണ്?",
      a: "സ്വന്തം ചിന്തകളും ശീലങ്ങളും കാരണം മുന്നോട്ട് പോകാൻ കഴിയുന്നില്ല എന്ന് തോന്നുന്ന ആർക്കും — വിദ്യാർത്ഥി, അധ്യാപകൻ, ജോലിക്കാരൻ, വീട്ടമ്മ, സംരംഭകൻ എന്ന വ്യത്യാസമില്ലാതെ. മനഃശാസ്ത്രത്തിൽ മുൻപരിചയം ആവശ്യമില്ല.",
    },
    {
      q: "പുസ്തകം മലയാളത്തിലാണോ?",
      a: "അതെ. Neuro Code മലയാളത്തിലാണ് എഴുതിയിരിക്കുന്നത്. NLP, Overthinking പോലുള്ള സാങ്കേതിക പദങ്ങൾ മാത്രം ഇംഗ്ലീഷിൽ നിലനിർത്തിയിട്ടുണ്ട്, കാരണം അതാണ് സാധാരണ ഉപയോഗിക്കുന്നത്.",
    },
    {
      q: "ഇത് മതപരമോ ആത്മീയമോ ആയ പുസ്തകമാണോ?",
      a: "അല്ല. Neuro Code neuroscience, NLP (Neuro-Linguistic Programming), behavioural psychology എന്നിവയെ അടിസ്ഥാനമാക്കിയുള്ളതാണ്. ഏത് വിശ്വാസത്തിൽപ്പെട്ടവർക്കും പ്രായോഗികമായി ഉപയോഗിക്കാം.",
    },
    {
      q: "30 ദിവസത്തെ NLP കോഴ്സ് എങ്ങനെ ലഭിക്കും?",
      a: "പണമടച്ച ഉടനെ കോഴ്സ് ലഭ്യമാകും — പുസ്തകം എത്തുന്നത് വരെ കാത്തിരിക്കേണ്ട. Courses പേജിൽ ഓർഡർ ചെയ്ത അതേ മൊബൈൽ നമ്പർ നൽകി ലോഗിൻ ചെയ്യുക. ലിങ്ക് WhatsApp-ലും അയക്കും.",
    },
    {
      q: "ഓർഡർ ചെയ്താൽ എപ്പോൾ കിട്ടും?",
      a: "ഓർഡർ ഉറപ്പായ ഉടൻ ബുക്ക് അയക്കും. NLP കോഴ്‌സിന് കാത്തിരിക്കേണ്ട — അത് ഓർഡർ ചെയ്ത ഉടൻ തന്നെ ലഭിക്കും.",
    },
    {
      q: "പുസ്തകം എത്ര ദിവസത്തിനുള്ളിൽ ലഭിക്കും?",
      a: `സാധാരണയായി ${DAYS} ദിവസത്തിനുള്ളിൽ ബുക്ക് എത്തും. ഇന്ത്യയിൽ എവിടെയും ഡെലിവറി സൗജന്യമാണ്. ഓർഡർ ചെയ്ത ശേഷം ഓരോ ഘട്ടത്തിലും WhatsApp-ൽ അപ്ഡേറ്റ് ലഭിക്കും, ഒപ്പം ഓർഡർ ട്രാക്ക് ചെയ്യാനുള്ള ലിങ്കും. NLP കോഴ്സിന് കാത്തിരിക്കേണ്ട — അത് ഓർഡർ ചെയ്ത ഉടൻ ലഭിക്കും.`,
    },
    {
      q: "ഈ വില എത്ര നാൾ ഉണ്ടാകും?",
      a: `ഈ വില ${day} വരെ മാത്രമാണ്. അതിന് ശേഷം നാലാം പതിപ്പിന്റെ വില വർധിക്കും.`,
    },
    {
      q: "COD (Cash on Delivery) ഉണ്ടോ?",
      a: "ഇല്ല, ഓൺലൈൻ പേയ്‌മെന്റ് മാത്രമാണ് ലഭ്യം. പണമടച്ച ഉടൻ തന്നെ NLP കോഴ്സിലേക്ക് പ്രവേശനം നൽകുന്നതിനാൽ, പേയ്‌മെന്റ് സ്ഥിരീകരിച്ചാൽ മാത്രമേ ഓർഡർ പൂർത്തിയാക്കാൻ കഴിയൂ. ഓൺലൈനായി പണമടച്ചാൽ ഇന്ത്യയിൽ എവിടെയും ഡെലിവറി പൂർണമായും സൗജന്യമാണ്.",
    },
    {
      q: "ഒപ്പിട്ട കോപ്പി (signed copy) ലഭിക്കുമോ?",
      a: "ലഭിക്കും. ചെക്ക്ഔട്ടിൽ gift option തിരഞ്ഞെടുക്കുക — അപ്പോൾ ഒപ്പിട്ട കോപ്പി തിരഞ്ഞെടുക്കാനുള്ള സൗകര്യം വരും. ബിഷർ കെ.സി. കൈകൊണ്ട് ഒപ്പിട്ട പുസ്തകം, നിങ്ങളുടെ സന്ദേശം എഴുതിയ കാർഡിനൊപ്പം പൊതിഞ്ഞ് അയക്കും. ഗിഫ്റ്റ് റാപ്പിംഗിന് ചെറിയൊരു ചാർജ് ഉണ്ട്; ഒപ്പിടുന്നതിന് അധിക ചാർജ് ഇല്ല.",
    },
  ];
}

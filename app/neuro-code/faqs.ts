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
export const faqs = [
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
    q: "പുസ്തകം എത്ര ദിവസത്തിനുള്ളിൽ ലഭിക്കും?",
    a: "ഇന്ത്യയിൽ എവിടെയും സാധാരണ 5–7 പ്രവൃത്തി ദിവസത്തിനുള്ളിൽ എത്തും. ഓർഡർ ചെയ്ത ശേഷം ഓരോ ഘട്ടത്തിലും WhatsApp-ൽ അപ്ഡേറ്റ് ലഭിക്കും, ഒപ്പം ഓർഡർ ട്രാക്ക് ചെയ്യാനുള്ള ലിങ്കും.",
  },
  {
    q: "COD (Cash on Delivery) ഉണ്ടോ?",
    a: "ഉണ്ട്. പക്ഷേ COD തിരഞ്ഞെടുത്താൽ ഡെലിവറി ചാർജ് സൗജന്യമല്ല. ഓൺലൈനായി പണമടച്ചാൽ ഇന്ത്യയിൽ എവിടെയും ഡെലിവറി പൂർണമായും സൗജന്യമാണ്.",
  },
  {
    q: "ഒപ്പിട്ട കോപ്പി (signed copy) ലഭിക്കുമോ?",
    a: "പരിമിതമായ എണ്ണം signed copies ലഭ്യമാണ്. WhatsApp വഴി ബന്ധപ്പെട്ടാൽ ലഭ്യത അറിയിക്കാം.",
  },
];

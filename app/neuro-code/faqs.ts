/**
 * The /neuro-code FAQ, in its own plain module because both sides need it:
 * the client landing page renders it, and the server page emits it as
 * FAQPage JSON-LD. (It can't live in NeuroCodeLanding.tsx — exports of a
 * "use client" module become client references when imported by a server
 * component, and mapping over one throws at request time.)
 *
 * Keeping one list is the point: schema that quotes the page verbatim can
 * never contradict it, and FAQ answers are the block search engines and AI
 * assistants quote most — write them as complete, standalone paragraphs.
 */
export const faqs = [
  {
    q: "Who is this book for?",
    a: "Neuro Code is for anyone who feels stuck, unfulfilled, or limited by their own thinking — whether you're a student, professional, entrepreneur, or someone seeking deeper personal transformation.",
  },
  {
    q: "Is this a religious or spiritual book?",
    a: "No. Neuro Code is grounded in neuroscience, NLP (Neuro-Linguistic Programming), and behavioral psychology. It's practical, evidence-based, and applicable regardless of background or belief.",
  },
  {
    q: "How long is the book?",
    a: "The book is concise and power-packed — designed to be read in a weekend but referenced for a lifetime. Quality over quantity is the philosophy.",
  },
  {
    q: "Is it available in languages other than English?",
    a: "Currently available in English and Malayalam. More regional language editions are in production.",
  },
  {
    q: "Can I get a signed copy?",
    a: "Yes! Limited signed copies are available. Contact us directly via the website or WhatsApp for signed editions.",
  },
  {
    q: "How long does delivery take in India?",
    a: "Orders are shipped across India and typically arrive within 5–7 business days. You get WhatsApp updates at every stage, and a tracking link the moment your order ships.",
  },
  {
    q: "How do I access the free NLP course after purchase?",
    a: "Instantly. The moment your payment is confirmed the course is unlocked — go to the Courses page and sign in with the same mobile number you ordered with. There's no waiting for the book to arrive, and no extra charge. We also send the link on WhatsApp.",
  },
];

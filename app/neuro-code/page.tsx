import type { Metadata } from "next";
import { getCachedProductPricing, getScheduledPriceChange } from "@/lib/db/courses";
import NeuroCodeLanding from "./NeuroCodeLanding";
import { getLandingContent } from "@/lib/db/landing";
import {
  PREORDER_DELIVERY_RANGE,
  launchOfferIsLive,
  resolveOfferDeadline,
  launchOfferDayLabel,
  launchOfferDayLabelMl,
  launchOfferDateLabel,
  preorderArrivesBy,
} from "@/lib/preorder";
import { onamIsLive } from "@/lib/onam";
import { buildFaqs } from "./faqs";

// Kept dynamic on purpose. The reads below are cached now, so this no longer
// costs a database round trip per visit — but prerendering the route would put
// the HTML in the full route cache, and referral attribution (which decides who
// gets paid commission) is set per request in proxy.ts. Rendering per request
// keeps that path exactly as it is; the win here was the caching, not the
// rendering.
export const dynamic = "force-dynamic";

const URL = "https://bishertalks.com/neuro-code";
const COVER = "https://bishertalks.com/images/book_front.png";

/**
 * Metadata is generated, not static, so the live price appears in the SERP
 * snippet and share cards — a concrete ₹ number measurably lifts click-through
 * on product listings, and a hardcoded one would drift the first time the
 * price changes in admin.
 */
export async function generateMetadata(): Promise<Metadata> {
  const pricing = await getCachedProductPricing();

  const title = "Neuro Code — The Book by Bisher KC | Free NLP Course Included";
  const description =
    `Order the 4th edition of Neuro Code by Bisher KC for ₹${pricing.payable} — the psychology & NLP book on rewriting your internal programming. ` +
    `Read by 3,500+ readers. Free 14-module NLP Mastery course unlocked the moment you order; ` +
    `book delivered free across India in ${PREORDER_DELIVERY_RANGE} days.`;

  return {
    title,
    description,
    alternates: { canonical: URL },
    openGraph: {
      type: "website",
      url: URL,
      title,
      description,
      siteName: "BisherTalks",
      locale: "en_IN",
      images: [{ url: COVER, width: 488, height: 672, alt: "Neuro Code book cover — Bisher KC" }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [COVER],
    },
  };
}

export default async function NeuroCodePage() {
  // Pricing and CMS content in parallel — neither depends on the other. Both
  // are cached and tag-invalidated on admin edit, so the page still renders per
  // request but stops paying for a database round trip on every visit.
  const [pricing, landing, scheduled] = await Promise.all([
    getCachedProductPricing(),
    getLandingContent(),
    getScheduledPriceChange(),
  ]);

  // The deadline the page names is the moment the price actually changes (0048).
  //
  // A change that has already landed is history, not a deadline — falling back
  // then gives the hardcoded date, which is also past, so the offer framing
  // disappears rather than counting down to something that already happened.
  const deadline = resolveOfferDeadline(
    scheduled && !scheduled.applied ? scheduled.effectiveAt : null
  );

  // Built from the same instant as the countdown, so the FAQ answer about how
  // long the price lasts cannot name a different day than the clock above it.
  const faqs = buildFaqs(launchOfferDayLabelMl(deadline));

  // Product + Book + FAQ schema, built from the same data the page renders —
  // the live price and the on-screen FAQ — so it can't contradict the page.
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": ["Product", "Book"],
        "@id": `${URL}#book`,
        name: "Neuro Code",
        alternateName: "ന്യൂറോ കോഡ്",
        author: { "@id": "https://bishertalks.com/#person" },
        publisher: { "@id": "https://bishertalks.com/#organization" },
        image: COVER,
        url: URL,
        description:
          "Neuro Code is a self-help psychology book by life coach Bisher KC on rewriting the mental programming that drives your thoughts, habits and outcomes, using NLP and behavioural psychology. Every copy includes free access to the 14-module NLP Mastery video course.",
        genre: ["Self-Help", "Psychology", "Neuro-Linguistic Programming"],
        // Per the on-page FAQ: Malayalam and English editions.
        inLanguage: ["ml", "en"],
        bookFormat: "https://schema.org/Paperback",
        offers: {
          "@type": "Offer",
          url: URL,
          price: String(pricing.payable),
          priceCurrency: "INR",
          availability: "https://schema.org/InStock",
          itemCondition: "https://schema.org/NewCondition",
          shippingDetails: {
            "@type": "OfferShippingDetails",
            shippingDestination: { "@type": "DefinedRegion", addressCountry: "IN" },
            deliveryTime: {
              "@type": "ShippingDeliveryTime",
              transitTime: {
                "@type": "QuantitativeValue",
                minValue: 5,
                maxValue: 7,
                unitCode: "DAY",
              },
            },
          },
        },
      },
      {
        "@type": "FAQPage",
        "@id": `${URL}#faq`,
        mainEntity: faqs.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      {/* Decided here, on the server, and handed down. The route is
          force-dynamic, so this is evaluated per request — and doing it here
          rather than in the browser is what keeps the deadline copy from
          rendering one way on the server and another after hydration. */}
      <NeuroCodeLanding
        pricing={pricing}
        testimonials={landing.testimonials}
        settings={landing.settings}
        // In season or not, answered on the server for the same reason the
        // campaign's `live` is: a band that appeared on hydration would flash
        // in after the page had already been read.
        onam={{ live: onamIsLive() }}
        campaign={{
          live: launchOfferIsLive(Date.now(), deadline),
          // The clock, decided here for the same reason `live` is. The browser
          // is handed the deadline *and* the gap the server measured, so its
          // first render prints the second the server printed; only after
          // hydration does it start reading the local clock. Working the gap
          // out in the browser instead would put a different number in the DOM
          // than the HTML carries, on the one element that is meant to be
          // stared at.
          endsAt: deadline.getTime(),
          remainingMs: deadline.getTime() - Date.now(),
          day: launchOfferDayLabel(deadline),
          dayMl: launchOfferDayLabelMl(deadline),
          date: launchOfferDateLabel(deadline),
          arrivesBy: preorderArrivesBy(),
          deliveryDays: PREORDER_DELIVERY_RANGE,
        }}
      />
    </>
  );
}

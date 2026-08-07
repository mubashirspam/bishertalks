import type { Metadata } from "next";
import { getProductPricing } from "@/lib/db/courses";
import NeuroCodeLanding from "./NeuroCodeLanding";
import { faqs } from "./faqs";

// Price is admin-editable, so this page can't be statically cached.
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
  const pricing = await getProductPricing();

  const title = "Neuro Code — The Book by Bisher KC | Free NLP Course Included";
  const description =
    `Order Neuro Code by Bisher KC for ₹${pricing.payable} — the psychology & NLP book on rewriting your internal programming. ` +
    "Free 14-module NLP Mastery course (42 videos, 17 worksheets, ₹2,499 value) unlocked the moment you order. Ships across India.";

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
  const pricing = await getProductPricing();

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
      <NeuroCodeLanding pricing={pricing} />
    </>
  );
}

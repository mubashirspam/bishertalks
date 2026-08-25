import type { Metadata } from "next";
import { Inter, Noto_Sans_Malayalam, Anek_Malayalam } from "next/font/google";
import "./globals.css";
import ThemeProvider from "@/components/ThemeProvider";
import MetaPixelRouteTracker from "@/components/MetaPixel";
import GoogleAnalyticsRouteTracker from "@/components/GoogleAnalytics";

/**
 * Meta Pixel IDs.
 *
 * Comma-separated, so a second ad account can track the same site alongside
 * the first: `fbq('init', ...)` is called once per ID and a plain
 * `fbq('track', ...)` then reports every event into all of them. Hardcoded
 * default so it works without extra Vercel config, overridable by env, and off
 * in development.
 */
const META_PIXEL_IDS = (
  process.env.NODE_ENV === "production"
    ? process.env.NEXT_PUBLIC_FACEBOOK_PIXEL_ID || "1059545799769579"
    : process.env.NEXT_PUBLIC_FACEBOOK_PIXEL_ID || ""
)
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

/**
 * Google tag IDs.
 *
 * Comma-separated like the pixel above, because one gtag.js load serves every
 * Google product: a GA4 measurement ID (G-XXXXXXXXXX) and a Google Ads
 * conversion ID (AW-XXXXXXXXX) can sit side by side here and each `gtag('event',
 * ...)` reports into all of them.
 *
 * No hardcoded fallback — unlike the pixel there is nothing sensible to guess,
 * so this is entirely driven by NEXT_PUBLIC_GA_MEASUREMENT_ID. Set it in Vercel
 * and leave it blank in .env.local: that is what keeps `npm run dev` out of the
 * real property instead of filling the reports with localhost sessions.
 */
const GOOGLE_TAG_IDS = (process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID || "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

// Malayalam body text renders in this rather than Inter's Latin fallback —
// conjuncts stay crisp instead of falling to the system font.
const malayalam = Noto_Sans_Malayalam({
  subsets: ["malayalam", "latin"],
  variable: "--font-malayalam",
  display: "swap",
});

// The landing hero's Malayalam voice, for the lines that should feel personal.
// Variable across 100–800, so font-bold and font-black on it get real cuts
// rather than the browser smearing a single weight to fake them.
const anek = Anek_Malayalam({
  subsets: ["malayalam", "latin"],
  variable: "--font-anek",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://bishertalks.com"),
  title: {
    default: "Bisher KC | Life Coach, Author & Corporate Trainer | Neuro Code",
    template: "%s | Bisher KC - BisherTalks",
  },
  description:
    "Bisher KC is a renowned Life Coach, Author of Neuro Code, and Corporate Trainer. Transform your mindset, unlock your potential, and lead with clarity. CEO of Skillage, helping lakhs achieve personal and professional excellence through NLP, mindset coaching, and transformative learning programs.",
  keywords: [
    "Bisher KC",
    "BisherTalks",
    "bishertalks.com",
    "Neuro Code",
    "Neuro Code book",
    "life coach India",
    "life coach Kerala",
    "best life coach",
    "corporate trainer India",
    "motivational speaker India",
    "NLP trainer",
    "mindset coach",
    "leadership training",
    "public speaking trainer",
    "personal development coach",
    "professional growth",
    "Skillage",
    "Skillage CEO",
    "transformation coach",
    "mindset reset",
    "executive coaching",
    "team building trainer",
    "bootcamp trainer",
    "self improvement",
    "confidence building",
    "clarity coaching",
    "purpose driven life",
    "spiritual growth coach",
    "mind power training",
    "trainers training",
    "teachers training",
    "corporate outbound training",
    "OBT training",
    "motivational keynote speaker",
    "life transformation",
    "rewrite your story",
    "lead with clarity",
    "NLP course free",
    "neuro linguistic programming course",
    "free NLP training online",
    "NLP course India",
    "NLP video lessons free",
    "learn NLP free",
    "NLP for beginners",
    "NLP techniques",
    "NLP anchoring",
    "NLP reframing",
    "NLP modalities",
    "NLP belief system",
  ],
  authors: [{ name: "Bisher KC", url: "https://bishertalks.com" }],
  creator: "Bisher KC",
  publisher: "BisherTalks",
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  alternates: {
    canonical: "https://bishertalks.com",
  },
  openGraph: {
    type: "website",
    locale: "en_IN",
    url: "https://bishertalks.com",
    title: "Bisher KC | Life Coach, Author & Corporate Trainer | Neuro Code",
    description:
      "Transform your mindset, unlock your potential, and lead with clarity. Bisher KC is a renowned Life Coach, Author of Neuro Code, and Corporate Trainer helping lakhs achieve excellence.",
    siteName: "BisherTalks",
    images: [
      {
        url: "/og-image.jpg",
        width: 1200,
        height: 630,
        alt: "Bisher KC - Life Coach, Author & Corporate Trainer",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Bisher KC | Life Coach, Author & Corporate Trainer",
    description:
      "Transform your mindset with Neuro Code. Life coaching, corporate training, and transformative learning by Bisher KC.",
    images: ["/og-image.jpg"],
    creator: "@bisherkc",
  },
  robots: {
    index: true,
    follow: true,
    nocache: false,
    googleBot: {
      index: true,
      follow: true,
      noimageindex: false,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  // Google Search Console verification: verify via DNS or drop the real token
  // here — a placeholder string does nothing and looks broken in the source.
  category: "Education",
  classification: "Life Coaching, Personal Development, Corporate Training",
};

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": "https://bishertalks.com/#website",
      url: "https://bishertalks.com",
      name: "BisherTalks",
      description: "Bisher KC - Life Coach, Author & Corporate Trainer",
      publisher: {
        "@id": "https://bishertalks.com/#person",
      },
      potentialAction: {
        "@type": "SearchAction",
        target: "https://bishertalks.com/?s={search_term_string}",
        "query-input": "required name=search_term_string",
      },
    },
    {
      "@type": "Person",
      "@id": "https://bishertalks.com/#person",
      name: "Bisher KC",
      url: "https://bishertalks.com",
      image: {
        "@type": "ImageObject",
        url: "https://bishertalks.com/images/about-main.jpg",
        width: 853,
        height: 1280,
      },
      description:
        "Bisher KC is a renowned Life Coach, Author of Neuro Code, and Corporate Trainer. CEO of Skillage, helping individuals and organizations achieve personal and professional excellence.",
      jobTitle: [
        "Life Coach",
        "Author",
        "Corporate Trainer",
        "Motivational Speaker",
        "CEO",
      ],
      worksFor: {
        "@type": "Organization",
        name: "Skillage",
      },
      knowsAbout: [
        "Life Coaching",
        "NLP",
        "Neuro Code",
        "Corporate Training",
        "Public Speaking",
        "Mindset Coaching",
        "Leadership Training",
        "Personal Development",
      ],
      sameAs: [
        "https://www.instagram.com/bisherkc",
        "https://www.youtube.com/@bisherkc",
        "https://www.linkedin.com/in/bisherkc",
        "https://www.facebook.com/bisherkc",
      ],
      address: {
        "@type": "PostalAddress",
        addressRegion: "Kerala",
        addressCountry: "India",
      },
    },
    {
      "@type": "Organization",
      "@id": "https://bishertalks.com/#organization",
      name: "Skillage",
      url: "https://bishertalks.com",
      logo: {
        "@type": "ImageObject",
        url: "https://bishertalks.com/logo.png",
      },
      founder: {
        "@id": "https://bishertalks.com/#person",
      },
      description:
        "Empowering individuals and organizations through transformative learning",
    },
    // The Book schema lives on /neuro-code, not here: it carries the live
    // price as an Offer, and a second static copy would drift and contradict it.
    {
      "@type": "Service",
      serviceType: "Life Coaching",
      provider: {
        "@id": "https://bishertalks.com/#person",
      },
      areaServed: {
        "@type": "Country",
        name: "India",
      },
      description:
        "Personal transformation through mindset coaching, NLP techniques, and Neuro Code methodology",
    },
    {
      "@type": "Service",
      serviceType: "Corporate Training",
      provider: {
        "@id": "https://bishertalks.com/#person",
      },
      areaServed: {
        "@type": "Country",
        name: "India",
      },
      description:
        "Leadership training, team building, corporate outbound training, and professional development programs",
    },
    {
      "@type": "Course",
      name: "Neuro Linguistic Programming (NLP) Mastery",
      // Numbers must match the landing page exactly — contradictory counts
      // across a site are what make search engines and AI assistants hedge.
      description:
        "Free NLP course with 14 modules, 42 video lessons, and 17 downloadable worksheets. Learn NLP filters, anchoring, modalities, reframing, belief systems, and more.",
      url: "https://bishertalks.com/courses/nlp",
      provider: {
        "@id": "https://bishertalks.com/#person",
      },
      instructor: {
        "@type": "Person",
        name: "Bisher KC",
      },
      isAccessibleForFree: true,
      inLanguage: "en",
      courseMode: "online",
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "INR",
        availability: "https://schema.org/InStock",
      },
    },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${malayalam.variable} ${anek.variable}`} suppressHydrationWarning>
      <head>
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#fb923c" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="BisherTalks" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        {/* Meta Pixel. Inlined here rather than via next/script because an
            afterInteractive inline script isn't in the served HTML at all —
            it only appears once React hydrates, which is impossible to verify
            and silently drops the PageView for anyone who leaves early. This
            is Meta's snippet verbatim; it loads fbevents.js asynchronously, so
            it doesn't block rendering. */}
        {META_PIXEL_IDS.length > 0 && (
          <script
            dangerouslySetInnerHTML={{
              __html: `!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
${META_PIXEL_IDS.map((id) => `fbq('init', '${id}');`).join("\n")}
fbq('track', 'PageView');`,
            }}
          />
        )}
        {/* Google Analytics 4. Inlined here for the same reason as the pixel:
            the initial page_view has to be in the served HTML, not waiting on
            hydration. gtag.js is loaded async from Google, so it doesn't block
            rendering, and one load serves every ID configured below. */}
        {GOOGLE_TAG_IDS.length > 0 && (
          <>
            <script
              async
              src={`https://www.googletagmanager.com/gtag/js?id=${GOOGLE_TAG_IDS[0]}`}
            />
            <script
              dangerouslySetInnerHTML={{
                __html: `window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
${GOOGLE_TAG_IDS.map((id) => `gtag('config', '${id}');`).join("\n")}`,
              }}
            />
          </>
        )}
      </head>
      <body className={inter.className}>
          <ThemeProvider>{children}</ThemeProvider>
          {/* Ad tracking. Left out of development on purpose — otherwise every
              `npm run dev` page load fires a real PageView into the live pixel,
              which quietly poisons the audience and conversion data the ads are
              optimised against. Override with NEXT_PUBLIC_FACEBOOK_PIXEL_ID if
              you ever need to test it locally. */}
          {/* Counts the navigations gtag.js can't see on its own — this is a
              single-page app, so only the first page load is a real document
              load. Safe to mount whenever a tag is configured; it does nothing
              until gtag exists. */}
          {GOOGLE_TAG_IDS.length > 0 && <GoogleAnalyticsRouteTracker />}
          {META_PIXEL_IDS.length > 0 && (
            <>
              <MetaPixelRouteTracker />
              <noscript>
                {META_PIXEL_IDS.map((id) => (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    key={id}
                    height="1"
                    width="1"
                    style={{ display: "none" }}
                    alt=""
                    src={`https://www.facebook.com/tr?id=${id}&ev=PageView&noscript=1`}
                  />
                ))}
              </noscript>
            </>
          )}
        </body>
    </html>
  );
}

import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import ThemeProvider from "@/components/ThemeProvider";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
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
  verification: {
    google: "your-google-verification-code",
  },
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
        url: "https://bishertalks.com/images/bisher-kc.jpg",
        width: 800,
        height: 800,
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
    {
      "@type": "Book",
      name: "Neuro Code",
      author: {
        "@id": "https://bishertalks.com/#person",
      },
      description:
        "Rewrite your internal programming. Discover the hidden codes that drive your thoughts, behaviors, and life outcomes.",
      genre: "Self-Help",
      inLanguage: "en",
    },
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
      description:
        "Free NLP course with 13+ modules, 40+ video lessons, and 18 downloadable worksheets. Learn NLP filters, anchoring, modalities, reframing, belief systems, and more.",
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
    <html lang="en" className={inter.variable} suppressHydrationWarning>
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
      </head>
      <body className={inter.className}>
          <ThemeProvider>{children}</ThemeProvider>
        </body>
    </html>
  );
}

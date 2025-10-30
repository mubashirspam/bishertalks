// app/layout.tsx
import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Bisher KC (@bisher_talks) | Life Coach, Motivational Speaker & CEO of Skillage',
  description: 'Bisher KC (Bisher Talks) - International Trainer, Life Coach & Entrepreneur. Focusing on overcoming public speaking fear, personality development, career growth & life transformation. 83K+ Instagram followers, 61K+ YouTube subscribers. CEO of Skillage Academy.',
  keywords: 'bisher talks, bisher kc, life coach, motivational speaker, corporate trainer, public speaking, personality development, career growth, life transformation, NLP, hypnosis, skillage academy, mind matters, kerala motivational speaker, malayalam motivational speaker, bisher_talks',
  authors: [{ name: 'Bisher KC' }],
  creator: 'Bisher KC',
  publisher: 'Bisher KC - Skillage Academy',
  applicationName: 'Bisher Talks',
  referrer: 'origin-when-cross-origin',
  category: 'Education, Personal Development, Life Coaching',
  classification: 'Life Coaching and Personal Development',
  openGraph: {
    title: 'Bisher KC (@bisher_talks) | Life Coach & Motivational Speaker',
    description: 'International Trainer, Life Coach & Entrepreneur. Focusing on overcoming public speaking fear, personality development, career growth & life transformation. 83K+ Instagram, 61K+ YouTube followers.',
    type: 'website',
    locale: 'en_US',
    alternateLocale: ['ml_IN'],
    siteName: 'Bisher Talks',
    url: 'https://bishertalks.com',
    images: [
      {
        url: '/og-image.jpg',
        width: 1200,
        height: 630,
        alt: 'Bisher KC - Life Coach and Motivational Speaker',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Bisher KC (@bisher_talks) | Life Coach & Motivational Speaker',
    description: 'International Trainer focusing on public speaking, personality development & life transformation. 83K+ Instagram, 61K+ YouTube followers.',
    creator: '@bisher_talks',
    images: ['/twitter-image.jpg'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  verification: {
    google: 'your-google-verification-code',
    // yandex: 'your-yandex-verification-code',
    // bing: 'your-bing-verification-code',
  },
  alternates: {
    canonical: 'https://bishertalks.com',
    languages: {
      'en-US': 'https://bishertalks.com',
      'ml-IN': 'https://bishertalks.com/ml',
    },
  },
  viewport: {
    width: 'device-width',
    initialScale: 1,
    maximumScale: 5,
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="scroll-smooth">
      <head>
        <link rel="icon" href="/favicon.ico" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#000000" />
        <meta name="format-detection" content="telephone=no" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Bisher Talks" />
        
        {/* Structured Data - JSON-LD */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'Person',
              name: 'Bisher KC',
              alternateName: 'Bisher Talks',
              url: 'https://bishertalks.com',
              image: 'https://bishertalks.com/bisher-kc-profile.jpg',
              sameAs: [
                'https://www.instagram.com/bisher_talks',
                'https://www.youtube.com/@MindMatters',
                'https://www.facebook.com/BisherTalks',
              ],
              jobTitle: 'Life Coach, Corporate Trainer, Motivational Speaker',
              worksFor: {
                '@type': 'Organization',
                name: 'Skillage Academy',
                url: 'https://skillageacademy.com',
              },
              description: 'International Trainer, Life Coach & Entrepreneur focusing on public speaking, personality development, career growth and life transformation.',
              knowsAbout: [
                'Life Coaching',
                'Public Speaking',
                'Personality Development',
                'Corporate Training',
                'NLP',
                'Hypnosis',
                'Motivational Speaking',
                'Career Growth',
              ],
            }),
          }}
        />
        
        {/* Organization Structured Data */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'Organization',
              name: 'Skillage Academy',
              founder: {
                '@type': 'Person',
                name: 'Bisher KC',
              },
              url: 'https://bishertalks.com',
              logo: 'https://bishertalks.com/logo.png',
              sameAs: [
                'https://www.instagram.com/bisher_talks',
                'https://www.youtube.com/@MindMatters',
                'https://www.facebook.com/BisherTalks',
              ],
              contactPoint: {
                '@type': 'ContactPoint',
                contactType: 'Customer Service',
                availableLanguage: ['English', 'Malayalam'],
              },
            }),
          }}
        />
      </head>
      <body className="bg-black text-white antialiased">
        <div className="min-h-screen">
          {children}
        </div>
        
        {/* Background ambient effects */}
        <div className="fixed inset-0 pointer-events-none z-[-1]">
          <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-cyan-900/5 via-purple-900/5 to-pink-900/5"></div>
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-cyan-500/5 rounded-full blur-3xl animate-pulse"></div>
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/5 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }}></div>
          <div className="absolute top-3/4 left-1/3 w-64 h-64 bg-pink-500/5 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '2s' }}></div>
        </div>
      </body>
    </html>
  )
}
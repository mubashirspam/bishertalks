// app/layout.tsx
import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Life Coach Bisher KC | Corporate Trainer & CEO of Skillage',
  description: 'Helping you grow personally and professionally through transformative learning experiences. Life coaching, corporate training, and skill development programs.',
  keywords: 'life coach, corporate trainer, skill development, personal growth, professional development, NLP, public speaking, leadership training',
  authors: [{ name: 'Bisher KC' }],
  creator: 'Bisher KC',
  openGraph: {
    title: 'Life Coach Bisher KC | Corporate Trainer & CEO of Skillage',
    description: 'Helping you grow personally and professionally through transformative learning experiences.',
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Life Coach Bisher KC | Corporate Trainer & CEO of Skillage',
    description: 'Helping you grow personally and professionally through transformative learning experiences.',
  },
  robots: {
    index: true,
    follow: true,
  },
  viewport: 'width=device-width, initial-scale=1',
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
        <meta name="theme-color" content="#000000" />
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
import React from "react";
import Link from "next/link";
import { BookOpen, ArrowRight, Play, FileText, Brain } from "lucide-react";
import {
  courses,
  getTotalLessons,
  getTotalVideos,
  getTotalPdfs,
} from "@/lib/courses-data";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Free NLP & Personal Development Courses by Bisher KC",
  description:
    "Learn Neuro Linguistic Programming (NLP), mindset coaching, and personal development for free. Structured video lessons with downloadable worksheets by Bisher KC, renowned Life Coach and Corporate Trainer.",
  keywords: [
    "free NLP course",
    "free NLP course online",
    "NLP training free",
    "neuro linguistic programming course",
    "NLP course by Bisher KC",
    "free life coaching course",
    "free personal development course",
    "mindset coaching course free",
    "NLP video lessons",
    "NLP worksheets free download",
    "learn NLP online",
    "NLP training India",
    "BisherTalks courses",
    "Bisher KC courses",
    "self improvement course free",
    "NLP for beginners",
    "NLP techniques course",
    "belief system course",
    "reframe NLP",
    "anchoring NLP",
    "modelling NLP",
    "sub modalities NLP",
  ],
  alternates: {
    canonical: "https://bishertalks.com/courses",
  },
  openGraph: {
    title: "Free NLP & Personal Development Courses | BisherTalks",
    description:
      "Learn Neuro Linguistic Programming for free with 40+ video lessons and 18 downloadable worksheets. Structured NLP course by Bisher KC.",
    url: "https://bishertalks.com/courses",
    type: "website",
    siteName: "BisherTalks",
    images: [
      {
        url: "/og-image.jpg",
        width: 1200,
        height: 630,
        alt: "Free NLP Course by Bisher KC",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Free NLP & Personal Development Courses | BisherTalks",
    description:
      "Learn NLP for free — 13 modules, 40+ videos, 18 worksheets. By Bisher KC.",
    images: ["/og-image.jpg"],
  },
};

const coursesJsonLd = {
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  name: "Free Courses by Bisher KC",
  description:
    "Free NLP and personal development courses with video lessons and worksheets.",
  url: "https://bishertalks.com/courses",
  mainEntity: {
    "@type": "ItemList",
    itemListElement: courses.map((course, index) => ({
      "@type": "ListItem",
      position: index + 1,
      item: {
        "@type": "Course",
        name: course.title,
        description: course.description,
        url: `https://bishertalks.com/courses/${course.slug}`,
        provider: {
          "@type": "Person",
          name: "Bisher KC",
          url: "https://bishertalks.com",
        },
        isAccessibleForFree: true,
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "INR",
          availability: "https://schema.org/InStock",
        },
      },
    })),
  },
};

export default function CoursesPage() {
  return (
    <main className="min-h-screen bg-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(coursesJsonLd) }}
      />
      {/* Header */}
      <section className="bg-neutral-900 relative overflow-hidden">
        <div className="absolute inset-0 opacity-5">
          <svg width="100%" height="100%">
            <defs>
              <pattern
                id="courses-pattern"
                x="0"
                y="0"
                width="40"
                height="40"
                patternUnits="userSpaceOnUse"
              >
                <circle cx="20" cy="20" r="1.5" fill="white" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#courses-pattern)" />
          </svg>
        </div>
        <div className="absolute top-0 right-0 w-96 h-96 bg-primary-500/10 rounded-full blur-3xl" />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 md:py-28 relative z-10">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-neutral-400 hover:text-white transition-colors mb-8"
          >
            <ArrowRight className="w-4 h-4 rotate-180" />
            Back to Home
          </Link>
          <div className="max-w-3xl">
            <span className="inline-flex items-center gap-2 px-4 py-1.5 bg-primary-400/10 border border-primary-400/20 rounded-full text-sm font-medium text-primary-400 mb-6">
              <BookOpen className="w-4 h-4" />
              Free Learning Resources
            </span>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-white mb-6">
              Learn & <span className="text-primary-400">Transform</span>
            </h1>
            <p className="text-lg text-neutral-300 leading-relaxed">
              Structured courses designed to help you master your mindset, build
              confidence, and unlock your full potential. Completely free.
            </p>
          </div>
        </div>
      </section>

      {/* Course Grid */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          {courses.map((course) => {
            const totalLessons = getTotalLessons(course);
            const totalVideos = getTotalVideos(course);
            const totalPdfs = getTotalPdfs(course);

            return (
              <Link
                key={course.slug}
                href={`/courses/${course.slug}`}
                className="group block"
              >
                <div className="bg-white rounded-2xl border border-neutral-200 overflow-hidden hover:shadow-xl hover:border-primary-200 transition-all duration-300">
                  {/* Thumbnail */}
                  <div className="aspect-video bg-gradient-to-br from-neutral-900 via-neutral-800 to-neutral-900 relative overflow-hidden">
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <Brain className="w-16 h-16 text-primary-400 mb-3" />
                      <h3 className="text-xl font-bold text-white">
                        {course.subtitle}
                      </h3>
                    </div>
                    <div className="absolute inset-0 bg-primary-500/0 group-hover:bg-primary-500/10 transition-colors" />
                  </div>

                  {/* Content */}
                  <div className="p-6">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="px-2.5 py-0.5 bg-primary-100 text-primary-700 text-xs font-medium rounded-full">
                        Free
                      </span>
                      <span className="px-2.5 py-0.5 bg-neutral-100 text-neutral-600 text-xs font-medium rounded-full">
                        {course.modules.length} Modules
                      </span>
                    </div>

                    <h3 className="text-xl font-bold text-neutral-900 mb-2 group-hover:text-primary-600 transition-colors">
                      {course.title}
                    </h3>
                    <p className="text-neutral-600 text-sm leading-relaxed mb-4 line-clamp-2">
                      {course.description}
                    </p>

                    {/* Stats */}
                    <div className="flex items-center gap-4 pt-4 border-t border-neutral-100">
                      <div className="flex items-center gap-1.5 text-sm text-neutral-500">
                        <Play className="w-4 h-4" />
                        {totalVideos} Videos
                      </div>
                      <div className="flex items-center gap-1.5 text-sm text-neutral-500">
                        <FileText className="w-4 h-4" />
                        {totalPdfs} PDFs
                      </div>
                      <div className="ml-auto text-sm font-medium text-primary-600 flex items-center gap-1 group-hover:gap-2 transition-all">
                        Start
                        <ArrowRight className="w-4 h-4" />
                      </div>
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </section>
    </main>
  );
}

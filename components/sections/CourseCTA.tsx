import React from 'react';
import Link from 'next/link';
import { Play, BookOpen, ArrowRight, Brain, FileText } from 'lucide-react';

export default function CourseCTA() {
  return (
    <section className="py-20 bg-white dark:bg-neutral-900 relative overflow-hidden">
      {/* Background */}
      <div className="absolute top-0 left-0 w-96 h-96 bg-primary-100/20 rounded-full blur-3xl" />
      <div className="absolute bottom-0 right-0 w-72 h-72 bg-primary-200/20 rounded-full blur-3xl" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
          {/* Left Content */}
          <div>
            <span className="inline-flex items-center gap-2 px-4 py-1.5 bg-primary-100 dark:bg-primary-900/30 rounded-full text-sm font-medium text-primary-700 dark:text-primary-400 mb-6">
              <BookOpen className="w-4 h-4" />
              Free Courses
            </span>
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-neutral-900 dark:text-white mb-6 leading-tight">
              Learn NLP <br />
              <span className="text-primary-500">For Free</span>
            </h2>
            <p className="text-lg text-neutral-600 dark:text-neutral-300 leading-relaxed mb-8">
              Master Neuro Linguistic Programming with structured video lessons and
              downloadable worksheets. Learn at your own pace, completely free.
            </p>

            {/* Stats */}
            <div className="flex flex-wrap gap-6 mb-8">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-primary-100 dark:bg-primary-900/30 rounded-xl flex items-center justify-center">
                  <BookOpen className="w-5 h-5 text-primary-600" />
                </div>
                <div>
                  <p className="font-bold text-neutral-900 dark:text-white">13+</p>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">Modules</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-primary-100 dark:bg-primary-900/30 rounded-xl flex items-center justify-center">
                  <Play className="w-5 h-5 text-primary-600" />
                </div>
                <div>
                  <p className="font-bold text-neutral-900 dark:text-white">40+</p>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">Video Lessons</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-orange-100 dark:bg-orange-900/30 rounded-xl flex items-center justify-center">
                  <FileText className="w-5 h-5 text-orange-500" />
                </div>
                <div>
                  <p className="font-bold text-neutral-900 dark:text-white">18</p>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">Worksheets</p>
                </div>
              </div>
            </div>

            <Link
              href="/courses/nlp"
              className="inline-flex items-center gap-2 px-8 py-4 bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 rounded-full font-semibold hover:bg-neutral-800 dark:hover:bg-neutral-100 transition-colors shadow-lg"
            >
              <Play className="w-5 h-5" />
              Start Learning — Free
            </Link>
          </div>

          {/* Right - Course Preview Cards */}
          <div className="relative">
            <div className="absolute inset-4 bg-gradient-to-br from-primary-200 to-primary-100 rounded-3xl transform -rotate-2" />
            <div className="relative bg-white dark:bg-neutral-800 rounded-3xl p-6 shadow-xl border border-neutral-100 dark:border-neutral-700">
              {/* Course Header */}
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 bg-neutral-900 rounded-xl flex items-center justify-center">
                  <Brain className="w-6 h-6 text-primary-400" />
                </div>
                <div>
                  <h3 className="font-bold text-neutral-900 dark:text-white">NLP Mastery Course</h3>
                  <p className="text-sm text-neutral-500 dark:text-neutral-400">Neuro Linguistic Programming</p>
                </div>
                <span className="ml-auto px-3 py-1 bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400 text-xs font-bold rounded-full">
                  FREE
                </span>
              </div>

              {/* Module Preview List */}
              <div className="space-y-2">
                {[
                  'Introduction to NLP',
                  'NLP Filters',
                  'Preferred Representational System',
                  'Mental Map & Internal Representation',
                  'Modalities & Sub-Modalities',
                  'Conditioning & Anchoring',
                ].map((module, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-3 p-3 rounded-xl bg-neutral-50 dark:bg-neutral-700/50 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors"
                  >
                    <span className="w-7 h-7 bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400 rounded-lg text-xs font-bold flex items-center justify-center flex-shrink-0">
                      {index + 1}
                    </span>
                    <span className="text-sm text-neutral-700 dark:text-neutral-300 font-medium">{module}</span>
                    <Play className="w-3.5 h-3.5 text-neutral-400 ml-auto" />
                  </div>
                ))}
                <div className="flex items-center gap-3 p-3 rounded-xl bg-neutral-50 dark:bg-neutral-700/50">
                  <span className="w-7 h-7 bg-neutral-200 dark:bg-neutral-600 text-neutral-500 dark:text-neutral-400 rounded-lg text-xs font-bold flex items-center justify-center flex-shrink-0">
                    +
                  </span>
                  <span className="text-sm text-neutral-500 dark:text-neutral-400 font-medium">7 more modules...</span>
                </div>
              </div>

              {/* Bottom CTA */}
              <Link
                href="/courses/nlp"
                className="mt-6 w-full flex items-center justify-center gap-2 px-6 py-3 bg-primary-400 text-neutral-900 rounded-xl font-semibold hover:bg-primary-300 transition-colors"
              >
                View Full Course
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

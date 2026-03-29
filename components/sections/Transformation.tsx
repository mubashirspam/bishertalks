import React from "react";
import { Quote, Sparkles, ArrowRight } from "lucide-react";

const callouts = [
  {
    question: "If not now, when?",
    answer:
      "Don't wait for the perfect moment. Take the moment and make it perfect.",
    icon: "⏰",
  },
  {
    question: "If not you, who?",
    answer:
      "If you don't lead yourself, others will lead you down their own path.",
    icon: "🎯",
  },
];

export default function Transformation() {
  return (
    <section className="py-20 bg-neutral-50 dark:bg-neutral-950 relative overflow-hidden">
      {/* Decorative elements */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-primary-100/20 rounded-full blur-3xl" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        {/* Header */}
        <div className="text-center mb-12">
          <span className="inline-flex items-center gap-2 px-4 py-1.5 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-full text-sm font-medium text-neutral-600 dark:text-neutral-400 mb-4">
            <Sparkles className="w-4 h-4 text-primary-500" />
            Transformation
          </span>
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-neutral-900 dark:text-white mb-4">
            Your Journey <span className="text-primary-500">Starts Here</span>
          </h2>
        </div>

        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Main Quote Card - Large */}
          <div className="lg:col-span-7 bg-neutral-900 dark:bg-neutral-800 rounded-3xl p-8 md:p-10 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-primary-500/10 rounded-full blur-3xl" />
            <div className="relative z-10">
              <Quote className="w-12 h-12 text-primary-400 mb-6" />
              <h3 className="text-2xl md:text-3xl lg:text-4xl font-bold text-white mb-4 leading-tight">
                Own Your Confidence.
                <br />
                <span className="text-primary-400">Own Your Life.</span>
              </h3>
              <p className="text-lg text-neutral-300 leading-relaxed mb-8">
                Real transformation happens when you take ownership of your
                journey and commit to lasting change.
              </p>
              <a
                href="#contact"
                className="inline-flex items-center gap-2 px-6 py-3 bg-primary-400 text-neutral-900 rounded-full font-semibold hover:bg-primary-300 transition-colors"
              >
                Start Your Journey
                <ArrowRight className="w-5 h-5" />
              </a>
            </div>
          </div>

          {/* Side Cards */}
          <div className="lg:col-span-5 space-y-6">
            {callouts.map((callout, index) => (
              <div
                key={index}
                className="bg-white dark:bg-neutral-800 rounded-2xl p-6 md:p-8 border border-neutral-100 dark:border-neutral-700 hover:border-primary-200 hover:shadow-lg transition-all duration-300 group"
              >
                <div className="flex items-start gap-4">
                  <div className="text-3xl">{callout.icon}</div>
                  <div>
                    <h4 className="text-xl font-bold text-neutral-900 dark:text-white mb-2 group-hover:text-primary-600 transition-colors">
                      {callout.question}
                    </h4>
                    <p className="text-neutral-600 dark:text-neutral-400 leading-relaxed">
                      {callout.answer}
                    </p>
                  </div>
                </div>
              </div>
            ))}

            {/* Meet Bisher Card */}
            <div className="bg-primary-100 dark:bg-primary-900/30 rounded-2xl p-6 md:p-8">
              <p className="text-sm font-medium text-primary-700 dark:text-primary-400 mb-2">
                Your Guide
              </p>
              <h4 className="text-xl font-bold text-neutral-900 dark:text-white mb-1">
                Meet Bisher KC
              </h4>
              <p className="text-neutral-700 dark:text-neutral-300 text-sm">
                Your guide to clarity, confidence, and purposeful living
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

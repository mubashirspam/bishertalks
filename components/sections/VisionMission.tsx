import React from "react";
import { Eye, Target, Sparkles, Star } from "lucide-react";

export default function VisionMission() {
  return (
    <section className="py-20 bg-neutral-50 dark:bg-neutral-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Bento Style Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Vision Card - Light with image */}
          <div className="bg-white dark:bg-neutral-800 rounded-3xl p-8 md:p-10 border border-neutral-100 dark:border-neutral-700 relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-32 h-32 bg-primary-100 rounded-full blur-3xl opacity-50" />

            <div className="relative z-10">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-primary-100 dark:bg-primary-900/30 rounded-xl flex items-center justify-center">
                  <Eye className="w-5 h-5 text-primary-600" />
                </div>
                <span className="text-sm font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
                  Vision
                </span>
              </div>

              <h3 className="text-2xl md:text-3xl lg:text-4xl font-bold text-neutral-900 dark:text-white mb-4 leading-tight">
                Empowering <span className="text-primary-500">One Million</span>{" "}
                Lives
              </h3>

              <p className="text-lg text-neutral-600 dark:text-neutral-300 leading-relaxed mb-8">
                To empower one million people to grow with clarity, confidence,
                and purpose.
              </p>

              {/* Stats */}
              <div className="flex items-center gap-6">
                <div>
                  <div className="text-3xl font-bold text-neutral-900 dark:text-white">
                    100K+
                  </div>
                  <div className="text-sm text-neutral-500 dark:text-neutral-400">Lives Impacted</div>
                </div>
                <div className="w-px h-12 bg-neutral-200 dark:bg-neutral-600" />
                <div>
                  <div className="text-3xl font-bold text-neutral-900 dark:text-white">
                    1000+
                  </div>
                  <div className="text-sm text-neutral-500 dark:text-neutral-400">Sessions</div>
                </div>
              </div>
            </div>
          </div>

          {/* Mission Card - Dark */}
          <div className="bg-neutral-900 dark:bg-neutral-800 rounded-3xl p-8 md:p-10 relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-40 h-40 bg-primary-500/20 rounded-full blur-3xl" />
            <div className="absolute bottom-0 left-0 w-32 h-32 bg-primary-400/10 rounded-full blur-2xl" />

            <div className="relative z-10">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-neutral-800 rounded-xl flex items-center justify-center">
                  <Target className="w-5 h-5 text-primary-400" />
                </div>
                <span className="text-sm font-medium text-neutral-400 uppercase tracking-wider">
                  Mission
                </span>
              </div>

              <h3 className="text-2xl md:text-3xl lg:text-4xl font-bold text-white mb-4 leading-tight">
                Mindset Reset &{" "}
                <span className="text-primary-400">Leadership</span>
              </h3>

              <p className="text-lg text-neutral-300 leading-relaxed mb-8">
                To help people reset their mindset and lead their own lives
                through immersive camps, storytelling, books, training programs
                and personal coaching.
              </p>

              {/* Methods */}
              <div className="flex flex-wrap gap-2">
                {["Camps", "Storytelling", "Books", "Training", "Coaching"].map(
                  (method, i) => (
                    <span
                      key={i}
                      className="px-3 py-1.5 bg-neutral-800 text-neutral-300 text-sm rounded-full border border-neutral-700"
                    >
                      {method}
                    </span>
                  ),
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Banner */}
        <div className="mt-6 bg-primary-400 rounded-3xl p-8 md:p-10 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-white/20 rounded-2xl flex items-center justify-center">
              <Sparkles className="w-7 h-7 text-neutral-900" />
            </div>
            <div>
              <h4 className="text-xl md:text-2xl font-bold text-neutral-900">
                Ready to Transform?
              </h4>
              <p className="text-neutral-800">
                Start your journey to clarity and confidence today.
              </p>
            </div>
          </div>
          <a
            href="#contact"
            className="px-8 py-4 bg-neutral-900 text-white rounded-full font-medium hover:bg-neutral-800 transition-colors whitespace-nowrap"
          >
            Book a Call
          </a>
        </div>
      </div>
    </section>
  );
}

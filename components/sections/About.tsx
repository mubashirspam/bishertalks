import React from "react";
import { Award, Users, Heart, TrendingUp, Star } from "lucide-react";

const highlights = [
  {
    icon: Award,
    title: "Founder & CEO of Skillage",
    description:
      "Building transformative platforms for personal and professional growth",
  },
  {
    icon: Heart,
    title: "SIGN Executive Member",
    description: "Serving the NGO that transformed my life in Wayanad",
  },
  {
    icon: Users,
    title: "Former Govt. Teacher",
    description: "Higher Secondary Economics teacher with deep teaching roots",
  },
  {
    icon: TrendingUp,
    title: "Motivational Speaker",
    description: "Inspiring lakhs through various platforms and stages",
  },
];

export default function About() {
  return (
    <section id="about" className="py-20 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Bento Grid Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-6">
          {/* Large Image Card - Top Left */}
          <div className="lg:col-span-5 lg:row-span-2 bg-neutral-100 rounded-3xl overflow-hidden relative group">
            <div className="absolute inset-0 bg-gradient-to-t from-neutral-900/80 via-neutral-900/20 to-transparent z-10" />

            <img
              src="/images/about-main.jpg"
              alt="Bisher KC"
              className="w-full h-full object-cover"
            />
            <div className="absolute bottom-0 left-0 right-0 p-6 z-20">
              <span className="inline-block px-3 py-1 bg-primary-400 text-neutral-900 text-sm font-semibold rounded-full mb-3">
                15+ Years Experience
              </span>
              <h2 className="text-2xl md:text-3xl font-bold text-white">
                Who Am I?
              </h2>
            </div>
          </div>

          {/* Title Card - Top Right */}
          <div className="lg:col-span-7 bg-neutral-900 rounded-3xl p-6 md:p-8 flex flex-col justify-center">
            <h3 className="text-2xl md:text-3xl lg:text-4xl font-bold text-white mb-4">
              From a Classroom Teacher to{" "}
              <span className="text-primary-400">CEO of Skillage</span>
            </h3>
            <p className="text-neutral-300 leading-relaxed">
              With over 15 years in the field, my journey is rooted in a passion
              for human potential. It began at SIGN (Wayanad), an NGO that
              transformed my life and where I continue to serve as an Executive
              Member.
            </p>
          </div>

          {/* Story Card */}
          <div className="lg:col-span-4 bg-neutral-50 rounded-3xl p-6 md:p-8 border border-neutral-100">
            <p className="text-neutral-700 leading-relaxed mb-4">
              After years as a Higher Secondary Economics teacher, I realized my
              mission was larger: to bridge the gap between potential and
              performance.
            </p>
            <p className="text-neutral-700 leading-relaxed">
              Today, through Skillage, I have reached{" "}
              <span className="font-semibold text-primary-600">
                lakhs of people
              </span>
              , helping them find clarity in a chaotic world.
            </p>
          </div>

          {/* Specializations Card */}
          <div className="lg:col-span-3 bg-primary-400 rounded-3xl p-6 md:p-8 flex flex-col justify-between">
            <div>
              <span className="text-neutral-900 font-semibold text-sm uppercase tracking-wider">
                Specializations
              </span>
              <div className="mt-4 flex flex-wrap gap-2">
                {[
                  "Life Coaching",
                  "Public Speaking",
                  "Corporate Training",
                  "Mind Power",
                ].map((tag, i) => (
                  <span
                    key={i}
                    className="px-3 py-1 bg-white/30 text-neutral-900 text-sm rounded-full"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Highlights Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
          {highlights.map((item, index) => {
            const Icon = item.icon;
            return (
              <div
                key={index}
                className="bg-neutral-50 rounded-2xl p-5 md:p-6 border border-neutral-100 hover:border-primary-200 hover:bg-white transition-all duration-300 group relative overflow-hidden"
              >
                {/* Background Pattern */}
                <div className="absolute inset-0 opacity-5 group-hover:opacity-10 transition-opacity">
                  <svg
                    width="100%"
                    height="100%"
                    viewBox="0 0 100 100"
                    className="w-full h-full"
                  >
                    <defs>
                      <pattern
                        id={`pattern-${index}`}
                        x="0"
                        y="0"
                        width="20"
                        height="20"
                        patternUnits="userSpaceOnUse"
                      >
                        <circle
                          cx="10"
                          cy="10"
                          r="1.5"
                          fill="currentColor"
                          className="text-primary-300"
                        />
                        <circle
                          cx="5"
                          cy="5"
                          r="1"
                          fill="currentColor"
                          className="text-primary-200"
                        />
                        <circle
                          cx="15"
                          cy="15"
                          r="1"
                          fill="currentColor"
                          className="text-primary-200"
                        />
                      </pattern>
                    </defs>
                    <rect
                      width="100%"
                      height="100%"
                      fill={`url(#pattern-${index})`}
                    />
                  </svg>
                </div>

                {/* Content */}
                <div className="relative z-10">
                  <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center mb-3 group-hover:bg-primary-100 transition-colors shadow-sm">
                    <Icon className="w-5 h-5 text-primary-600" />
                  </div>
                  <h3 className="text-sm md:text-base font-semibold text-neutral-900 mb-1">
                    {item.title}
                  </h3>
                  <p className="text-neutral-500 text-xs md:text-sm leading-relaxed">
                    {item.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

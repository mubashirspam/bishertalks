'use client';

import React from "react";

type WorkExperienceSectionProps = Record<string, never>

const WorkExperience: React.FC<WorkExperienceSectionProps> = () => {
  const workAreas = [
    {
      category: "Community & Social Platforms",
      description: "Kudumba Sangamam, Mahall programs, and local initiatives.",
      icon: "👥",
      color: "cyan",
    },
    {
      category: "Educational Institutions",
      description: "Colleges, schools, and teacher training centers.",
      icon: "🎓",
      color: "purple",
    },
    {
      category: "Government & Public Organizations",
      description:
        "Awareness sessions, empowerment programs, and capacity-building workshops.",
      icon: "🏛️",
      color: "pink",
    },
    {
      category: "Political & Social Groups",
      description: "Youth empowerment and leadership training.",
      icon: "🗳️",
      color: "green",
    },
    {
      category: "Corporate & Small-Scale Sectors",
      description:
        "Micro and small-scale institutes, organizational training, and team building.",
      icon: "🏢",
      color: "orange",
    },
  ];

  const getColorClasses = (color: string) => {
    const colorMap = {
      cyan: {
        gradient: "from-cyan-400 to-cyan-600",
        border: "border-cyan-400/30",
        shadow: "shadow-[0_0_20px_rgba(0,255,255,0.1)]",
        hoverShadow: "hover:shadow-[0_0_30px_rgba(0,255,255,0.2)]",
        bg: "bg-cyan-400/10",
        text: "text-cyan-400",
      },
      purple: {
        gradient: "from-purple-400 to-purple-600",
        border: "border-purple-400/30",
        shadow: "shadow-[0_0_20px_rgba(168,85,247,0.1)]",
        hoverShadow: "hover:shadow-[0_0_30px_rgba(168,85,247,0.2)]",
        bg: "bg-purple-400/10",
        text: "text-purple-400",
      },
      pink: {
        gradient: "from-pink-400 to-pink-600",
        border: "border-pink-400/30",
        shadow: "shadow-[0_0_20px_rgba(244,114,182,0.1)]",
        hoverShadow: "hover:shadow-[0_0_30px_rgba(244,114,182,0.2)]",
        bg: "bg-pink-400/10",
        text: "text-pink-400",
      },
      green: {
        gradient: "from-green-400 to-green-600",
        border: "border-green-400/30",
        shadow: "shadow-[0_0_20px_rgba(34,197,94,0.1)]",
        hoverShadow: "hover:shadow-[0_0_30px_rgba(34,197,94,0.2)]",
        bg: "bg-green-400/10",
        text: "text-green-400",
      },
      orange: {
        gradient: "from-orange-400 to-orange-600",
        border: "border-orange-400/30",
        shadow: "shadow-[0_0_20px_rgba(251,146,60,0.1)]",
        hoverShadow: "hover:shadow-[0_0_30px_rgba(251,146,60,0.2)]",
        bg: "bg-orange-400/10",
        text: "text-orange-400",
      },
    };
    return colorMap[color as keyof typeof colorMap];
  };

  return (
    <section className="py-20 px-6 relative">
      <div className="absolute inset-0 bg-gradient-to-b from-gray-900/30 via-black to-gray-900/50"></div>

      {/* Animated background grid */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:60px_60px]"></div>

      <div className="relative z-10 max-w-6xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-bold mb-8">
            <span className="bg-gradient-to-r from-cyan-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
              Where I Have Worked
            </span>
          </h2>

          <p className="text-lg text-gray-300 max-w-3xl mx-auto leading-relaxed">
            I&apos;ve conducted programs across diverse platforms, bringing
            transformational experiences to various communities and
            organizations.
          </p>
        </div>

        <div className="grid gap-8">
          {workAreas.map((area, index) => {
            const colors = getColorClasses(area.color);
            return (
              <div
                key={index}
                className={`group relative flex items-start space-x-6 p-8 bg-gray-900/40 backdrop-blur-sm border ${colors.border} rounded-2xl hover:border-opacity-80 transition-all duration-500 hover:transform hover:scale-[1.02] ${colors.shadow} ${colors.hoverShadow}`}
              >
                <div
                  className={`absolute inset-0 ${colors.bg} rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300`}
                ></div>

                <div className="relative z-10 flex-shrink-0">
                  <div
                    className={`w-16 h-16 bg-gradient-to-br ${colors.gradient} rounded-full flex items-center justify-center text-2xl text-white shadow-lg group-hover:scale-110 transition-transform duration-300`}
                  >
                    {area.icon}
                  </div>
                </div>

                <div className="relative z-10 flex-1">
                  <h3
                    className={`text-xl font-bold mb-3 ${colors.text} group-hover:text-white transition-colors duration-300`}
                  >
                    {area.category}
                  </h3>

                  <p className="text-gray-400 group-hover:text-gray-200 leading-relaxed transition-colors duration-300">
                    {area.description}
                  </p>
                </div>

                {/* Subtle glow effect */}
                <div
                  className={`absolute -inset-1 bg-gradient-to-r ${colors.gradient} rounded-2xl blur opacity-0 group-hover:opacity-20 transition-opacity duration-300`}
                ></div>

                {/* Connection line for visual flow */}
                {index < workAreas.length - 1 && (
                  <div className="absolute -bottom-4 left-1/2 transform -translate-x-1/2 w-0.5 h-8 bg-gradient-to-b from-gray-600 to-transparent"></div>
                )}
              </div>
            );
          })}
        </div>

        {/* Call to action */}
        <div className="mt-16 text-center">
          <div className="inline-block p-8 bg-gradient-to-r from-gray-900/90 to-gray-800/90 backdrop-blur-sm border border-gray-600/40 rounded-2xl shadow-[0_0_40px_rgba(0,0,0,0.5)] max-w-4xl">
            <h3 className="text-2xl font-bold mb-4 bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent">
              Ready to Transform Your Organization?
            </h3>
            <p className="text-lg text-gray-300 leading-relaxed mb-6">
              Whether you&apos;re part of a small team or a large organization,
              I&apos;m here to help unlock your potential through customized
              training programs and transformational workshops.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <button className="px-8 py-4 bg-gradient-to-r from-cyan-500 to-purple-600 text-white font-semibold rounded-lg hover:from-cyan-400 hover:to-purple-500 transform hover:scale-105 transition-all duration-300 shadow-[0_0_30px_rgba(0,255,255,0.3)] hover:shadow-[0_0_40px_rgba(0,255,255,0.5)]">
                Book a Consultation
              </button>
              <button className="px-8 py-4 border-2 border-purple-400 text-purple-400 font-semibold rounded-lg hover:bg-purple-400 hover:text-white transition-all duration-300 shadow-[0_0_20px_rgba(168,85,247,0.2)] hover:shadow-[0_0_30px_rgba(168,85,247,0.4)]">
                View Programs
              </button>
            </div>
          </div>
        </div>

        {/* Contact info */}
        <div className="mt-12 grid md:grid-cols-3 gap-6 text-center">
          <div className="p-6 bg-cyan-900/20 border border-cyan-400/30 rounded-xl">
            <div className="text-2xl mb-2">📧</div>
            <div className="text-cyan-400 font-semibold">Email</div>
            <div className="text-gray-400 text-sm">
              Get in touch for collaborations
            </div>
          </div>

          <div className="p-6 bg-purple-900/20 border border-purple-400/30 rounded-xl">
            <div className="text-2xl mb-2">📱</div>
            <div className="text-purple-400 font-semibold">Skillage App</div>
            <div className="text-gray-400 text-sm">Access online programs</div>
          </div>

          <div className="p-6 bg-pink-900/20 border border-pink-400/30 rounded-xl">
            <div className="text-2xl mb-2">🌐</div>
            <div className="text-pink-400 font-semibold">Social Media</div>
            <div className="text-gray-400 text-sm">
              Follow for daily insights
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default WorkExperience;

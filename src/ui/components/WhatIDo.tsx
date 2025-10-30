'use client';

import React from "react";

type WhatIDoSectionProps = Record<string, never>

const WhatIDo: React.FC<WhatIDoSectionProps> = () => {
  const services = [
    {
      title: "Life Coaching & Mindset Training",
      description: "Reset limiting beliefs and move forward with clarity.",
      icon: "🎯",
      gradient: "from-cyan-400 to-blue-500"
    },
    {
      title: "Trainer's & Teacher's Training",
      description: "Practical methods, icebreakers, and gamification for powerful sessions.",
      icon: "🎓",
      gradient: "from-purple-400 to-pink-500"
    },
    {
      title: "Public Speaking & Communication",
      description: "Build stage confidence and influence any audience.",
      icon: "🎤",
      gradient: "from-pink-400 to-red-500"
    },
    {
      title: "Corporate & Leadership Programs",
      description: "Productivity, teamwork, and workplace effectiveness.",
      icon: "🏢",
      gradient: "from-green-400 to-teal-500"
    },
    {
      title: "Camps & Workshops",
      description: "One-day or multi-day intensive programs for deep transformation.",
      icon: "⛺",
      gradient: "from-orange-400 to-yellow-500"
    },
    {
      title: "Motivational Keynotes",
      description: "Inspiring talks that connect with audiences of all sizes.",
      icon: "✨",
      gradient: "from-indigo-400 to-purple-500"
    }
  ]

  return (
    <section className="py-20 px-6 relative">
      <div className="absolute inset-0 bg-gradient-to-b from-black via-gray-900/50 to-black"></div>
      
      <div className="relative z-10 max-w-6xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-bold mb-6">
            <span className="bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent">
              🎯 What I Do
            </span>
          </h2>
          
          <div className="max-w-3xl mx-auto space-y-4">
            <p className="text-lg text-gray-300 leading-relaxed">
              I design and deliver transformative learning experiences that are:
            </p>
            <div className="flex flex-wrap justify-center gap-4 text-sm md:text-base">
              <span className="px-4 py-2 bg-cyan-500/20 border border-cyan-400/30 rounded-full text-cyan-400">
                ✔ Practical
              </span>
              <span className="px-4 py-2 bg-purple-500/20 border border-purple-400/30 rounded-full text-purple-400">
                ✔ Engaging
              </span>
              <span className="px-4 py-2 bg-pink-500/20 border border-pink-400/30 rounded-full text-pink-400">
                ✔ Result-driven
              </span>
            </div>
          </div>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {services.map((service, index) => (
            <div
              key={index}
              className="group relative p-6 bg-gray-900/50 backdrop-blur-sm border border-gray-700/50 rounded-xl hover:border-cyan-400/50 transition-all duration-300 hover:transform hover:scale-105 hover:shadow-[0_0_30px_rgba(0,255,255,0.1)]"
            >
              <div className="text-4xl mb-4 group-hover:scale-110 transition-transform duration-300">
                {service.icon}
              </div>
              
              <h3 className={`text-xl font-bold mb-3 bg-gradient-to-r ${service.gradient} bg-clip-text text-transparent`}>
                {service.title}
              </h3>
              
              <p className="text-gray-400 leading-relaxed">
                {service.description}
              </p>
              
              {/* Hover effect overlay */}
              <div className="absolute inset-0 bg-gradient-to-br from-cyan-400/5 via-transparent to-purple-400/5 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
            </div>
          ))}
        </div>

        <div className="mt-12 text-center">
          <p className="text-gray-400 max-w-4xl mx-auto leading-relaxed">
            My programs focus on helping individuals, teachers, trainers, and organizations gain clarity, confidence, and growth in both personal and professional life through practical, engaging, and result-driven approaches.
          </p>
        </div>
      </div>
    </section>
  )
}

export default WhatIDo;

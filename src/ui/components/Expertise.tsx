'use client';

import React from "react";

type ExpertiseSectionProps = Record<string, never>

const Expertise: React.FC<ExpertiseSectionProps> = () => {
  const expertiseAreas = [
    {
      icon: "🎤",
      title: "Trainer & Teacher",
      description: "12+ years of experience inspiring and guiding students, professionals, and organizations.",
      highlight: "12+ Years",
      color: "cyan"
    },
    {
      icon: "📱",
      title: "Social Media Influencer",
      description: "150K+ followers with millions of views across platforms, sharing insights on personal growth.",
      highlight: "150K+ Followers",
      color: "purple"
    },
    {
      icon: "🌱",
      title: "Life Coach",
      description: "Helping individuals gain clarity, confidence, and achieve personal and professional growth.",
      highlight: "Life Transformation",
      color: "pink"
    },
    {
      icon: "🏢",
      title: "Founder & CEO, Skillage",
      description: "Leading skill development and empowerment programs that transform lives online and offline.",
      highlight: "CEO & Founder",
      color: "green"
    },
    {
      icon: "🎓",
      title: "Trainer's Training & Teacher Training",
      description: "Equipping educators and trainers with the skills to inspire and lead effectively.",
      highlight: "Educator Training",
      color: "orange"
    },
    {
      icon: "🎤",
      title: "Motivational Speaking",
      description: "Delivering impactful sessions that inspire lakhs of people across stages and platforms.",
      highlight: "Lakhs Inspired",
      color: "indigo"
    }
  ]

  const getColorClasses = (color: string) => {
    const colorMap = {
      cyan: {
        gradient: "from-cyan-400 to-cyan-600",
        border: "border-cyan-400/30",
        shadow: "shadow-[0_0_20px_rgba(0,255,255,0.1)]",
        hoverShadow: "hover:shadow-[0_0_30px_rgba(0,255,255,0.2)]",
        bg: "bg-cyan-400/10",
        text: "text-cyan-400"
      },
      purple: {
        gradient: "from-purple-400 to-purple-600",
        border: "border-purple-400/30",
        shadow: "shadow-[0_0_20px_rgba(168,85,247,0.1)]",
        hoverShadow: "hover:shadow-[0_0_30px_rgba(168,85,247,0.2)]",
        bg: "bg-purple-400/10",
        text: "text-purple-400"
      },
      pink: {
        gradient: "from-pink-400 to-pink-600",
        border: "border-pink-400/30",
        shadow: "shadow-[0_0_20px_rgba(244,114,182,0.1)]",
        hoverShadow: "hover:shadow-[0_0_30px_rgba(244,114,182,0.2)]",
        bg: "bg-pink-400/10",
        text: "text-pink-400"
      },
      green: {
        gradient: "from-green-400 to-green-600",
        border: "border-green-400/30",
        shadow: "shadow-[0_0_20px_rgba(34,197,94,0.1)]",
        hoverShadow: "hover:shadow-[0_0_30px_rgba(34,197,94,0.2)]",
        bg: "bg-green-400/10",
        text: "text-green-400"
      },
      orange: {
        gradient: "from-orange-400 to-orange-600",
        border: "border-orange-400/30",
        shadow: "shadow-[0_0_20px_rgba(251,146,60,0.1)]",
        hoverShadow: "hover:shadow-[0_0_30px_rgba(251,146,60,0.2)]",
        bg: "bg-orange-400/10",
        text: "text-orange-400"
      },
      indigo: {
        gradient: "from-indigo-400 to-indigo-600",
        border: "border-indigo-400/30",
        shadow: "shadow-[0_0_20px_rgba(99,102,241,0.1)]",
        hoverShadow: "hover:shadow-[0_0_30px_rgba(99,102,241,0.2)]",
        bg: "bg-indigo-400/10",
        text: "text-indigo-400"
      }
    }
    return colorMap[color as keyof typeof colorMap]
  }

  return (
    <section className="py-20 px-6 relative">
      <div className="absolute inset-0 bg-gradient-to-b from-black via-gray-900/20 to-black"></div>
      
      {/* Dynamic background elements */}
      <div className="absolute top-20 left-1/4 w-32 h-32 bg-gradient-to-br from-cyan-500/10 to-purple-500/10 rounded-full blur-2xl animate-pulse"></div>
      <div className="absolute bottom-32 right-1/4 w-24 h-24 bg-gradient-to-br from-pink-500/10 to-orange-500/10 rounded-full blur-xl animate-pulse"></div>
      
      <div className="relative z-10 max-w-6xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-bold mb-8">
            <span className="bg-gradient-to-r from-cyan-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
              My Expertise
            </span>
          </h2>
          
          <p className="text-lg text-gray-300 max-w-3xl mx-auto leading-relaxed">
            Over 15 years of dedicated experience across multiple domains, helping individuals and organizations achieve their full potential through proven methodologies and passionate guidance.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          {expertiseAreas.map((area, index) => {
            const colors = getColorClasses(area.color)
            return (
              <div
                key={index}
                className={`group relative p-8 bg-gray-900/60 backdrop-blur-sm border ${colors.border} rounded-2xl hover:border-opacity-80 transition-all duration-500 hover:transform hover:scale-105 ${colors.shadow} ${colors.hoverShadow}`}
              >
                <div className={`absolute inset-0 ${colors.bg} rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300`}></div>
                
                <div className="relative z-10">
                  {/* Icon */}
                  <div className="text-5xl mb-6 group-hover:scale-110 transition-transform duration-300">
                    {area.icon}
                  </div>
                  
                  {/* Highlight badge */}
                  <div className={`inline-block px-4 py-2 bg-gradient-to-r ${colors.gradient} rounded-full text-white text-sm font-semibold mb-4 shadow-lg`}>
                    {area.highlight}
                  </div>
                  
                  {/* Title */}
                  <h3 className={`text-xl font-bold mb-4 ${colors.text} group-hover:text-white transition-colors duration-300`}>
                    {area.title}
                  </h3>
                  
                  {/* Description */}
                  <p className="text-gray-400 group-hover:text-gray-200 leading-relaxed transition-colors duration-300">
                    {area.description}
                  </p>
                </div>

                {/* Subtle glow effect on hover */}
                <div className={`absolute -inset-1 bg-gradient-to-r ${colors.gradient} rounded-2xl blur opacity-0 group-hover:opacity-25 transition-opacity duration-300`}></div>
              </div>
            )
          })}
        </div>

        {/* Stats section */}
        <div className="mt-16 grid grid-cols-2 md:grid-cols-4 gap-6">
          <div className="text-center p-6 bg-cyan-900/20 border border-cyan-400/30 rounded-xl shadow-[0_0_20px_rgba(0,255,255,0.05)]">
            <div className="text-3xl font-bold text-cyan-400 mb-2">15+</div>
            <div className="text-gray-400 text-sm">Years Experience</div>
          </div>
          
          <div className="text-center p-6 bg-purple-900/20 border border-purple-400/30 rounded-xl shadow-[0_0_20px_rgba(168,85,247,0.05)]">
            <div className="text-3xl font-bold text-purple-400 mb-2">150K+</div>
            <div className="text-gray-400 text-sm">Social Followers</div>
          </div>
          
          <div className="text-center p-6 bg-pink-900/20 border border-pink-400/30 rounded-xl shadow-[0_0_20px_rgba(244,114,182,0.05)]">
            <div className="text-3xl font-bold text-pink-400 mb-2">Lakhs</div>
            <div className="text-gray-400 text-sm">Lives Impacted</div>
          </div>
          
          <div className="text-center p-6 bg-green-900/20 border border-green-400/30 rounded-xl shadow-[0_0_20px_rgba(34,197,94,0.05)]">
            <div className="text-3xl font-bold text-green-400 mb-2">1</div>
            <div className="text-gray-400 text-sm">Million Goal</div>
          </div>
        </div>
      </div>
    </section>
  )
}

export default Expertise;

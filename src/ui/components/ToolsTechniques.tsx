'use client';

import React from "react";

type ToolsTechniquesSectionProps = Record<string, never>

const ToolsTechniques: React.FC<ToolsTechniquesSectionProps> = () => {
  const techniques = [
    {
      icon: "🌀",
      title: "Mentalism & Hypnosis",
      description: "Understanding human behavior, creating focus, and unlocking hidden potential.",
      color: "cyan"
    },
    {
      icon: "🧠",
      title: "Neuro-Linguistic Programming (NLP)",
      description: "Rewiring thoughts, language, and behavior patterns for personal and professional growth.",
      color: "purple"
    },
    {
      icon: "🎭",
      title: "Transactional Analysis (TA)",
      description: "Exploring communication styles (Parent, Adult, Child) to improve relationships and leadership.",
      color: "pink"
    },
    {
      icon: "🌍",
      title: "Theme-Centered Interaction (TCI)",
      description: "Creating balanced group dynamics where every participant feels included and active.",
      color: "green"
    },
    {
      icon: "✋",
      title: "Emotional Freedom Techniques (EFT)",
      description: "Simple mind-body tapping tool to release stress, fear, and emotional blocks.",
      color: "orange"
    },
    {
      icon: "🎲",
      title: "Icebreaking & Gamification",
      description: "Making learning fun, interactive, and memorable through games and creative activities.",
      color: "indigo"
    }
  ]

  const getColorClasses = (color: string) => {
    const colorMap = {
      cyan: {
        border: "border-cyan-400/30",
        text: "text-cyan-400",
        shadow: "shadow-[0_0_20px_rgba(0,255,255,0.1)]",
        hoverShadow: "hover:shadow-[0_0_30px_rgba(0,255,255,0.2)]",
        gradient: "from-cyan-400/10 to-cyan-600/10"
      },
      purple: {
        border: "border-purple-400/30",
        text: "text-purple-400",
        shadow: "shadow-[0_0_20px_rgba(168,85,247,0.1)]",
        hoverShadow: "hover:shadow-[0_0_30px_rgba(168,85,247,0.2)]",
        gradient: "from-purple-400/10 to-purple-600/10"
      },
      pink: {
        border: "border-pink-400/30",
        text: "text-pink-400",
        shadow: "shadow-[0_0_20px_rgba(244,114,182,0.1)]",
        hoverShadow: "hover:shadow-[0_0_30px_rgba(244,114,182,0.2)]",
        gradient: "from-pink-400/10 to-pink-600/10"
      },
      green: {
        border: "border-green-400/30",
        text: "text-green-400",
        shadow: "shadow-[0_0_20px_rgba(34,197,94,0.1)]",
        hoverShadow: "hover:shadow-[0_0_30px_rgba(34,197,94,0.2)]",
        gradient: "from-green-400/10 to-green-600/10"
      },
      orange: {
        border: "border-orange-400/30",
        text: "text-orange-400",
        shadow: "shadow-[0_0_20px_rgba(251,146,60,0.1)]",
        hoverShadow: "hover:shadow-[0_0_30px_rgba(251,146,60,0.2)]",
        gradient: "from-orange-400/10 to-orange-600/10"
      },
      indigo: {
        border: "border-indigo-400/30",
        text: "text-indigo-400",
        shadow: "shadow-[0_0_20px_rgba(99,102,241,0.1)]",
        hoverShadow: "hover:shadow-[0_0_30px_rgba(99,102,241,0.2)]",
        gradient: "from-indigo-400/10 to-indigo-600/10"
      }
    }
    return colorMap[color as keyof typeof colorMap]
  }

  return (
    <section className="py-20 px-6 relative">
      <div className="absolute inset-0 bg-gradient-to-b from-gray-900/30 via-black to-gray-900/30"></div>
      
      {/* Animated background elements */}
      <div className="absolute top-1/4 left-10 w-32 h-32 bg-gradient-to-r from-cyan-500/10 to-purple-500/10 rounded-full blur-xl animate-pulse"></div>
      <div className="absolute bottom-1/4 right-10 w-24 h-24 bg-gradient-to-r from-pink-500/10 to-orange-500/10 rounded-full blur-xl animate-pulse"></div>
      
      <div className="relative z-10 max-w-6xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-bold mb-6">
            <span className="bg-gradient-to-r from-cyan-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
              🛠️ My Tools & Techniques
            </span>
          </h2>
          
          <p className="text-lg md:text-xl text-gray-300 max-w-4xl mx-auto leading-relaxed">
            I combine <span className="text-cyan-400 font-semibold">science</span>, <span className="text-purple-400 font-semibold">psychology</span>, and <span className="text-pink-400 font-semibold">interactive methods</span> to make trainings engaging, practical, and result-oriented:
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {techniques.map((technique, index) => {
            const colors = getColorClasses(technique.color)
            return (
              <div
                key={index}
                className={`group relative p-6 bg-gray-900/40 backdrop-blur-sm border ${colors.border} rounded-xl hover:border-opacity-60 transition-all duration-500 hover:transform hover:scale-105 ${colors.shadow} ${colors.hoverShadow}`}
              >
                <div className={`absolute inset-0 bg-gradient-to-br ${colors.gradient} rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300`}></div>
                
                <div className="relative z-10">
                  <div className="text-4xl mb-4 group-hover:scale-110 transition-transform duration-300">
                    {technique.icon}
                  </div>
                  
                  <h3 className={`text-xl font-bold mb-3 ${colors.text} group-hover:text-white transition-colors duration-300`}>
                    {technique.title}
                  </h3>
                  
                  <p className="text-gray-400 group-hover:text-gray-200 leading-relaxed transition-colors duration-300">
                    {technique.description}
                  </p>
                </div>

                {/* Glow effect on hover */}
                <div className={`absolute -inset-1 bg-gradient-to-r ${colors.gradient} rounded-xl blur opacity-0 group-hover:opacity-30 transition-opacity duration-300`}></div>
              </div>
            )
          })}
        </div>

        <div className="mt-16 text-center">
          <div className="inline-block p-6 bg-gradient-to-r from-gray-900/80 to-gray-800/80 backdrop-blur-sm border border-gray-700/50 rounded-2xl shadow-[0_0_30px_rgba(0,0,0,0.5)]">
            <p className="text-gray-300 text-lg leading-relaxed max-w-3xl">
              These evidence-based approaches create powerful learning experiences that stick, helping participants not just understand concepts but truly embody and apply them in their daily lives.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

export default ToolsTechniques;

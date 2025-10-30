'use client';

import React from "react";

type CoreValuesSectionProps = Record<string, never>

const CoreValues: React.FC<CoreValuesSectionProps> = () => {
  const values = [
    {
      number: "1",
      title: "Faith in People & God",
      description: "We believe every person has potential, and with divine guidance, they can achieve more than they imagine.",
      icon: "🙏",
      color: "cyan"
    },
    {
      number: "2",
      title: "Learning by Doing",
      description: "True growth comes from experience, practice, and applying knowledge in real life.",
      icon: "🎯",
      color: "purple"
    },
    {
      number: "3",
      title: "Clarity of Mind",
      description: "A clear mind brings peace, focus, and the power to make better decisions.",
      icon: "🧘",
      color: "pink"
    },
    {
      number: "4",
      title: "Courage to Speak",
      description: "Confidence to express ideas and lead with words is the key to transformation.",
      icon: "💬",
      color: "green"
    },
    {
      number: "5",
      title: "Growth Together",
      description: "We rise higher when we support and grow alongside each other.",
      icon: "🤝",
      color: "orange"
    },
    {
      number: "6",
      title: "Truth & Simplicity",
      description: "Being honest, authentic, and simple keeps life and work meaningful.",
      icon: "💎",
      color: "indigo"
    },
    {
      number: "7",
      title: "Spiritual Balance",
      description: "Inner strength and calmness create balance in personal and professional life.",
      icon: "⚖️",
      color: "violet"
    }
  ]

  const getColorClasses = (color: string) => {
    const colorMap = {
      cyan: {
        gradient: "from-cyan-400 to-cyan-600",
        border: "border-cyan-400/30",
        shadow: "shadow-[0_0_20px_rgba(0,255,255,0.1)]",
        hoverShadow: "hover:shadow-[0_0_30px_rgba(0,255,255,0.2)]",
        bg: "bg-cyan-400/10"
      },
      purple: {
        gradient: "from-purple-400 to-purple-600",
        border: "border-purple-400/30",
        shadow: "shadow-[0_0_20px_rgba(168,85,247,0.1)]",
        hoverShadow: "hover:shadow-[0_0_30px_rgba(168,85,247,0.2)]",
        bg: "bg-purple-400/10"
      },
      pink: {
        gradient: "from-pink-400 to-pink-600",
        border: "border-pink-400/30",
        shadow: "shadow-[0_0_20px_rgba(244,114,182,0.1)]",
        hoverShadow: "hover:shadow-[0_0_30px_rgba(244,114,182,0.2)]",
        bg: "bg-pink-400/10"
      },
      green: {
        gradient: "from-green-400 to-green-600",
        border: "border-green-400/30",
        shadow: "shadow-[0_0_20px_rgba(34,197,94,0.1)]",
        hoverShadow: "hover:shadow-[0_0_30px_rgba(34,197,94,0.2)]",
        bg: "bg-green-400/10"
      },
      orange: {
        gradient: "from-orange-400 to-orange-600",
        border: "border-orange-400/30",
        shadow: "shadow-[0_0_20px_rgba(251,146,60,0.1)]",
        hoverShadow: "hover:shadow-[0_0_30px_rgba(251,146,60,0.2)]",
        bg: "bg-orange-400/10"
      },
      indigo: {
        gradient: "from-indigo-400 to-indigo-600",
        border: "border-indigo-400/30",
        shadow: "shadow-[0_0_20px_rgba(99,102,241,0.1)]",
        hoverShadow: "hover:shadow-[0_0_30px_rgba(99,102,241,0.2)]",
        bg: "bg-indigo-400/10"
      },
      violet: {
        gradient: "from-violet-400 to-violet-600",
        border: "border-violet-400/30",
        shadow: "shadow-[0_0_20px_rgba(139,92,246,0.1)]",
        hoverShadow: "hover:shadow-[0_0_30px_rgba(139,92,246,0.2)]",
        bg: "bg-violet-400/10"
      }
    }
    return colorMap[color as keyof typeof colorMap]
  }

  return (
    <section className="py-20 px-6 relative">
      <div className="absolute inset-0 bg-gradient-to-b from-gray-900/30 via-black to-gray-900/30"></div>
      
      {/* Floating geometric shapes */}
      <div className="absolute top-32 left-20 w-6 h-6 border-2 border-cyan-400/30 rotate-45 animate-spin-slow"></div>
      <div className="absolute bottom-40 right-32 w-4 h-4 border-2 border-purple-400/30 rounded-full animate-pulse"></div>
      <div className="absolute top-1/2 right-20 w-5 h-5 border-2 border-pink-400/30 transform rotate-45 animate-bounce"></div>
      
      <div className="relative z-10 max-w-6xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-bold mb-8">
            <span className="bg-gradient-to-r from-cyan-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
              Core Values
            </span>
          </h2>
          
          <p className="text-lg text-gray-300 max-w-3xl mx-auto leading-relaxed mb-8">
            These principles guide every aspect of my work and personal journey, creating a foundation for meaningful transformation and authentic growth.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
          {values.map((value, index) => {
            const colors = getColorClasses(value.color)
            return (
              <div
                key={index}
                className={`group relative p-6 bg-gray-900/50 backdrop-blur-sm border ${colors.border} rounded-xl hover:border-opacity-60 transition-all duration-500 hover:transform hover:scale-105 ${colors.shadow} ${colors.hoverShadow}`}
              >
                <div className={`absolute inset-0 ${colors.bg} rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300`}></div>
                
                <div className="relative z-10">
                  {/* Number badge */}
                  <div className={`inline-flex items-center justify-center w-10 h-10 bg-gradient-to-r ${colors.gradient} rounded-full text-white font-bold mb-4 shadow-lg`}>
                    {value.number}
                  </div>
                  
                  {/* Icon */}
                  <div className="text-3xl mb-4 group-hover:scale-110 transition-transform duration-300">
                    {value.icon}
                  </div>
                  
                  {/* Title */}
                  <h3 className={`text-lg font-bold mb-3 bg-gradient-to-r ${colors.gradient} bg-clip-text text-transparent group-hover:text-white transition-all duration-300`}>
                    {value.title}
                  </h3>
                  
                  {/* Description */}
                  <p className="text-gray-400 group-hover:text-gray-200 leading-relaxed transition-colors duration-300">
                    {value.description}
                  </p>
                </div>

                {/* Subtle glow effect */}
                <div className={`absolute -inset-1 bg-gradient-to-r ${colors.gradient} rounded-xl blur opacity-0 group-hover:opacity-20 transition-opacity duration-300`}></div>
              </div>
            )
          })}
        </div>

        {/* Personal commitment */}
        <div className="text-center">
          <div className="inline-block p-8 bg-gradient-to-r from-gray-900/90 to-gray-800/90 backdrop-blur-sm border border-gray-600/40 rounded-2xl shadow-[0_0_40px_rgba(0,0,0,0.5)] max-w-4xl">
            <div className="text-2xl mb-4">✨</div>
            <p className="text-lg text-gray-200 leading-relaxed italic mb-4">
              &quot;I strive to live by these values in my own journey, and I work with those who genuinely wish to practice them in their lives.&quot;
            </p>
            <div className="w-16 h-0.5 bg-gradient-to-r from-cyan-400 to-purple-400 mx-auto"></div>
          </div>
        </div>
      </div>
    </section>
  )
}

export default CoreValues;

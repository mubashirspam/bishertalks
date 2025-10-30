'use client';

import React from "react";

type AboutSectionProps = Record<string, never>

const About: React.FC<AboutSectionProps> = () => {
  return (
    <section className="py-20 px-6 relative">
      <div className="absolute inset-0 bg-gradient-to-b from-black via-purple-900/10 to-black"></div>
      
      {/* Floating neon elements */}
      <div className="absolute top-20 left-1/4 w-3 h-3 bg-purple-400 rounded-full animate-bounce shadow-[0_0_20px_#a855f7]"></div>
      <div className="absolute bottom-32 right-1/3 w-2 h-2 bg-cyan-400 rounded-full animate-ping shadow-[0_0_15px_#00ffff]"></div>
      
      <div className="relative z-10 max-w-4xl mx-auto">
        <div className="text-center mb-12">
          <h2 className="text-4xl md:text-5xl font-bold mb-6">
            <span className="bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent">
              About Me
            </span>
          </h2>
        </div>

        <div className="space-y-8">
          {/* Main intro */}
          <div className="p-8 bg-gradient-to-br from-gray-900/80 to-gray-800/60 backdrop-blur-sm border border-purple-400/30 rounded-2xl shadow-[0_0_30px_rgba(168,85,247,0.1)]">
            <p className="text-lg text-gray-300 leading-relaxed">
              I&apos;m <span className="text-purple-400 font-bold">Bisher KC</span>, Founder & CEO of <span className="text-cyan-400 font-bold">Skillage</span>, with over <span className="text-pink-400 font-bold">15 years of experience</span> as a teacher, trainer, and life coach.
            </p>
          </div>

          {/* SIGN Journey */}
          <div className="group p-8 bg-gradient-to-br from-cyan-900/20 to-blue-900/20 backdrop-blur-sm border border-cyan-400/30 rounded-2xl hover:border-cyan-400/50 transition-all duration-300 shadow-[0_0_20px_rgba(0,255,255,0.05)] hover:shadow-[0_0_30px_rgba(0,255,255,0.1)]">
            <div className="flex items-start space-x-4">
              <div className="flex-shrink-0 w-12 h-12 bg-gradient-to-br from-cyan-400 to-blue-500 rounded-full flex items-center justify-center text-white font-bold text-xl shadow-[0_0_20px_rgba(0,255,255,0.3)]">
                S
              </div>
              <div>
                <h3 className="text-xl font-bold text-cyan-400 mb-3">SIGN - Where It All Began</h3>
                <p className="text-gray-300 leading-relaxed">
                  My journey began with <span className="text-cyan-400 font-semibold">SIGN, a leading NGO in Wayanad</span>, where I started as a trainer and now serve as an <span className="text-white font-semibold">Executive Member & Trainer</span>. SIGN transformed my life, helped me grow, and gave me the opportunity to contribute back through training and leadership.
                </p>
              </div>
            </div>
          </div>

          {/* Government Teaching */}
          <div className="group p-8 bg-gradient-to-br from-green-900/20 to-teal-900/20 backdrop-blur-sm border border-green-400/30 rounded-2xl hover:border-green-400/50 transition-all duration-300 shadow-[0_0_20px_rgba(34,197,94,0.05)] hover:shadow-[0_0_30px_rgba(34,197,94,0.1)]">
            <div className="flex items-start space-x-4">
              <div className="flex-shrink-0 w-12 h-12 bg-gradient-to-br from-green-400 to-teal-500 rounded-full flex items-center justify-center text-white font-bold text-xl shadow-[0_0_20px_rgba(34,197,94,0.3)]">
                🎓
              </div>
              <div>
                <h3 className="text-xl font-bold text-green-400 mb-3">Government Teaching Experience</h3>
                <p className="text-gray-300 leading-relaxed">
                  I worked as a <span className="text-green-400 font-semibold">Higher Secondary Teacher in Government sector</span>, which strengthened my foundation in teaching and mentoring. This experience deepened my understanding of education and helped me develop effective teaching methodologies.
                </p>
              </div>
            </div>
          </div>

          {/* Speaking Journey */}
          <div className="group p-8 bg-gradient-to-br from-pink-900/20 to-red-900/20 backdrop-blur-sm border border-pink-400/30 rounded-2xl hover:border-pink-400/50 transition-all duration-300 shadow-[0_0_20px_rgba(244,114,182,0.05)] hover:shadow-[0_0_30px_rgba(244,114,182,0.1)]">
            <div className="flex items-start space-x-4">
              <div className="flex-shrink-0 w-12 h-12 bg-gradient-to-br from-pink-400 to-red-500 rounded-full flex items-center justify-center text-white font-bold text-xl shadow-[0_0_20px_rgba(244,114,182,0.3)]">
                🎤
              </div>
              <div>
                <h3 className="text-xl font-bold text-pink-400 mb-3">Motivational Speaking</h3>
                <p className="text-gray-300 leading-relaxed">
                  Over time, I became a <span className="text-pink-400 font-semibold">motivational speaker</span>, inspiring <span className="text-white font-semibold">lakhs of people</span> through different stages and platforms. From conducting sessions on invitation, I have now built my own platforms to design and deliver transformative programs.
                </p>
              </div>
            </div>
          </div>

          {/* Current Focus */}
          <div className="p-8 bg-gradient-to-br from-purple-900/30 to-indigo-900/30 backdrop-blur-sm border border-purple-400/40 rounded-2xl shadow-[0_0_30px_rgba(168,85,247,0.1)]">
            <h3 className="text-xl font-bold text-purple-400 mb-4">Current Specializations</h3>
            <div className="grid md:grid-cols-2 gap-4">
              <div className="flex items-center space-x-3">
                <span className="w-2 h-2 bg-cyan-400 rounded-full shadow-[0_0_10px_#00ffff]"></span>
                <span className="text-gray-300">Trainer&apos;s Training</span>
              </div>
              <div className="flex items-center space-x-3">
                <span className="w-2 h-2 bg-purple-400 rounded-full shadow-[0_0_10px_#a855f7]"></span>
                <span className="text-gray-300">Life Coaching</span>
              </div>
              <div className="flex items-center space-x-3">
                <span className="w-2 h-2 bg-pink-400 rounded-full shadow-[0_0_10px_#f472b6]"></span>
                <span className="text-gray-300">Public Speaking</span>
              </div>
              <div className="flex items-center space-x-3">
                <span className="w-2 h-2 bg-green-400 rounded-full shadow-[0_0_10px_#34d399]"></span>
                <span className="text-gray-300">Corporate Programs</span>
              </div>
              <div className="flex items-center space-x-3">
                <span className="w-2 h-2 bg-orange-400 rounded-full shadow-[0_0_10px_#fb923c]"></span>
                <span className="text-gray-300">Spiritual Growth</span>
              </div>
              <div className="flex items-center space-x-3">
                <span className="w-2 h-2 bg-indigo-400 rounded-full shadow-[0_0_10px_#6366f1]"></span>
                <span className="text-gray-300">Mind Power Training</span>
              </div>
            </div>
          </div>

          {/* Camps & Workshops */}
          <div className="text-center p-8 bg-gradient-to-r from-gray-900/80 to-gray-800/80 backdrop-blur-sm border border-gray-600/30 rounded-2xl shadow-[0_0_30px_rgba(0,0,0,0.3)]">
            <p className="text-lg text-gray-300 leading-relaxed">
              Many of my programs take the form of <span className="text-cyan-400 font-semibold">camps and workshops</span>—ranging from <span className="text-purple-400 font-semibold">one-day intensives</span> to <span className="text-pink-400 font-semibold">multi-day experiences</span>—where participants step away from routine, learn deeply, and return with clarity, confidence, and focus.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

export default About;

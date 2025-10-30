'use client';

import React from "react";

type VisionMissionSectionProps = Record<string, never>

const VisionMission: React.FC<VisionMissionSectionProps> = () => {
  return (
    <section className="py-20 px-6 relative">
      <div className="absolute inset-0 bg-gradient-to-b from-black via-cyan-900/10 to-black"></div>
      
      {/* Animated background patterns */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_25%,rgba(0,255,255,0.1)_0%,transparent_50%),radial-gradient(circle_at_75%_75%,rgba(168,85,247,0.1)_0%,transparent_50%)]"></div>
      
      <div className="relative z-10 max-w-6xl mx-auto">
        <div className="grid lg:grid-cols-2 gap-12">
          {/* Vision */}
          <div className="group relative">
            <div className="absolute -inset-1 bg-gradient-to-r from-cyan-400 to-blue-500 rounded-2xl blur opacity-20 group-hover:opacity-40 transition-opacity duration-300"></div>
            
            <div className="relative p-8 bg-gradient-to-br from-gray-900/90 to-gray-800/90 backdrop-blur-sm border border-cyan-400/30 rounded-2xl shadow-[0_0_30px_rgba(0,255,255,0.1)]">
              <div className="flex items-center mb-6">
                <div className="w-16 h-16 bg-gradient-to-br from-cyan-400 to-blue-500 rounded-full flex items-center justify-center text-2xl shadow-[0_0_30px_rgba(0,255,255,0.3)]">
                  🌟
                </div>
                <h2 className="text-3xl font-bold ml-4 bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
                  Vision
                </h2>
              </div>
              
              <p className="text-xl text-gray-200 leading-relaxed">
                To empower <span className="text-cyan-400 font-bold">one million people</span> to grow with <span className="text-white font-semibold">clarity</span>, <span className="text-white font-semibold">confidence</span>, and <span className="text-white font-semibold">purpose</span>.
              </p>
              
              {/* Glowing counter effect */}
              <div className="mt-6 p-4 bg-cyan-400/10 border border-cyan-400/20 rounded-lg">
                <div className="text-center">
                  <div className="text-2xl font-bold text-cyan-400 mb-1">1,000,000+</div>
                  <div className="text-sm text-gray-400">Lives to Transform</div>
                </div>
              </div>
            </div>
          </div>

          {/* Mission */}
          <div className="group relative">
            <div className="absolute -inset-1 bg-gradient-to-r from-purple-400 to-pink-500 rounded-2xl blur opacity-20 group-hover:opacity-40 transition-opacity duration-300"></div>
            
            <div className="relative p-8 bg-gradient-to-br from-gray-900/90 to-gray-800/90 backdrop-blur-sm border border-purple-400/30 rounded-2xl shadow-[0_0_30px_rgba(168,85,247,0.1)]">
              <div className="flex items-center mb-6">
                <div className="w-16 h-16 bg-gradient-to-br from-purple-400 to-pink-500 rounded-full flex items-center justify-center text-2xl shadow-[0_0_30px_rgba(168,85,247,0.3)]">
                  🎯
                </div>
                <h2 className="text-3xl font-bold ml-4 bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
                  Mission
                </h2>
              </div>
              
              <p className="text-xl text-gray-200 leading-relaxed">
                Spreading simple, powerful tools—through <span className="text-purple-400 font-semibold">coaching</span>, <span className="text-pink-400 font-semibold">training</span>, and <span className="text-cyan-400 font-semibold">immersive camps</span>—that help people reset their mindset, discover clarity, and build confidence for lasting change.
              </p>
              
              {/* Mission highlights */}
              <div className="mt-6 space-y-3">
                <div className="flex items-center space-x-3 p-3 bg-purple-400/10 border border-purple-400/20 rounded-lg">
                  <span className="w-2 h-2 bg-purple-400 rounded-full shadow-[0_0_10px_#a855f7]"></span>
                  <span className="text-gray-300">Reset Mindset</span>
                </div>
                <div className="flex items-center space-x-3 p-3 bg-pink-400/10 border border-pink-400/20 rounded-lg">
                  <span className="w-2 h-2 bg-pink-400 rounded-full shadow-[0_0_10px_#f472b6]"></span>
                  <span className="text-gray-300">Discover Clarity</span>
                </div>
                <div className="flex items-center space-x-3 p-3 bg-cyan-400/10 border border-cyan-400/20 rounded-lg">
                  <span className="w-2 h-2 bg-cyan-400 rounded-full shadow-[0_0_10px_#00ffff]"></span>
                  <span className="text-gray-300">Build Confidence</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom inspirational quote */}
        <div className="mt-16 text-center">
          <div className="inline-block p-8 bg-gradient-to-r from-gray-900/80 via-purple-900/20 to-gray-900/80 backdrop-blur-sm border border-gradient-to-r border-gray-600/30 rounded-2xl shadow-[0_0_40px_rgba(0,0,0,0.5)]">
            <p className="text-lg text-gray-300 leading-relaxed max-w-3xl italic">
              &quot;Every person has the potential to create extraordinary change in their life and the lives of others. My mission is to provide the tools, guidance, and community to make that transformation possible.&quot;
            </p>
            <div className="mt-4 text-right">
              <span className="text-cyan-400 font-semibold">- Bisher KC</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

export default VisionMission;

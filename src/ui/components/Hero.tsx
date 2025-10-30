'use client';

import React from "react";

type HeroSectionProps = Record<string, never>

const Hero: React.FC<HeroSectionProps> = () => {
    return (
      <section className="min-h-screen flex items-center justify-center relative overflow-hidden">
        {/* Animated background */}
        <div className="absolute inset-0 bg-gradient-to-br from-purple-900/20 via-black to-cyan-900/20"></div>
        
        {/* Neon grid overlay */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(0,255,255,0.1)_1px,transparent_1px),linear-gradient(90deg,rgba(0,255,255,0.1)_1px,transparent_1px)] bg-[size:50px_50px]"></div>
        
        {/* Floating neon particles */}
        <div className="absolute top-20 left-20 w-2 h-2 bg-cyan-400 rounded-full animate-pulse shadow-[0_0_20px_#00ffff]"></div>
        <div className="absolute top-40 right-32 w-1 h-1 bg-purple-400 rounded-full animate-pulse shadow-[0_0_15px_#a855f7]"></div>
        <div className="absolute bottom-32 left-1/4 w-1.5 h-1.5 bg-pink-400 rounded-full animate-pulse shadow-[0_0_18px_#f472b6]"></div>
        
        <div className="relative z-10 text-center max-w-4xl mx-auto px-6">
          <h1 className="text-5xl md:text-7xl font-bold mb-6">
            <span className="bg-gradient-to-r from-cyan-400 via-purple-400 to-pink-400 bg-clip-text text-transparent animate-pulse">
              Bisher KC
            </span>
          </h1>
          
          <div className="text-xl md:text-2xl text-gray-300 mb-4">
            <p className="border border-cyan-400/30 rounded-lg px-6 py-3 backdrop-blur-sm bg-cyan-400/5 shadow-[0_0_30px_rgba(0,255,255,0.1)]">
              @bisher_talks
            </p>
          </div>
          
          <p className="text-lg text-gray-400 mb-4">
            International Trainer • Life Coach • Entrepreneur
          </p>
          
          <p className="text-base md:text-lg text-gray-400 mb-8 max-w-2xl mx-auto leading-relaxed">
            Focusing on <span className="text-cyan-400 font-semibold">Overcoming Public Speaking Fear</span>,{' '}
            <span className="text-purple-400 font-semibold">Personality Development</span>,{' '}
            <span className="text-pink-400 font-semibold">Career Growth</span> & Life Transformation
          </p>
          
          {/* Social Proof */}
          <div className="flex flex-wrap justify-center gap-4 mb-12">
            <div className="px-4 py-2 bg-gradient-to-r from-pink-900/30 to-pink-800/30 border border-pink-400/30 rounded-lg backdrop-blur-sm">
              <span className="text-pink-400 font-bold">83K+</span>
              <span className="text-gray-400 text-sm ml-2">Instagram</span>
            </div>
            <div className="px-4 py-2 bg-gradient-to-r from-red-900/30 to-red-800/30 border border-red-400/30 rounded-lg backdrop-blur-sm">
              <span className="text-red-400 font-bold">61K+</span>
              <span className="text-gray-400 text-sm ml-2">YouTube</span>
            </div>
            <div className="px-4 py-2 bg-gradient-to-r from-cyan-900/30 to-cyan-800/30 border border-cyan-400/30 rounded-lg backdrop-blur-sm">
              <span className="text-cyan-400 font-bold">CEO</span>
              <span className="text-gray-400 text-sm ml-2">Skillage Academy</span>
            </div>
          </div>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <button className="px-8 py-4 bg-gradient-to-r from-cyan-500 to-purple-600 text-white font-semibold rounded-lg hover:from-cyan-400 hover:to-purple-500 transform hover:scale-105 transition-all duration-300 shadow-[0_0_30px_rgba(0,255,255,0.3)] hover:shadow-[0_0_40px_rgba(0,255,255,0.5)]">
              Start Your Journey
            </button>
            <button className="px-8 py-4 border-2 border-cyan-400 text-cyan-400 font-semibold rounded-lg hover:bg-cyan-400 hover:text-black transition-all duration-300 shadow-[0_0_20px_rgba(0,255,255,0.2)] hover:shadow-[0_0_30px_rgba(0,255,255,0.4)]">
              Explore Programs
            </button>
          </div>
          
          {/* Quick Journey Note */}
          <div className="mt-16 p-6 border border-purple-400/30 rounded-xl backdrop-blur-sm bg-purple-900/10 shadow-[0_0_30px_rgba(168,85,247,0.1)]">
            <h3 className="text-purple-400 font-semibold mb-3">Quick Note About My Journey</h3>
            <p className="text-gray-300 leading-relaxed">
              &quot;I began as a teacher and trainer, grew into a corporate speaker, and today lead Skillage as CEO—reaching millions worldwide through live sessions, workshops, and the Skillage app.&quot;
            </p>
          </div>
        </div>
      </section>
    )
  }

export default Hero;
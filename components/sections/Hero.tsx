import React from "react";
import Image from "next/image";
import { Sparkles, BookOpen, Briefcase, Building2 } from "lucide-react";
import HeroScene from "@/components/HeroScene";

const rightChips = [
  { icon: Sparkles, label: "Life Coach" },
  { icon: BookOpen, label: "Author (Neuro Code)" },
  { icon: Briefcase, label: "Corporate Trainer" },
  { icon: Building2, label: "CEO of Skillage" },
];

export default function Hero() {
  return (
    <section
      id="home"
      className="relative min-h-screen overflow-hidden flex flex-col"
    >
      {/* Gradient Background */}
      <HeroScene />

      {/* Main Content */}
      <div className="relative z-10 flex-1 flex flex-col justify-between px-6 md:px-12 lg:px-20 pt-28 pb-0">
        {/* Top Row: Left text + Center image + Right chips */}
        <div className="flex-1 flex flex-col lg:flex-row items-center lg:items-end justify-center relative">
          {/* Left Side — Name & Intro */}
          <div className="lg:absolute lg:left-0 lg:top-1/3 lg:-translate-y-1/2 text-center lg:text-left mb-8 lg:mb-0 z-20">
            <p className="text-primary-400 text-sm md:text-base font-medium tracking-wider uppercase mb-3">
              Hey there, I&apos;m
            </p>
            <h1 className="text-5xl md:text-6xl lg:text-7xl xl:text-8xl font-bold text-white leading-[0.95] tracking-tight">
              Bisher
              <br />
              Khalil
            </h1>
          </div>

          {/* Center — Hero Image */}
          <div className="relative z-10 flex-shrink-0 mx-auto mt-auto">
            <div className="relative w-[280px] h-[360px] sm:w-[340px] sm:h-[440px] md:w-[400px] md:h-[520px] lg:w-[460px] lg:h-[580px] xl:w-[500px] xl:h-[640px]">
              {/* Blue glow behind image */}
              <div
                className="absolute inset-0 -inset-x-8 -bottom-4 rounded-full blur-3xl opacity-30"
                style={{
                  background:
                    "radial-gradient(ellipse at 50% 70%, #00d4ff 0%, transparent 70%)",
                }}
              />
              <Image
                src="/images/hero.png"
                alt="Bisher Khalil"
                fill
                className="object-contain object-bottom drop-shadow-2xl"
                priority
              />
            </div>
          </div>

          {/* Right Side — Role Chips */}
          <div className="lg:absolute lg:right-0 lg:top-1/3 lg:-translate-y-1/2 flex flex-row flex-wrap lg:flex-col gap-3 justify-center lg:justify-start mt-6 lg:mt-0 z-20">
            {rightChips.map((chip, index) => {
              const Icon = chip.icon;
              return (
                <div
                  key={index}
                  className="flex items-center gap-2 bg-white/10 backdrop-blur-sm border border-white/20 rounded-full px-4 py-2.5 text-white/90"
                >
                  <Icon className="w-4 h-4 text-primary-400" />
                  <span className="text-sm font-medium whitespace-nowrap">
                    {chip.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Bottom — Big Typography */}
        <div className="relative z-20 w-full text-center pb-6 md:pb-10 -mt-8 md:-mt-12 lg:-mt-16">
          <h2 className="text-5xl sm:text-6xl md:text-7xl lg:text-8xl xl:text-9xl font-black text-white uppercase leading-none tracking-tighter">
            Life <span className="text-primary-400">Coach</span>
          </h2>
        </div>
      </div>
    </section>
  );
}

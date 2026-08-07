import Image from "next/image";
import type { ElementType } from "react";
import { Sparkles, BookOpen, Briefcase, Building2 } from "lucide-react";
import HeroScene from "@/components/HeroScene";

const chips = [
  { icon: Sparkles, label: "Life Coach", short: "Life Coach" },
   { icon: Building2, label: "CEO of Skillage", short: "CEO" },
  { icon: BookOpen, label: "Author (Neuro Code)", short: "Author" },
  { icon: Briefcase, label: "Corporate Trainer", short: "Trainer" },
 
];

function MobileChip({ icon: Icon, label }: { icon: ElementType; label: string }) {
  return (
    <div className="flex items-center gap-1.5 bg-white/10 backdrop-blur-sm border border-white/20 rounded-full px-2.5 py-1.5 text-white/90">
      <Icon className="w-3 h-3 text-primary-400 flex-shrink-0" />
      <span className="text-[10px] font-medium whitespace-nowrap">{label}</span>
    </div>
  );
}

export default function Hero() {
  return (
    <section
      id="home"
      className="relative min-h-screen overflow-hidden flex flex-col"
    >
      <HeroScene />

      {/* ── MOBILE layout ── */}
      <div className="lg:hidden relative z-10 flex flex-col flex-1 px-4 pt-24">
        {/* Name — top */}
        <div className="text-center mb-4">
          <p className="text-primary-400 text-base font-medium tracking-wider uppercase mb-1">
            Hey there, I&apos;m
          </p>
          {/* Google indexes mobile-first, so the mobile heading is the real h1;
              the desktop copy below is presentation only. sr-only tail gives the
              h1 the entity terms the visible chips already show sighted users. */}
          <h1 className="text-6xl font-bold text-white leading-tight tracking-tight">
            Bisher KC
            <span className="sr-only"> — Life Coach &amp; Author of Neuro Code</span>
          </h1>
        </div>

        {/* Chips below heading - two lines, two per line */}
        <div className="flex flex-col items-center gap-2 mb-6">
          <div className="flex gap-2">
            {chips.slice(0, 2).map((chip, index) => (
              <MobileChip key={index} icon={chip.icon} label={chip.short} />
            ))}
          </div>
          <div className="flex gap-2">
            {chips.slice(2, 4).map((chip, index) => (
              <MobileChip key={index + 2} icon={chip.icon} label={chip.short} />
            ))}
          </div>
        </div>

        {/* Image — fills remaining space, anchored to bottom */}
        <div className="relative flex-1 flex items-end justify-center">
          {/* Large image */}
          <div className="relative w-full h-[55vh]">
            {/* Orange glow */}
            <div
              className="absolute inset-0 -inset-x-6 -bottom-4 rounded-full blur-3xl opacity-30"
              style={{
                background:
                  "radial-gradient(ellipse at 50% 70%, #f97316 0%, transparent 70%)",
              }}
            />
            <Image
              src="/images/hero1.png"
              alt="Bisher kc"
              fill
              className="object-contain object-bottom drop-shadow-2xl"
              priority
            />
          </div>
        </div>

        {/* LIFE COACH — bottom, overlapping image */}
        <div className="relative z-20 w-full text-center -mt-8 pb-2">
          <h2 className="text-6xl sm:text-9xl font-black text-white uppercase leading-none tracking-tighter">
            Life <span className="text-primary-400">Coach</span>
          </h2>
        </div>
      </div>

      {/* ── DESKTOP layout ── */}
      <div className="hidden lg:flex relative z-10 flex-1 flex-col justify-between px-12 lg:px-20 pt-28 pb-0">
        <div className="flex-1 flex flex-row items-end justify-center relative">

          {/* Left — Name */}
          <div className="absolute left-0 top-1/3 -translate-y-1/2 text-left z-20">
            <p className="text-primary-400 text-base font-medium tracking-wider uppercase mb-3">
              Hey there, I&apos;m
            </p>
            <p className="text-6xl lg:text-7xl xl:text-8xl font-bold text-white leading-[0.95] tracking-tight">
              Bisher KC
            </p>
          </div>

          {/* Center — Image */}
          <div className="relative z-10 flex-shrink-0 mx-auto mt-auto">
            <div className="relative lg:w-[460px] lg:h-[580px] xl:w-[500px] xl:h-[640px]">
              <div
                className="absolute inset-0 -inset-x-8 -bottom-4 rounded-full blur-3xl opacity-30"
                style={{
                  background:
                    "radial-gradient(ellipse at 50% 70%, #f97316 0%, transparent 70%)",
                }}
              />
              <Image
                src="/images/hero1.png"
                alt="Bisher Khalil"
                fill
                className="object-contain object-bottom drop-shadow-2xl"
                priority
              />
            </div>
          </div>

          {/* Right — Chips */}
          <div className="absolute right-0 top-1/3 -translate-y-1/2 flex flex-col gap-3 z-20">
            {chips.map((chip, index) => {
              const Icon = chip.icon;
              return (
                <div
                  key={index}
                  className="flex items-center gap-2 bg-white/10 backdrop-blur-sm border border-white/20 rounded-full px-4 py-2.5 text-white/90"
                >
                  <Icon className="w-4 h-4 text-primary-400" />
                  <span className="text-sm font-medium whitespace-nowrap">{chip.label}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Big Typography */}
        <div className="relative z-20 w-full text-center pb-0 -mt-36">
          <h2 className="text-8xl xl:text-9xl font-black text-white uppercase leading-none tracking-tighter">
            Life <span className="text-primary-400">Coach</span>
          </h2>
        </div>
      </div>
    </section>
  );
}

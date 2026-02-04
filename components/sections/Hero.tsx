import React from "react";
import { Sparkles, BookOpen, Briefcase, Building2, Star } from "lucide-react";

const chips = [
  { icon: Sparkles, label: "Life Coach", position: "top-24 left-[8%]" },
  {
    icon: BookOpen,
    label: "Author (Neuro Code)",
    position: "top-36 right-[8%]",
  },
  { icon: Briefcase, label: "Corporate Trainer", position: "top-52 left-[5%]" },
  { icon: Building2, label: "CEO of Skillage", position: "top-60 right-[5%]" },
];

const images = [
  { src: "/images/hero-1.jpg", alt: "Session 1", rotate: "-rotate-6" },
  { src: "/images/hero-2.jpg", alt: "Session 2", rotate: "rotate-3" },
  { src: "/images/hero-3.jpg", alt: "Session 3", rotate: "-rotate-3" },
  { src: "/images/hero-4.jpg", alt: "Session 4", rotate: "rotate-6" },
  { src: "/images/hero-5.jpg", alt: "Session 5", rotate: "-rotate-6" },
];

export default function Hero() {
  return (
    <section
      id="home"
      className="min-h-screen bg-white pt-28 pb-12 relative overflow-hidden"
    >
      {/* Green SVG Background Wave */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <svg
          className="absolute bottom-0 left-0 w-full h-[60%]"
          viewBox="0 0 1440 600"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          preserveAspectRatio="none"
        >
          <path
            d="M0 600V300C120 250 240 200 360 220C480 240 600 330 720 350C840 370 960 320 1080 280C1200 240 1320 210 1380 195L1440 180V600H0Z"
            fill="url(#greenGradient)"
            fillOpacity="0.15"
          />
          <path
            d="M0 600V400C160 350 320 300 480 320C640 340 800 430 960 450C1120 470 1280 420 1360 395L1440 370V600H0Z"
            fill="url(#greenGradient)"
            fillOpacity="0.1"
          />
          <defs>
            <linearGradient
              id="greenGradient"
              x1="0"
              y1="600"
              x2="1440"
              y2="0"
              gradientUnits="userSpaceOnUse"
            >
              <stop stopColor="#a3e635" />
              <stop offset="1" stopColor="#84cc16" />
            </linearGradient>
          </defs>
        </svg>
      </div>

      <div className="container-custom relative z-10">
        {/* Floating Chips */}
        <div className="hidden lg:block">
          {chips.map((chip, index) => {
            const Icon = chip.icon;
            return (
              <div
                key={index}
                className={`absolute ${chip.position} bg-white rounded-full px-4 py-2.5 shadow-lg border border-neutral-100 flex items-center gap-2 animate-float`}
                style={{ animationDelay: `${index * 0.3}s` }}
              >
                <Icon className="w-4 h-4 text-primary-500" />
                <span className="font-medium text-neutral-700 text-sm">
                  {chip.label}
                </span>
              </div>
            );
          })}
        </div>

        {/* Centered Content */}
        <div className="text-center max-w-3xl mx-auto mb-16 mt-5 md:mt-10 lg:mt-16">
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-neutral-900 mb-6 leading-tight">
            Rewrite Your Story.
            <br />
             <span className="text-200">Lead with </span>
            <span className="text-primary-400">Clarity</span>
          </h1>

          <p className="text-lg text-neutral-600 mb-8 leading-relaxed max-w-2xl mx-auto">
            Helping individuals and organizations to grow personally and
            professionally through transformative learning and mindset coaching.
          </p>

          <div className="flex gap-4 justify-center">
            <a
              href="#contact"
              className="inline-flex items-center justify-center px-8 py-3.5 rounded-full bg-primary-400 text-neutral-900 font-semibold transition-all duration-300 hover:bg-primary-500 hover:shadow-lg"
            >
              Book a Call
            </a>
            <a
              href="#about"
              className="inline-flex items-center justify-center px-8 py-3.5 rounded-full border-2 border-neutral-300 text-neutral-700 font-medium transition-all duration-300 hover:bg-neutral-100"
            >
              Learn More
            </a>
          </div>
        </div>

        {/* Overlapping Images - Same size, alternating tilt */}
        <div className="flex items-center justify-center mt-10">
          <div className="flex items-center justify-center -space-x-8 md:-space-x-12">
            {images.map((image, index) => (
              <div
                key={index}
                className={`w-36 h-48 md:w-44 md:h-56 ${image.rotate} rounded-2xl bg-gradient-to-br from-neutral-200 to-neutral-100 overflow-hidden shadow-xl flex-shrink-0 transition-all duration-300 hover:scale-110 hover:rotate-0 hover:z-50 border-4 border-white`}
              >
                <img
                  src={image.src}
                  alt={image.alt}
                  className="w-full h-full object-cover"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Mobile Chips */}
        <div className="lg:hidden flex flex-wrap justify-center gap-3 mt-12">
          {chips.map((chip, index) => {
            const Icon = chip.icon;
            return (
              <div
                key={index}
                className="bg-white rounded-full px-4 py-2 shadow-md border border-neutral-100 flex items-center gap-2"
              >
                <Icon className="w-4 h-4 text-primary-500" />
                <span className="font-medium text-neutral-700 text-sm">
                  {chip.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

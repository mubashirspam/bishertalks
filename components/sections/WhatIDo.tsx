import React from "react";
import {
  Brain,
  Users,
  Mic,
  Building2,
  Tent,
  Zap,
  Mountain,
  Star,
  ArrowUpRight,
} from "lucide-react";

const services = [
  {
    icon: Brain,
    title: "Mindset & Life Coaching",
    description:
      'Break through limiting beliefs and rewrite your internal "Neuro Code."',
    color: "bg-primary-100",
  },
  {
    icon: Users,
    title: "Trainer's & Teacher's Excellence",
    description:
      "Master the art of engagement using gamification, icebreakers, and practical pedagogy.",
    color: "bg-neutral-100",
  },
  {
    icon: Mic,
    title: "High-Impact Communication",
    description:
      "Build stage presence and influence through NLP-driven public speaking.",
    color: "bg-primary-50",
  },
  {
    icon: Building2,
    title: "Corporate Leadership",
    description:
      "Enhance productivity and team dynamics using psychological tools.",
    color: "bg-neutral-50",
  },
  {
    icon: Tent,
    title: "Immersive Bootcamps",
    description:
      "Deep-dive transformation through one-day and multi-day intensive camps.",
    color: "bg-primary-100",
  },
  {
    icon: Zap,
    title: "Motivational Keynotes",
    description:
      "High-energy sessions that spark immediate action and long-term change.",
    color: "bg-neutral-100",
  },
  {
    icon: Mountain,
    title: "Corporate Outbound Training",
    description:
      "Activity-based learning in nature to build elite teams and foster radical ownership.",
    color: "bg-primary-50",
  },
];

export default function WhatIDo() {
  return (
    <section
      id="services"
      className="py-20 bg-neutral-50 relative overflow-hidden"
    >
      {/* Background decoration */}
      <div className="absolute top-0 right-0 w-96 h-96 bg-primary-200/20 rounded-full blur-3xl" />
      <div className="absolute bottom-0 left-0 w-96 h-96 bg-primary-100/30 rounded-full blur-3xl" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        {/* Header */}
        <div className="text-center mb-16">
          <span className="inline-block px-4 py-1.5 bg-white border border-neutral-200 rounded-full text-sm font-medium text-neutral-600 mb-4">
            Services
          </span>
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-neutral-900 mb-4">
            What I <span className="text-primary-500">Do</span>
          </h2>
          <p className="text-lg text-neutral-600 max-w-2xl mx-auto">
            I design and deliver result-driven experiences that help you move
            from where you are to where you want to be.
          </p>
        </div>

        {/* Services Grid with Center Image */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column */}
          <div className="space-y-4">
            {services.slice(0, 3).map((service, index) => {
              const Icon = service.icon;
              return (
                <div
                  key={index}
                  className="bg-white rounded-2xl p-5 border border-neutral-100 hover:border-primary-200 hover:shadow-lg transition-all duration-300 group cursor-pointer"
                >
                  <div className="flex items-start gap-4">
                    <div
                      className={`w-12 h-12 ${service.color} rounded-xl flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform`}
                    >
                      <Icon className="w-6 h-6 text-primary-600" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="font-semibold text-neutral-900">
                          {service.title}
                        </h3>
                        <ArrowUpRight className="w-4 h-4 text-neutral-400 group-hover:text-primary-500 transition-colors" />
                      </div>
                      <p className="text-sm text-neutral-600 leading-relaxed">
                        {service.description}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Center Image */}
          <div className="hidden lg:flex items-center justify-center">
            <div className="relative">
              <div className="w-72 h-96 bg-gradient-to-br from-primary-200 to-primary-100 rounded-3xl overflow-hidden shadow-2xl flex items-center justify-center">
                {/* Replace with actual image */}
                <img
                  src="/images/services.jpg"
                  alt="Services"
                  className="w-full h-full object-cover"
                />
              </div>
              {/* Floating badge */}
              <div className="absolute -bottom-4 -right-4 bg-neutral-900 text-white px-4 py-2 rounded-full text-sm font-medium flex items-center gap-2">
                <Star className="w-4 h-4 text-primary-400" /> Bisher KC
              </div>
            </div>
          </div>

          {/* Right Column */}
          <div className="space-y-4">
            {services.slice(3, 7).map((service, index) => {
              const Icon = service.icon;
              return (
                <div
                  key={index}
                  className="bg-white rounded-2xl p-5 border border-neutral-100 hover:border-primary-200 hover:shadow-lg transition-all duration-300 group cursor-pointer"
                >
                  <div className="flex items-start gap-4">
                    <div
                      className={`w-12 h-12 ${service.color} rounded-xl flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform`}
                    >
                      <Icon className="w-6 h-6 text-primary-600" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="font-semibold text-neutral-900">
                          {service.title}
                        </h3>
                        <ArrowUpRight className="w-4 h-4 text-neutral-400 group-hover:text-primary-500 transition-colors" />
                      </div>
                      <p className="text-sm text-neutral-600 leading-relaxed">
                        {service.description}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Bottom CTA */}
        <div className="mt-12 text-center">
          <a
            href="#contact"
            className="inline-flex items-center gap-2 px-8 py-4 bg-neutral-900 text-white rounded-full font-medium hover:bg-neutral-800 transition-colors"
          >
            Book a Session
            <ArrowUpRight className="w-5 h-5" />
          </a>
        </div>
      </div>
    </section>
  );
}

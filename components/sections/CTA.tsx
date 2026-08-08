import React from "react";
import {
  ArrowRight,
  Mail,
  Phone,
  MapPin,
  Calendar,
  Sparkles,
} from "lucide-react";

export default function CTA() {
  return (
    <section id="contact" className="py-20 bg-white dark:bg-neutral-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Main CTA Card */}
        <div className="relative overflow-hidden rounded-3xl bg-neutral-900 p-8 md:p-12 lg:p-16">
          {/* Background decorations */}
          <div className="absolute top-0 right-0 w-96 h-96 bg-primary-500/20 rounded-full blur-3xl" />
          <div className="absolute bottom-0 left-0 w-72 h-72 bg-primary-400/10 rounded-full blur-3xl" />

          {/* SVG Pattern */}
          <div className="absolute inset-0 opacity-5">
            <svg width="100%" height="100%">
              <defs>
                <pattern
                  id="cta-pattern"
                  x="0"
                  y="0"
                  width="40"
                  height="40"
                  patternUnits="userSpaceOnUse"
                >
                  <circle cx="20" cy="20" r="1.5" fill="white" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#cta-pattern)" />
            </svg>
          </div>

          <div className="relative z-10 grid lg:grid-cols-2 gap-12 items-center">
            {/* Left Content */}
            <div>
              <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-white/10 rounded-full text-sm text-white mb-6">
                <Sparkles className="w-4 h-4 text-primary-400" />
                Let&apos;s Connect
              </div>

              <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-white mb-6 leading-tight">
                Ready to Transform <br />
                <span className="text-primary-400">Your Life?</span>
              </h2>

              <p className="text-lg text-neutral-300 mb-8 leading-relaxed">
                Take the first step towards clarity, confidence, and purposeful
                living. Let&apos;s begin your transformation journey together.
              </p>

              <div className="flex flex-wrap gap-4">
                <a
                  href="mailto:contact@bisherkc.com"
                  className="inline-flex items-center gap-2 px-8 py-4 bg-primary-400 text-neutral-900 rounded-full font-semibold hover:bg-primary-300 transition-colors"
                >
                  <Calendar className="w-5 h-5" />
                  Book a Call
                </a>
                <a
                  href="mailto:contact@bisherkc.com"
                  className="inline-flex items-center gap-2 px-8 py-4 bg-white/10 text-white rounded-full font-medium hover:bg-white/20 transition-colors border border-white/20"
                >
                  Send Email
                  <ArrowRight className="w-5 h-5" />
                </a>
              </div>
            </div>

            {/* Right - Contact Cards */}
            <div className="space-y-4">
              <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-6 border border-white/10 hover:bg-white/15 transition-colors">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-primary-400 rounded-xl flex items-center justify-center">
                    <Mail className="w-6 h-6 text-neutral-900" />
                  </div>
                  <div>
                    <div className="text-sm text-neutral-400 mb-1">Email</div>
                    <a
                      href="mailto:contact@bisherkc.com"
                      className="text-white font-medium hover:text-primary-400 transition-colors"
                    >
                      contact@bisherkc.com
                    </a>
                  </div>
                </div>
              </div>

              <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-6 border border-white/10 hover:bg-white/15 transition-colors">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-primary-400 rounded-xl flex items-center justify-center">
                    <Phone className="w-6 h-6 text-neutral-900" />
                  </div>
                  <div>
                    <div className="text-sm text-neutral-400 mb-1">Phone</div>
                    <a
                      href="tel:+916282680794"
                      className="text-white font-medium hover:text-primary-400 transition-colors"
                    >
                      +91 62826 80794
                    </a>
                  </div>
                </div>
              </div>

              <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-6 border border-white/10 hover:bg-white/15 transition-colors">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-primary-400 rounded-xl flex items-center justify-center">
                    <MapPin className="w-6 h-6 text-neutral-900" />
                  </div>
                  <div>
                    <div className="text-sm text-neutral-400 mb-1">
                      Location
                    </div>
                    <div className="text-white font-medium">Kerala, India</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Skillage Banner */}
        <div className="mt-8 bg-primary-100 dark:bg-primary-900/30 rounded-2xl p-6 md:p-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-white dark:bg-neutral-800 rounded-xl flex items-center justify-center shadow-sm">
              <span className="text-2xl font-bold text-primary-600">S</span>
            </div>
            <div>
              <p className="text-sm text-primary-700 dark:text-primary-400">CEO of</p>
              <h3 className="text-xl font-bold text-neutral-900 dark:text-white">Skillage</h3>
            </div>
          </div>
          <p className="text-neutral-700 dark:text-neutral-300 text-center md:text-left">
            Empowering individuals and organizations through transformative
            learning
          </p>
        </div>
      </div>
    </section>
  );
}

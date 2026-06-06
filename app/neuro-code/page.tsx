"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import {
  Star,
  ShoppingCart,
  ChevronDown,
  ChevronUp,
  BookOpen,
  Brain,
  Zap,
  Target,
  Layers,
  ArrowUpRight,
  Quote,
  Gift,
  PlayCircle,
  CheckCircle2,
  Lock,
} from "lucide-react";

const highlights = [
  {
    icon: Brain,
    title: "Decode Your Mind",
    desc: "Understand the hidden neural patterns driving your every thought, emotion, and decision.",
  },
  {
    icon: Zap,
    title: "Break Limiting Beliefs",
    desc: "Identify and permanently dissolve the internal programs keeping you stuck in cycles of self-sabotage.",
  },
  {
    icon: Target,
    title: "Rewire for Success",
    desc: "Install new empowering codes that align your subconscious mind with your conscious goals.",
  },
  {
    icon: Layers,
    title: "Practical Techniques",
    desc: "Step-by-step NLP-based exercises you can apply immediately to accelerate transformation.",
  },
  {
    icon: BookOpen,
    title: "Real Transformation Stories",
    desc: "Learn from real people who rewrote their internal code and radically changed their lives.",
  },
  {
    icon: Star,
    title: "Lasting Change",
    desc: "Go beyond motivation — create deep, permanent shifts at the level of identity and belief.",
  },
];

const testimonials = [
  {
    name: "Ananya R.",
    role: "Entrepreneur, Bangalore",
    text: "Neuro Code is the most practical mindset book I've ever read. I finished it in two days and immediately started applying the techniques. My business decisions feel clearer than ever.",
    rating: 5,
  },
  {
    name: "Mohammed S.",
    role: "Corporate Professional, Dubai",
    text: "I've read hundreds of self-help books. This is different. Bisher doesn't just inspire — he gives you a system. Three months later, I'm unrecognizable to my old self.",
    rating: 5,
  },
  {
    name: "Priya K.",
    role: "Teacher, Kerala",
    text: "The chapter on limiting beliefs alone was worth the entire book. I wept reading it. It put into words everything I had been feeling for years — and then showed me exactly how to move forward.",
    rating: 5,
  },
  {
    name: "Rahul M.",
    role: "Student, Kochi",
    text: "I was skeptical about self-help, but my professor recommended this. Bisher KC writes like he's talking directly to you. Life-changing perspective on how the mind actually works.",
    rating: 5,
  },
];

const faqs = [
  {
    q: "Who is this book for?",
    a: "Neuro Code is for anyone who feels stuck, unfulfilled, or limited by their own thinking — whether you're a student, professional, entrepreneur, or someone seeking deeper personal transformation.",
  },
  {
    q: "Is this a religious or spiritual book?",
    a: "No. Neuro Code is grounded in neuroscience, NLP (Neuro-Linguistic Programming), and behavioral psychology. It's practical, evidence-based, and applicable regardless of background or belief.",
  },
  {
    q: "How long is the book?",
    a: "The book is concise and power-packed — designed to be read in a weekend but referenced for a lifetime. Quality over quantity is the philosophy.",
  },
  {
    q: "Is it available in languages other than English?",
    a: "Currently available in English and Malayalam. More regional language editions are in production.",
  },
  {
    q: "Can I get a signed copy?",
    a: "Yes! Limited signed copies are available. Contact us directly via the website or WhatsApp for signed editions.",
  },
  {
    q: "How do I access the free NLP course after purchase?",
    a: "After your book purchase is confirmed, you'll receive course access details via email and WhatsApp. The full NLP Mastery Course will be unlocked in your account at no extra charge.",
  },
];

const nlpCourseModules = [
  "Introduction to NLP",
  "NLP Filters & Mental Maps",
  "Anchoring Techniques",
  "Sub-Modalities",
  "Belief System Reprogramming",
  "Identity & Outcome Setting",
];

export default function NeuroCodePage() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  return (
    <div className="min-h-screen bg-white dark:bg-neutral-950 text-neutral-900 dark:text-white font-sans overflow-x-hidden transition-colors">

      {/* ── NAV ── */}
      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 md:px-12 py-4 bg-white/80 dark:bg-neutral-950/80 backdrop-blur-md border-b border-neutral-200 dark:border-white/5">
        <div className="flex items-center gap-2">
          <span className="text-neutral-900 dark:text-white font-bold text-lg tracking-tight">Neuro</span>
          <span className="text-primary-500 font-bold text-lg tracking-tight">Code</span>
        </div>
        <a
          href="/neuro-code/checkout"
          className="px-5 py-2 rounded-full bg-primary-500 hover:bg-primary-600 text-white text-sm font-semibold transition-all"
        >
          Get the Book
        </a>
      </nav>

      {/* ── HERO ── */}
      <section className="relative min-h-screen flex items-center pt-20 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-neutral-50 via-white to-orange-50/40 dark:from-neutral-950 dark:via-neutral-900 dark:to-neutral-950" />
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-primary-500/8 dark:bg-primary-500/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-primary-300/10 dark:bg-primary-800/10 rounded-full blur-[100px]" />

        <div className="relative z-10 max-w-7xl mx-auto px-6 md:px-12 grid grid-cols-1 lg:grid-cols-2 gap-16 items-center py-16">
          {/* Left */}
          <div>
            <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-primary-400/40 bg-primary-50 dark:bg-primary-500/10 text-primary-600 dark:text-primary-400 text-xs font-semibold tracking-wider uppercase mb-6">
              <BookOpen className="w-3.5 h-3.5" />
              Bestselling Book
            </span>
            <h1 className="text-5xl md:text-6xl lg:text-7xl font-black leading-[0.95] tracking-tight mb-6 text-neutral-900 dark:text-white">
              Rewrite Your{" "}
              <span className="text-primary-500">Internal</span>{" "}
              Programming
            </h1>
            <p className="text-lg text-neutral-600 dark:text-neutral-300 leading-relaxed mb-8 max-w-lg">
              Discover the hidden codes that drive your thoughts, behaviours, and
              life outcomes. Neuro Code gives you the science-backed system to
              reprogram your mind for lasting success, clarity, and transformation.
            </p>

            <div className="flex items-center gap-3 mb-8">
              <div className="flex gap-0.5">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} className="w-4 h-4 fill-primary-400 text-primary-400" />
                ))}
              </div>
              <span className="text-neutral-900 dark:text-white font-semibold">4.9</span>
              <span className="text-neutral-500 dark:text-neutral-400 text-sm">· 2,400+ readers</span>
            </div>

            <div className="flex flex-wrap gap-4">
              <a
                href="/neuro-code/checkout"
                className="inline-flex items-center gap-2 px-8 py-4 rounded-full bg-primary-500 hover:bg-primary-600 text-white font-bold text-sm transition-all shadow-lg shadow-primary-500/20"
              >
                <ShoppingCart className="w-4 h-4" />
                Buy Now
              </a>
              <a
                href="#about-book"
                className="inline-flex items-center gap-2 px-8 py-4 rounded-full border border-neutral-300 dark:border-white/20 hover:border-neutral-400 dark:hover:border-white/40 text-neutral-700 dark:text-white font-medium text-sm transition-all"
              >
                Learn More
                <ArrowUpRight className="w-4 h-4" />
              </a>
            </div>
          </div>

          {/* Right — Book */}
          <div className="flex justify-center lg:justify-end">
            <div className="relative">
              <div className="absolute inset-0 scale-90 translate-y-8 bg-primary-500/20 dark:bg-primary-500/30 blur-3xl rounded-full" />
              <div className="relative w-[260px] md:w-[300px] lg:w-[340px]">
                <div className="aspect-[3/4] rounded-xl overflow-hidden shadow-2xl shadow-neutral-900/20 dark:shadow-neutral-950 ring-1 ring-neutral-200 dark:ring-white/10">
                  <img
                    src="/images/book_front.png"
                    alt="Neuro Code Book by Bisher KC"
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute left-0 top-0 bottom-0 w-3 bg-gradient-to-r from-neutral-900/30 to-transparent" />
                </div>
                <div className="absolute -top-4 -left-6 bg-primary-400 text-neutral-900 px-4 py-2 rounded-full text-xs font-black shadow-lg rotate-[-6deg]">
                  BESTSELLER
                </div>
                <div className="absolute -bottom-4 -right-6 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white px-4 py-2.5 rounded-2xl text-xs font-semibold shadow-xl ring-1 ring-neutral-200 dark:ring-white/10 flex items-center gap-1.5">
                  <Star className="w-3.5 h-3.5 fill-yellow-400 text-yellow-400" />
                  4.9 / 5.0
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── STATS BAR ── */}
      <section className="border-y border-neutral-200 dark:border-white/8 bg-neutral-50/80 dark:bg-neutral-900/60 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto px-6 py-8 grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          {[
            { value: "2,400+", label: "Readers" },
            { value: "4.9★", label: "Average Rating" },
            { value: "12", label: "Chapters" },
            { value: "3", label: "Languages" },
          ].map((stat) => (
            <div key={stat.label}>
              <p className="text-3xl font-black text-primary-500">{stat.value}</p>
              <p className="text-neutral-500 dark:text-neutral-400 text-sm mt-1">{stat.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── ABOUT THE BOOK ── */}
      <section id="about-book" className="py-24 px-6 md:px-12 max-w-7xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          <div>
            <p className="text-primary-500 text-xs font-semibold tracking-widest uppercase mb-4">
              About the Book
            </p>
            <h2 className="text-4xl md:text-5xl font-black leading-tight mb-6 text-neutral-900 dark:text-white">
              What Is{" "}
              <span className="text-primary-500">Neuro Code</span>?
            </h2>
            <div className="space-y-4 text-neutral-600 dark:text-neutral-300 leading-relaxed">
              <p>
                Every human being runs on invisible code — deeply embedded neural
                programmes shaped by past experiences, beliefs, and conditioning. Most
                people never even know this code exists, let alone question it.
              </p>
              <p>
                Neuro Code is your manual for understanding, accessing, and rewriting
                that programming. Drawing from neuroscience, NLP, and two decades of
                coaching experience, Bisher KC breaks down the complex science of the
                human mind into a powerful, practical system anyone can use.
              </p>
              <p>
                This is not a motivational book. It is a reprogramming manual — a
                precise, step-by-step guide for people who are done feeling stuck and
                ready for a fundamentally different life.
              </p>
            </div>
          </div>

          {/* Chapter preview */}
          <div className="bg-neutral-50 dark:bg-neutral-900 rounded-3xl p-8 border border-neutral-200 dark:border-white/8">
            <p className="text-xs font-semibold tracking-widest uppercase text-neutral-500 dark:text-neutral-400 mb-6">
              What&apos;s Inside
            </p>
            <div className="space-y-1">
              {[
                "The Architecture of the Mind",
                "How Beliefs Become Your Biology",
                "Decoding Your Emotional Triggers",
                "The Language of the Subconscious",
                "Installing New Neural Patterns",
                "The Identity Shift Protocol",
                "Sustaining Transformation",
              ].map((chapter, i) => (
                <div
                  key={i}
                  className="flex items-center gap-4 py-3 border-b border-neutral-200 dark:border-white/5 last:border-0"
                >
                  <span className="text-primary-500 font-black text-xs w-6 text-right flex-shrink-0">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="text-neutral-700 dark:text-neutral-200 text-sm font-medium">{chapter}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── WHAT YOU'LL DISCOVER ── */}
      <section className="py-24 bg-neutral-50 dark:bg-neutral-900/50">
        <div className="max-w-7xl mx-auto px-6 md:px-12">
          <div className="text-center mb-16">
            <p className="text-primary-500 text-xs font-semibold tracking-widest uppercase mb-4">
              What You&apos;ll Discover
            </p>
            <h2 className="text-4xl md:text-5xl font-black text-neutral-900 dark:text-white">
              Six Codes That{" "}
              <span className="text-primary-500">Change Everything</span>
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {highlights.map((h, i) => {
              const Icon = h.icon;
              return (
                <div
                  key={i}
                  className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-white/8 rounded-2xl p-6 hover:border-primary-400/50 dark:hover:border-primary-500/30 hover:shadow-md dark:hover:bg-neutral-800/60 transition-all group"
                >
                  <div className="w-10 h-10 rounded-xl bg-primary-50 dark:bg-primary-500/10 border border-primary-200 dark:border-primary-500/20 flex items-center justify-center mb-4 group-hover:bg-primary-100 dark:group-hover:bg-primary-500/20 transition-colors">
                    <Icon className="w-5 h-5 text-primary-500" />
                  </div>
                  <h3 className="font-bold text-neutral-900 dark:text-white mb-2">{h.title}</h3>
                  <p className="text-neutral-500 dark:text-neutral-400 text-sm leading-relaxed">{h.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── FREE NLP COURSE WITH BOOK PURCHASE ── */}
      <section className="py-24 px-6 md:px-12 relative overflow-hidden">
        {/* Background */}
        <div className="absolute inset-0 bg-gradient-to-br from-primary-50 via-white to-orange-50/50 dark:from-neutral-950 dark:via-neutral-900 dark:to-primary-950/20" />
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-primary-400/8 dark:bg-primary-500/8 rounded-full blur-[100px]" />

        <div className="relative z-10 max-w-7xl mx-auto">
          {/* Section header */}
          <div className="text-center mb-14">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary-500 text-white text-xs font-black tracking-wider uppercase mb-5 shadow-lg shadow-primary-500/25">
              <Gift className="w-3.5 h-3.5" />
              Exclusive Bonus
            </div>
            <h2 className="text-4xl md:text-5xl font-black text-neutral-900 dark:text-white mb-4">
              Get This Course{" "}
              <span className="text-primary-500">Absolutely Free</span>
            </h2>
            <p className="text-neutral-600 dark:text-neutral-400 text-lg max-w-2xl mx-auto">
              Every book purchase includes full access to the{" "}
              <strong className="text-neutral-900 dark:text-white">NLP Mastery Course</strong> — at no extra cost.
            </p>
          </div>

          {/* Course card */}
          <div className="max-w-4xl mx-auto">
            <div className="relative bg-white dark:bg-neutral-900 rounded-3xl border border-neutral-200 dark:border-white/10 overflow-hidden shadow-xl dark:shadow-none">

              {/* FREE ribbon */}
              <div className="absolute top-5 right-5 z-20">
                <div className="bg-primary-500 text-white text-xs font-black px-4 py-1.5 rounded-full shadow-lg shadow-primary-500/30 tracking-wide">
                  FREE WITH BOOK
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-0">
                {/* Left — course thumbnail */}
                <div className="relative bg-gradient-to-br from-neutral-900 to-neutral-800 min-h-[260px] md:min-h-[320px] flex flex-col justify-end p-8 overflow-hidden">
                  {/* Cover image */}
                  <img
                    src="/images/courses/nlp-cover.jpg"
                    alt="NLP Mastery Course"
                    className="absolute inset-0 w-full h-full object-cover opacity-50"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-neutral-900/90 via-neutral-900/40 to-transparent" />

                  {/* Play icon */}
                  <div className="relative z-10 w-14 h-14 rounded-full bg-primary-500/20 border-2 border-primary-400 flex items-center justify-center mb-4">
                    <PlayCircle className="w-7 h-7 text-primary-400 fill-primary-400/20" />
                  </div>

                  <div className="relative z-10">
                    <p className="text-primary-400 text-xs font-semibold tracking-widest uppercase mb-1">
                      Full Video Course
                    </p>
                    <h3 className="text-white text-2xl font-black leading-tight">
                      Neuro Linguistic<br />Programming
                    </h3>
                    <p className="text-neutral-300 text-sm mt-1">NLP Mastery Course · by Bisher KC</p>
                  </div>
                </div>

                {/* Right — course details */}
                <div className="p-8 flex flex-col justify-between">
                  <div>
                    <p className="text-neutral-600 dark:text-neutral-300 text-sm leading-relaxed mb-6">
                      Master the art of Neuro Linguistic Programming. Learn how to reprogram your mind,
                      break limiting beliefs, and unlock your full potential through proven NLP techniques.
                    </p>

                    {/* Modules list */}
                    <p className="text-xs font-semibold tracking-widest uppercase text-neutral-500 dark:text-neutral-400 mb-3">
                      Course Modules
                    </p>
                    <ul className="space-y-2 mb-6">
                      {nlpCourseModules.map((mod) => (
                        <li key={mod} className="flex items-center gap-2.5 text-sm text-neutral-700 dark:text-neutral-300">
                          <CheckCircle2 className="w-4 h-4 text-primary-500 flex-shrink-0" />
                          {mod}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Value + unlock note */}
                  <div className="border-t border-neutral-100 dark:border-white/8 pt-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-neutral-500 dark:text-neutral-400">Course value</span>
                      <span className="text-neutral-400 dark:text-neutral-500 line-through text-sm">₹2,499</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-neutral-900 dark:text-white">Your price</span>
                      <span className="text-xl font-black text-primary-500">FREE</span>
                    </div>
                    <div className="flex items-start gap-2 pt-1 bg-primary-50 dark:bg-primary-900/20 rounded-xl px-3 py-2.5">
                      <Lock className="w-3.5 h-3.5 text-primary-500 flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-primary-700 dark:text-primary-400 leading-snug">
                        Course access is shared via email after your book purchase is confirmed.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom note */}
            <p className="text-center text-neutral-500 dark:text-neutral-500 text-sm mt-5">
              No coupon needed · No separate registration · Automatically included with every book order
            </p>
          </div>
        </div>
      </section>

      {/* ── AUTHOR ── */}
      <section className="py-24 px-6 md:px-12 max-w-7xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          <div className="relative flex justify-center lg:justify-start">
            <div className="absolute inset-0 max-w-sm bg-primary-400/10 dark:bg-primary-500/10 blur-3xl rounded-full" />
            <div className="relative w-72 md:w-80 aspect-square rounded-3xl overflow-hidden border border-neutral-200 dark:border-white/10 shadow-2xl">
              <img
                src="/images/hero1.png"
                alt="Bisher KC"
                className="w-full h-full object-cover object-top"
              />
            </div>
            <div className="absolute -bottom-4 -right-4 md:-right-8 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-white/10 rounded-2xl px-5 py-4 shadow-xl">
              <p className="text-neutral-900 dark:text-white font-bold">Bisher KC</p>
              <p className="text-primary-500 text-xs">Life Coach · Author · Speaker</p>
            </div>
          </div>

          <div>
            <p className="text-primary-500 text-xs font-semibold tracking-widest uppercase mb-4">
              The Author
            </p>
            <h2 className="text-4xl md:text-5xl font-black mb-6 leading-tight text-neutral-900 dark:text-white">
              Meet{" "}
              <span className="text-primary-500">Bisher KC</span>
            </h2>
            <div className="space-y-4 text-neutral-600 dark:text-neutral-300 leading-relaxed">
              <p>
                Bisher KC is a renowned life coach, NLP practitioner, and the founder
                of Skillage — a learning platform that has transformed the lives of
                thousands across India and the Gulf.
              </p>
              <p>
                With over two decades of experience in personal transformation, corporate
                training, and public speaking, Bisher has worked with students,
                entrepreneurs, executives, and educators — helping them break free from
                mental limitations and step into their highest potential.
              </p>
              <p>
                Neuro Code distils his most powerful insights into a single, accessible
                masterwork — the book he wishes existed when he first began his own
                journey of transformation.
              </p>
            </div>

            <div className="flex flex-wrap gap-3 mt-8">
              {["Life Coach", "NLP Practitioner", "Corporate Trainer", "CEO of Skillage"].map((tag) => (
                <span
                  key={tag}
                  className="px-4 py-1.5 rounded-full bg-neutral-100 dark:bg-white/5 border border-neutral-200 dark:border-white/10 text-neutral-700 dark:text-neutral-300 text-xs font-medium"
                >
                  {tag}
                </span>
              ))}
            </div>

            <Link
              href="/#about"
              className="inline-flex items-center gap-2 mt-6 text-primary-500 hover:text-primary-600 text-sm font-medium transition-colors"
            >
              Full story <ArrowUpRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* ── TESTIMONIALS ── */}
      <section className="py-24 bg-neutral-50 dark:bg-neutral-900/50">
        <div className="max-w-7xl mx-auto px-6 md:px-12">
          <div className="text-center mb-16">
            <p className="text-primary-500 text-xs font-semibold tracking-widest uppercase mb-4">
              Reader Reviews
            </p>
            <h2 className="text-4xl md:text-5xl font-black text-neutral-900 dark:text-white">
              What Readers{" "}
              <span className="text-primary-500">Are Saying</span>
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {testimonials.map((t, i) => (
              <div
                key={i}
                className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-white/8 rounded-2xl p-8 hover:border-primary-300 dark:hover:border-primary-500/20 hover:shadow-md transition-all"
              >
                <Quote className="w-8 h-8 text-primary-400/40 mb-4" />
                <p className="text-neutral-700 dark:text-neutral-200 leading-relaxed mb-6 italic">
                  &ldquo;{t.text}&rdquo;
                </p>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-neutral-900 dark:text-white">{t.name}</p>
                    <p className="text-neutral-500 dark:text-neutral-400 text-sm">{t.role}</p>
                  </div>
                  <div className="flex gap-0.5">
                    {[...Array(t.rating)].map((_, j) => (
                      <Star key={j} className="w-3.5 h-3.5 fill-primary-400 text-primary-400" />
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="py-24 px-6 md:px-12 max-w-4xl mx-auto">
        <div className="text-center mb-16">
          <p className="text-primary-500 text-xs font-semibold tracking-widest uppercase mb-4">
            FAQ
          </p>
          <h2 className="text-4xl md:text-5xl font-black text-neutral-900 dark:text-white">
            Common <span className="text-primary-500">Questions</span>
          </h2>
        </div>

        <div className="space-y-3">
          {faqs.map((faq, i) => (
            <div
              key={i}
              className="bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-white/8 rounded-2xl overflow-hidden"
            >
              <button
                className="w-full flex items-center justify-between px-6 py-5 text-left"
                onClick={() => setOpenFaq(openFaq === i ? null : i)}
              >
                <span className="font-semibold text-neutral-900 dark:text-white">{faq.q}</span>
                {openFaq === i ? (
                  <ChevronUp className="w-4 h-4 text-primary-500 flex-shrink-0" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-neutral-400 flex-shrink-0" />
                )}
              </button>
              {openFaq === i && (
                <div className="px-6 pb-5 text-neutral-600 dark:text-neutral-400 leading-relaxed text-sm border-t border-neutral-100 dark:border-white/5 pt-4">
                  {faq.a}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ── GET THE BOOK CTA ── */}
      <section id="get-book" className="py-24 px-6 md:px-12 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-neutral-900 via-neutral-950 to-neutral-950 dark:from-neutral-900 dark:via-neutral-950 dark:to-neutral-950" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-primary-500/15 rounded-full blur-[80px]" />

        <div className="relative z-10 max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div className="flex justify-center">
            <div className="relative w-[200px] md:w-[240px]">
              <div className="absolute inset-0 scale-75 translate-y-10 bg-primary-500/40 blur-2xl rounded-full" />
              <div className="relative aspect-[3/4] rounded-xl overflow-hidden shadow-2xl ring-1 ring-white/10">
                <img
                  src="/images/book_front.png"
                  alt="Neuro Code Book"
                  className="w-full h-full object-cover"
                />
              </div>
            </div>
          </div>

          <div>
            <h2 className="text-4xl md:text-5xl font-black mb-4 leading-tight text-white">
              Start Your{" "}
              <span className="text-primary-400">Transformation</span>{" "}
              Today
            </h2>
            <p className="text-neutral-400 mb-4 leading-relaxed">
              Join 2,400+ readers who have already begun rewriting their internal
              programming. Your new code starts here.
            </p>
            <div className="flex items-center gap-2 mb-8 text-sm text-primary-400 font-medium">
              <Gift className="w-4 h-4" />
              Includes free NLP Mastery Course access
            </div>

            <div className="flex flex-col sm:flex-row gap-4">
              <a
                href="/neuro-code/checkout"
                className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-full bg-primary-500 hover:bg-primary-400 text-white font-bold transition-all shadow-lg shadow-primary-500/20"
              >
                <ShoppingCart className="w-5 h-5" />
                Buy Now
              </a>
              <a
                href="/neuro-code/checkout"
                className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-full border border-white/20 hover:border-white/40 text-white font-medium transition-all"
              >
                Order Signed Copy
                <ArrowUpRight className="w-5 h-5" />
              </a>
            </div>

            <p className="text-neutral-600 text-xs mt-6">
              Available in English & Malayalam · Signed editions available on request
            </p>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="border-t border-neutral-200 dark:border-white/8 bg-white dark:bg-neutral-950 px-6 md:px-12 py-8">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="text-neutral-900 dark:text-white font-bold">Neuro</span>
            <span className="text-primary-500 font-bold">Code</span>
            <span className="text-neutral-400 mx-2">·</span>
            <span className="text-neutral-500 dark:text-neutral-400 text-sm">by Bisher KC</span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/" className="text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white text-sm transition-colors">
              ← Back to bishertalks.com
            </Link>
            <span className="text-neutral-300 dark:text-neutral-700">·</span>
            <Link href="/privacy-policy" className="text-neutral-400 dark:text-neutral-500 hover:text-neutral-700 dark:hover:text-white text-xs transition-colors">
              Privacy Policy
            </Link>
            <Link href="/terms" className="text-neutral-400 dark:text-neutral-500 hover:text-neutral-700 dark:hover:text-white text-xs transition-colors">
              Terms & Refund
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

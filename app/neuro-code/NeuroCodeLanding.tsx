"use client";

import Image from "next/image";
import { useEffect, useState, type CSSProperties } from "react";
import {
  Star, Check, ChevronDown, ChevronUp, ArrowDown, Play, Clock,
  Truck, Wallet, Gift, ShieldCheck, MessageCircle, Headphones,
  Target, Repeat, Users, Frown, UserCheck, Brain, Heart, CloudRain,
  Search, Lightbulb, PencilLine, Quote,
} from "lucide-react";
import type { ProductPricing } from "@/lib/db/courses";
import { trackViewContent, trackInitiateCheckout } from "@/lib/pixel";
import { faqs } from "./faqs";
import { Band, Card, Heading, OrderNow, Rule } from "./ui";
import {
  VideoTestimonials, ImageTestimonials, AudioTestimonials, TextTestimonials,
} from "./Testimonials";
import {
  EDITION, HERO, INDEPENDENCE_DAY, PROBLEMS, PROBLEMS_HEADING, PROBLEMS_LEAD, PROBLEMS_TITLE,
  PROBLEMS_CLOSER, CHAIN_HEADING, CODE_CHAIN, CHAIN_NOTE, PATTERN_TRIAD, STEPS,
  VIDEO_HEADING, VIDEO_NOTE, INSIDE, INSIDE_HEADING,
  OFFER, NLP_COURSE, AUTHOR, SECTION_TITLES, FINAL_CTA, TESTIMONIAL_HEADING, AUDIO_HEADING,
} from "./content";
import type { LandingSettings, Testimonial } from "@/lib/types/landing";

/** Problem icons, keyed by the name in content.ts. */
const ICONS: Record<string, typeof Target> = {
  target: Target, repeat: Repeat, users: Users, frown: Frown,
  userStar: UserCheck, brain: Brain, heart: Heart, cloud: CloudRain,
};

const STEP_ICONS = [Search, Lightbulb, PencilLine];

/** The flag as a dot — no emoji font to depend on. Ring colour comes from the caller. */
function FlagDot({ className = "w-3.5 h-3.5" }: { className?: string }) {
  return (
    <span
      className={`inline-flex flex-col rounded-full overflow-hidden flex-shrink-0 ring-1 ${className}`}
      aria-hidden="true"
    >
      <span className="flex-1 bg-[#FF9933]" />
      <span className="flex-1 bg-white" />
      <span className="flex-1 bg-[#138808]" />
    </span>
  );
}

/**
 * A tricolour sash behind the book cover.
 *
 * Sits behind the image rather than over it, so only the two ends show past
 * the edges of the cover — the artwork and the title stay untouched, and the
 * book still reads as the thing being sold.
 *
 * Out with the rest of the campaign once August 15 has passed.
 */
function FlagRibbon() {
  return (
    <div
      // Wider than the book on both sides so the ends emerge; the negative
      // inset is a share of the book's own width, so it stays proportional
      // between the mobile and desktop sizes rather than needing two values.
      className="absolute inset-x-[-30%] top-1/2 -translate-y-1/2 -rotate-12 rounded-full overflow-hidden shadow-lg"
      aria-hidden="true"
    >
      <span className="block h-2.5 sm:h-3 bg-[#FF9933]" />
      {/* Pure white would vanish on the light theme, so the middle band is the
          same near-white the strip at the top of the page uses. */}
      <span className="block h-2.5 sm:h-3 bg-neutral-100 dark:bg-neutral-200" />
      <span className="block h-2.5 sm:h-3 bg-[#138808]" />
    </div>
  );
}

/** The celebration lands and then gets out of the way. */
const GLITTER_RUN_SECONDS = 30;

/**
 * The flakes, laid out by arithmetic rather than chance.
 *
 * Math.random() here would pick different values on the server and in the
 * browser, and React would tear the whole page down over the hydration
 * mismatch. These multipliers are coprime with the flake count, so positions
 * and delays keep cycling out of step and the fall never looks like a pattern.
 */
const GLITTER = Array.from({ length: 26 }, (_, i) => {
  /** Staggered so they don't all enter at once on first paint. */
  const delaySeconds = ((i * 17) % 100) / 10;
  const fallSeconds = 9 + ((i * 7) % 7);

  // Whole falls only, so every flake finishes on the last keyframe — which is
  // off the bottom at zero opacity. Ending mid-fall would leave it hanging in
  // the middle of the page.
  const falls = Math.max(
    1,
    Math.floor((GLITTER_RUN_SECONDS - delaySeconds) / fallSeconds)
  );

  return {
    leftPercent: (i * 27 + (i % 4) * 6) % 100,
    delaySeconds,
    fallSeconds,
    falls,
    // The drift cycles three times per fall, so this many keeps the two
    // animations stopping together.
    drifts: falls * 3,
    driftPx: 10 + ((i * 11) % 16),
    widthPx: 3 + (i % 3),
    heightPx: 7 + (i % 4),
    band: i % 3,
  };
});

/** White needs a hairline on a white page; on dark it can stand alone. */
const GLITTER_BANDS = [
  "bg-[#FF9933]",
  "bg-white ring-1 ring-neutral-300 dark:ring-0",
  "bg-[#138808]",
];

/**
 * Independence Day glitter, falling the height of the page.
 *
 * Fixed to the viewport rather than the page, so it keeps falling all the way
 * down instead of running out below the fold. It sits in front of the content
 * because every section here has an opaque background — behind them there would
 * be nothing to see — and stays small and semi-transparent so it reads as
 * atmosphere rather than something covering the words.
 *
 * Runs for the first 30 seconds and then stops for good. Someone reading a long
 * sales page shouldn't have confetti in their eyes at the tenth minute, and it
 * means the page isn't animating anything while they're deciding to buy.
 *
 * Take it out with the rest of the campaign once August 15 has passed.
 */
function IndependenceDayGlitter() {
  return (
    // z-5 keeps it under the sticky order bar at z-40: the price and the button
    // are what the page is for, and nothing decorative goes in front of them.
    <div
      className="glitter-layer fixed inset-0 z-[5] overflow-hidden pointer-events-none"
      aria-hidden="true"
    >
      {GLITTER.map((flake, i) => (
        <span
          key={i}
          className="glitter-fall absolute top-0"
          style={
            {
              left: `${flake.leftPercent}%`,
              "--duration": `${flake.fallSeconds}s`,
              "--delay": `${flake.delaySeconds}s`,
              "--falls": flake.falls,
            } as CSSProperties
          }
        >
          {/* --delay inherits from the parent, so the drift starts with the fall. */}
          <span
            className={`glitter-drift block rounded-[1px] opacity-60 ${GLITTER_BANDS[flake.band]}`}
            style={
              {
                width: `${flake.widthPx}px`,
                height: `${flake.heightPx}px`,
                "--drift": `${flake.driftPx}px`,
                "--drift-duration": `${flake.fallSeconds / 3}s`,
                "--drifts": flake.drifts,
              } as CSSProperties
            }
          />
        </span>
      ))}
    </div>
  );
}

/**
 * The Neuro Code landing page.
 *
 * Mobile-first, because that is where essentially all the traffic is: one
 * column throughout, thumb-sized targets, and a sticky order bar so the price
 * and the button stay reachable anywhere down a long page.
 *
 * Malayalam is the primary language; English survives only where it's the word
 * people actually use (NLP, Overthinking, COD, Order Now). Line height is
 * deliberately loose — Malayalam conjuncts are tall and collide at the leading
 * Latin text gets away with.
 *
 * Written for both themes rather than dark-only with a light patch bolted on:
 * the site defaults to light, the reference design was drawn in dark, and both
 * should look deliberate.
 */
export default function NeuroCodeLanding({
  pricing,
  testimonials,
  settings,
}: {
  pricing: ProductPricing;
  /** Live testimonials from /admin/landing, already filtered and ordered. */
  testimonials: Testimonial[];
  settings: LandingSettings;
}) {
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const byKind = (kind: Testimonial["kind"]) => testimonials.filter((t) => t.kind === kind);
  const showPlaceholders = settings.show_placeholders;
  const explainerId = settings.explainer_youtube_id;
  const explainerUrl = settings.explainer_video_url;
  const videoLength = settings.explainer_length;

  useEffect(() => {
    trackViewContent(pricing.payable);
  }, [pricing.payable]);

  const order = () => trackInitiateCheckout(pricing.payable);
  const saving = OFFER.mrpRupees - pricing.payable;

  const support = (process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP || "916282680794").replace(/\D/g, "");
  const whatsappHref = `https://wa.me/${support}?text=${encodeURIComponent(
    "Neuro Code പുസ്തകത്തെക്കുറിച്ച് അറിയാൻ താൽപ്പര്യമുണ്ട്."
  )}`;

  return (
    <div className="min-h-screen bg-white dark:bg-neutral-950 text-neutral-900 dark:text-white font-malayalam-bold overflow-x-hidden pb-36 lg:pb-0">
      <IndependenceDayGlitter />

      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <section className="relative px-5 pt-8 pb-12">
        {/* Independence Day — the flag as a strip across the very top, the
            middle band a whisper on light, clear on dark. */}
        <div className="absolute top-0 inset-x-0 h-1.5 grid grid-cols-3" aria-hidden="true">
          <span className="bg-[#FF9933]" />
          <span className="bg-neutral-100 dark:bg-neutral-200" />
          <span className="bg-[#138808]" />
        </div>
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[420px] h-[420px] bg-primary-500/20 dark:bg-primary-500/15 rounded-full blur-[110px] pointer-events-none" />
        {/* Saffron and green breathing at the edges — the flag carried into
            the hero's glow, faint enough to stay a backdrop. */}
        <div className="absolute top-10 -left-24 w-56 h-56 bg-[#FF9933]/15 dark:bg-[#FF9933]/10 rounded-full blur-[90px] pointer-events-none" />
        <div className="absolute top-24 -right-24 w-56 h-56 bg-[#138808]/15 dark:bg-[#138808]/10 rounded-full blur-[90px] pointer-events-none" />

        <div className="relative max-w-lg mx-auto text-center">
          <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-neutral-200 dark:border-neutral-700 text-neutral-800 dark:text-neutral-200 text-[11px] font-black font-anek">
            <FlagDot className="w-3.5 h-3.5 ring-neutral-300 dark:ring-neutral-600" />
            {INDEPENDENCE_DAY.greeting} · {INDEPENDENCE_DAY.date}
          </span>

          <h1 className="text-[30px] leading-[1.08] sm:text-[42px] font-black mt-5 tracking-tight">
            <span className="block">{HERO.headline}</span>
            <span className="block text-primary-500">{HERO.headlineAccent}</span>
          </h1>

          <span className="inline-block mt-3 text-[11px] font-bold tracking-widest uppercase text-primary-600 dark:text-primary-400">
            {EDITION}
          </span>

          <div className="relative w-44 sm:w-52 mx-auto my-7">
            <div className="absolute -inset-4 bg-primary-500/25 blur-3xl rounded-full" />
            {/* Between the glow and the cover: painted over the blur, under the
                book, which is `relative` and so wins on DOM order. */}
            <FlagRibbon />
            <Image
              src="/images/book_front.png"
              alt="Neuro Code — ന്യൂറോ കോഡ്, ബിഷർ കെ.സി."
              width={488}
              height={672}
              priority
              className="relative w-full h-auto rounded-lg shadow-2xl"
            />
          </div>

          <p className="font-anek text-[18px] font-bold leading-[2] whitespace-pre-line text-neutral dark:text-neutral-300">
            {HERO.sub}
          </p>

          <div className="flex items-center justify-center gap-2 mt-6">
            <div className="flex gap-0.5">
              {[...Array(5)].map((_, i) => (
                <Star key={i} className="w-4 h-4 fill-primary-500 text-primary-500" />
              ))}
            </div>
            <span className="font-bold">{HERO.rating}</span>
            <span className="text-neutral-500 dark:text-neutral-400 text-sm">· {HERO.readers}</span>
          </div>

          {/* Free video course — the hook that sells the book, framed as the
              Independence Day campaign: a tricolor edge, saffron badge, green
              FREE stamp. The mechanics of the offer don't change, the dress
              does. */}
          <div className="relative mt-7 rounded-2xl p-[2px] bg-gradient-to-br from-[#FF9933] via-neutral-200 dark:via-neutral-700 to-[#138808]">
            <div className="relative rounded-[14px] bg-gradient-to-br from-orange-50 via-white to-green-50 dark:from-[#FF9933]/10 dark:via-neutral-950 dark:to-[#138808]/10 p-4 overflow-hidden">
              <span className="pointer-events-none absolute inset-y-0 left-0 w-1/4 bg-gradient-to-r from-transparent via-white/70 dark:via-white/5 to-transparent skew-x-12 animate-shimmer" />
              <div className="flex items-center gap-3">
                <span className="relative flex-shrink-0 flex items-center justify-center w-11 h-11 rounded-full bg-primary-500 animate-glow-pulse">
                  <Gift className="w-5 h-5 text-white" />
                </span>
                <div className="text-left min-w-0">
                  <span className="inline-block px-2 py-0.5 rounded bg-[#FF9933] text-white text-[10px] font-black font-anek">
                    {INDEPENDENCE_DAY.offerBadge}
                  </span>
                  <p className="font-black text-[15px] mt-1 leading-tight">
                    {OFFER.bonusTitle}
                  </p>
                  <p className="text-primary-700 dark:text-primary-400 text-[12px] font-semibold mt-0.5">
                    {NLP_COURSE.modules} Modules · {NLP_COURSE.videos} Videos · 30 Days
                  </p>
                </div>
              </div>
              <p className="font-anek text-[13px] font-black text-neutral-900 dark:text-white bg-white/70 dark:bg-white/10 border border-primary-200 dark:border-white/10 rounded-xl px-3 py-1.5 mt-3 text-center shadow-sm">
                {INDEPENDENCE_DAY.offerLead}
              </p>
              <div className="grid grid-cols-2 gap-2 mt-3 text-center">
                {[
                  { icon: Play, label: "Video Lessons" },
                  { icon: Brain, label: "Practical NLP" },
                ].map((f) => (
                  <div key={f.label} className="rounded-lg bg-white/70 dark:bg-white/5 border border-primary-100 dark:border-white/10 py-2 px-1">
                    <f.icon className="w-4 h-4 text-primary-500 mx-auto" />
                    <p className="text-[10px] font-bold text-neutral-700 dark:text-neutral-300 mt-1">{f.label}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex justify-center gap-1 mt-6" aria-hidden="true">
            <span className="w-8 h-1 rounded-full bg-[#FF9933]" />
            <span className="w-8 h-1 rounded-full bg-neutral-200 dark:bg-neutral-600" />
            <span className="w-8 h-1 rounded-full bg-[#138808]" />
          </div>

          <p className="font-anek text-primary-600 dark:text-primary-400 text-sm font-bold mt-3 leading-relaxed">
            {HERO.cta}
          </p>

          <div className="mt-3 max-w-xs mx-auto">
            <OrderNow price={pricing.payable} onClick={order} showPrice />
          </div>

          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 mt-4 text-[11px] text-neutral-500 dark:text-neutral-400">
            <span className="flex items-center gap-1"><Truck className="w-3.5 h-3.5 text-green-600" /> Free delivery</span>
            <span className="flex items-center gap-1"><Wallet className="w-3.5 h-3.5" /> COD ലഭ്യം</span>
          </div>
        </div>
      </section>

      {/* ── PROBLEMS ─────────────────────────────────────────────────────── */}
      <Band tinted>
        <Heading {...PROBLEMS_HEADING} />
        <Rule />
        <p className="text-[14px] leading-[1.9] text-neutral-600 dark:text-neutral-400">
          {PROBLEMS_LEAD}
        </p>

        <Card glow className="mt-6 px-5 py-4 text-center">
          <p className="text-[15px] font-bold leading-[1.7]">
            {PROBLEMS_TITLE.line1}
            <span className="block text-primary-600 dark:text-primary-400">
              {PROBLEMS_TITLE.line2}
            </span>
          </p>
        </Card>

        <div className="space-y-2.5 mt-4">
          {PROBLEMS.map((p, i) => {
            const Icon = ICONS[p.icon] ?? Target;
            return (
              <Card key={i} className="flex items-center gap-3 px-3 py-3">
                <span className="w-11 h-11 rounded-full bg-primary-100 dark:bg-primary-500/10 border border-primary-200 dark:border-primary-500/20 flex items-center justify-center flex-shrink-0">
                  <Icon className="w-5 h-5 text-primary-600 dark:text-primary-400" />
                </span>
                <span className="text-primary-600 dark:text-primary-400 font-black text-lg tabular-nums">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="w-px self-stretch bg-neutral-200 dark:bg-white/10" />
                <p className="text-[13.5px] leading-[1.8] text-neutral-700 dark:text-neutral-300 flex-1">
                  {p.text}
                </p>
              </Card>
            );
          })}
        </div>

        <Card glow className="mt-5 px-5 py-4 text-center">
          <p className="text-[16px] font-black leading-[1.7]">
            {PROBLEMS_CLOSER.line1}
            <span className="block text-primary-600 dark:text-primary-400">
              {PROBLEMS_CLOSER.line2}
            </span>
          </p>
        </Card>

      </Band>

      {/* ── THE CHAIN ────────────────────────────────────────────────────── */}
      <Band>
        <Heading line1={CHAIN_HEADING.line1} accent={CHAIN_HEADING.accent} />
        <Rule />

        {/* Vertical, so it reads on a phone without pinching */}
        <div className="mt-2">
          {CODE_CHAIN.map((step, i) => (
            <div key={step.en}>
              <div className="rounded-xl border border-primary-300 dark:border-primary-500/40 bg-primary-50/60 dark:bg-primary-500/[0.06] py-3 px-4 text-center">
                <p className="font-black tracking-wide text-[15px]">{step.en}</p>
                <p className="text-neutral-500 dark:text-neutral-400 text-[11px] mt-0.5">{step.ml}</p>
              </div>
              {i < CODE_CHAIN.length - 1 && (
                <div className="flex justify-center py-1">
                  <ArrowDown className="w-4 h-4 text-primary-500" />
                </div>
              )}
            </div>
          ))}
        </div>

        <p className="text-[13.5px] leading-[1.9] text-neutral-600 dark:text-neutral-400 mt-6 text-center">
          {CHAIN_NOTE}
        </p>

        {/* Pattern. Pattern. Pattern. — the line the book turns on */}
        <div className="relative mt-6 px-6 py-5 text-center">
          <span className="absolute left-0 inset-y-0 w-3 border-y-2 border-l-2 border-primary-500 rounded-l-md" />
          <span className="absolute right-0 inset-y-0 w-3 border-y-2 border-r-2 border-primary-500 rounded-r-md" />
          {PATTERN_TRIAD.map((t) => (
            <p key={t} className="text-[17px] font-black leading-[1.9]">
              <span className="text-primary-600 dark:text-primary-400">Pattern</span> {t}
            </p>
          ))}
        </div>

        <div className="space-y-2.5 mt-6">
          {STEPS.map((s, i) => {
            const Icon = STEP_ICONS[i];
            return (
              <Card key={s.en} className="flex items-center gap-3 px-3 py-3.5">
                <span className="w-9 h-9 rounded-full bg-primary-500 text-white font-black text-xs flex items-center justify-center flex-shrink-0">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <Icon className="w-6 h-6 text-primary-600 dark:text-primary-400 flex-shrink-0" />
                <span className="w-px self-stretch bg-neutral-200 dark:bg-white/10" />
                <div className="flex-1">
                  <p className="text-primary-600 dark:text-primary-400 font-black text-[15px]">{s.en}</p>
                  <p className="text-neutral-600 dark:text-neutral-400 text-[12.5px] leading-[1.7] mt-0.5">
                    {s.ml}
                  </p>
                </div>
              </Card>
            );
          })}
        </div>

      </Band>

      {/* ── EXPLAINER VIDEO ──────────────────────────────────────────────── */}
      <Band tinted>
        <Heading line1={VIDEO_HEADING.line1} accent={VIDEO_HEADING.accent} />
        <Rule />
        <p className="text-[14px] leading-[1.9] text-neutral-600 dark:text-neutral-400">
          {VIDEO_HEADING.sub1}
          <span className="block text-primary-600 dark:text-primary-400 font-semibold">
            {VIDEO_HEADING.sub2}
          </span>
        </p>

        <div className="mt-5 rounded-2xl overflow-hidden border border-primary-300 dark:border-primary-500/30">
          {explainerId ? (
            <div className="relative aspect-video bg-black">
              <iframe
                className="absolute inset-0 w-full h-full"
                src={`https://www.youtube-nocookie.com/embed/${explainerId}`}
                title={`${VIDEO_HEADING.line1} ${VIDEO_HEADING.accent}`}
                loading="lazy"
                allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          ) : explainerUrl ? (
            /* Self-hosted on ImageKit rather than YouTube. */
            <video src={explainerUrl} controls playsInline className="w-full aspect-video bg-black" />
          ) : (
            /* Nothing set yet — show the frame so the layout is reviewable. */
            <div className="relative aspect-video bg-neutral-900 flex flex-col items-center justify-center gap-3">
              <span className="w-16 h-16 rounded-full bg-white/95 flex items-center justify-center shadow-xl">
                <Play className="w-7 h-7 text-primary-600 fill-primary-600 ml-1" />
              </span>
              <p className="text-neutral-400 text-xs">Admin → Landing page-ൽ വീഡിയോ ചേർക്കുക</p>
            </div>
          )}
        </div>

        <div className="flex items-start gap-3 mt-5">
          <Brain className="w-6 h-6 text-primary-500 flex-shrink-0 mt-0.5" />
          <p className="text-[13.5px] leading-[1.9] text-neutral-700 dark:text-neutral-300">
            {VIDEO_NOTE}
          </p>
        </div>

        {videoLength && (
          <div className="flex justify-center mt-4">
            <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-neutral-300 dark:border-white/15 text-xs text-neutral-600 dark:text-neutral-400">
              <Clock className="w-3.5 h-3.5 text-primary-500" />
              <span className="font-bold tabular-nums">{videoLength}</span> വീഡിയോ ദൈർഘ്യം
            </span>
          </div>
        )}

      </Band>

      {/* ── WHAT'S INSIDE ────────────────────────────────────────────────── */}
      <Band>
        <Heading line1={INSIDE_HEADING.line1} accent={INSIDE_HEADING.accent} />
        <Rule />
        <div className="space-y-2.5">
          {INSIDE.map((item) => (
            <Card key={item} className="flex items-start gap-3 px-4 py-3">
              <Check className="w-4 h-4 text-primary-500 flex-shrink-0 mt-1" />
              <p className="text-[13.5px] leading-[1.9] text-neutral-700 dark:text-neutral-300">
                {item}
              </p>
            </Card>
          ))}
        </div>
      </Band>

      {/* ── VIDEO / IMAGE / TEXT TESTIMONIALS ────────────────────────────── */}
      <Band tinted>
        <Heading line1={TESTIMONIAL_HEADING.line1} accent={TESTIMONIAL_HEADING.accent} />
        <Rule />
        <p className="text-[14px] text-neutral-600 dark:text-neutral-400">
          {TESTIMONIAL_HEADING.sub}
        </p>

        <div className="mt-5 space-y-6">
          <VideoTestimonials
            items={byKind("video")}
            showPlaceholders={showPlaceholders}
          />

          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 mb-3">
              {SECTION_TITLES.image}
            </p>
            <ImageTestimonials
              items={byKind("image")}
              showPlaceholders={showPlaceholders}
            />
          </div>

          <TextTestimonials items={byKind("text")} />
        </div>

      </Band>

      {/* ── AUDIO TESTIMONIALS ───────────────────────────────────────────── */}
      <Band>
        <Heading line1={AUDIO_HEADING.line1} accent={AUDIO_HEADING.accent} />
        <Rule />
        <p className="text-[14px] leading-[1.9] text-neutral-600 dark:text-neutral-400">
          {AUDIO_HEADING.sub}
        </p>

        <div className="mt-5">
          <AudioTestimonials
            items={byKind("audio")}
            showPlaceholders={showPlaceholders}
          />
        </div>

        <div className="flex items-center gap-3 my-6">
          <span className="flex-1 h-px bg-neutral-200 dark:bg-white/10" />
          <span className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
            <Headphones className="w-4 h-4 text-primary-500" /> {SECTION_TITLES.audio}
          </span>
          <span className="flex-1 h-px bg-neutral-200 dark:bg-white/10" />
        </div>
      </Band>

      {/* ── AUTHOR ───────────────────────────────────────────────────────── */}
      <Band tinted>
        <div className="text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-primary-600 dark:text-primary-400">
            {SECTION_TITLES.author}
          </p>
          <div className="relative w-28 h-28 mx-auto rounded-full overflow-hidden ring-2 ring-primary-500 mt-4">
            <Image src={AUTHOR.image} alt={AUTHOR.name} fill className="object-cover" sizes="112px" />
          </div>
          <p className="font-black text-xl mt-4">{AUTHOR.name}</p>
          <p className="text-primary-600 dark:text-primary-400 text-xs font-semibold mt-0.5">
            {AUTHOR.role}
          </p>
          <div className="relative mt-5">
            <Quote className="w-6 h-6 text-primary-500/40 mx-auto mb-2" />
            <p className="text-neutral-700 dark:text-neutral-300 text-[14px] leading-[2]">
              {AUTHOR.quote}
            </p>
          </div>
        </div>
      </Band>

      {/* ── OFFER ────────────────────────────────────────────────────────── */}
      <Band id="offer">
        <div className="text-center">
          <span className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full border-2 border-primary-500 text-primary-600 dark:text-primary-400 text-[11px] font-black tracking-widest">
            <Clock className="w-3.5 h-3.5" /> {OFFER.badge}
          </span>
          <h2 className="text-[30px] leading-[1.1] font-black mt-4 tracking-tight">
            {OFFER.titleTop}
            <span className="block text-primary-500 text-[22px] mt-1">{OFFER.titleAccent}</span>
          </h2>
        </div>

        <Card glow className="mt-6 p-5">
          <div className="flex items-center gap-4">
            <div className="relative w-24 flex-shrink-0">
              <Image
                src="/images/book_front.png"
                alt="Neuro Code"
                width={488}
                height={672}
                className="w-full h-auto rounded shadow-lg"
              />
            </div>
            <div className="flex-1 text-center">
              <p className="font-black text-[13px] leading-tight">{OFFER.bookLine}</p>
              <p className="text-primary-500 font-black text-lg leading-none my-1">+</p>
              <p className="font-black text-[13px] leading-tight">{OFFER.courseLine}</p>

              <p className="text-neutral-400 line-through text-lg mt-3 relative inline-block">
                ₹{OFFER.mrpRupees}
              </p>
              <p className="text-primary-500 font-black text-5xl leading-none">
                ₹{pricing.payable}
              </p>
              {saving > 0 && (
                <span className="inline-block mt-2 px-3 py-1 rounded-full border border-green-500/40 bg-green-500/10 text-green-600 dark:text-green-400 text-xs font-bold">
                  Save ₹{saving.toLocaleString("en-IN")}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center justify-center gap-2 mt-5 py-3 rounded-xl border border-green-500/30 bg-green-500/5 text-green-600 dark:text-green-400 text-sm font-bold">
            <Truck className="w-5 h-5" /> {OFFER.delivery}
          </div>
        </Card>

        {/* Free bonus */}
        <Card glow className="mt-3 p-5 flex gap-4">
          <span className="w-14 h-14 rounded-full bg-primary-100 dark:bg-primary-500/10 border border-primary-300 dark:border-primary-500/30 flex items-center justify-center flex-shrink-0">
            <Gift className="w-7 h-7 text-primary-500" />
          </span>
          <div className="min-w-0">
            <span className="inline-block px-2 py-0.5 rounded border border-primary-500 text-primary-600 dark:text-primary-400 text-[10px] font-black tracking-wider">
              FREE BONUS
            </span>
            <p className="font-black text-lg mt-1.5">{OFFER.bonusTitle}</p>
            <p className="text-primary-600 dark:text-primary-400 text-xs font-semibold">
              {OFFER.bonusMeta}
            </p>
            <p className="text-neutral-600 dark:text-neutral-400 text-[12.5px] leading-[1.7] mt-1.5">
              {OFFER.bonusBody}
            </p>
          </div>
        </Card>

        {/* COD */}
        <Card className="mt-3 p-4 flex gap-3 items-center">
          <Wallet className="w-7 h-7 text-neutral-400 flex-shrink-0" />
          <div>
            <p className="font-bold text-[15px] text-neutral-700 dark:text-neutral-300">
              {OFFER.codTitle}
            </p>
            <p className="text-neutral-500 dark:text-neutral-400 text-[12.5px] leading-[1.7]">
              {OFFER.codNote}
            </p>
          </div>
        </Card>

        <p className="flex items-center justify-center gap-2 text-[12px] text-neutral-500 dark:text-neutral-400 mt-5">
          <ShieldCheck className="w-4 h-4 text-primary-500" /> {OFFER.trust}
        </p>

        {/* The author's own disclaimer, kept prominent rather than buried */}
        <p className="text-center text-neutral-500 dark:text-neutral-400 text-[13px] leading-[1.9] mt-6 px-2">
          {OFFER.warning}
        </p>

        <a
          href={whatsappHref}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 w-full mt-4 py-3.5 rounded-full border border-green-500/40 bg-green-500/10 text-green-600 dark:text-green-400 text-sm font-bold"
        >
          <MessageCircle className="w-4 h-4" /> WhatsApp-ൽ ചോദിക്കൂ
        </a>
      </Band>

      {/* ── FAQ ──────────────────────────────────────────────────────────── */}
      <Band tinted>
        <Heading accent={SECTION_TITLES.faq} center />
        <div className="space-y-2.5 mt-5">
          {faqs.map((faq, i) => (
            <Card key={i} className="overflow-hidden">
              <button
                onClick={() => setOpenFaq(openFaq === i ? null : i)}
                className="w-full flex items-center justify-between gap-3 px-4 py-4 text-left"
              >
                <span className="text-[14px] font-bold leading-[1.7]">{faq.q}</span>
                {openFaq === i ? (
                  <ChevronUp className="w-4 h-4 text-primary-500 flex-shrink-0" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-neutral-400 flex-shrink-0" />
                )}
              </button>
              {openFaq === i && (
                <p className="px-4 pb-4 text-[13.5px] leading-[2] text-neutral-600 dark:text-neutral-300">
                  {faq.a}
                </p>
              )}
            </Card>
          ))}
        </div>
      </Band>

      {/* ── FINAL CTA ────────────────────────────────────────────────────── */}
      <Band>
        <div className="text-center">
          <Heading line1={FINAL_CTA.line1} accent={FINAL_CTA.accent} center />
          <p className="text-neutral-500 dark:text-neutral-400 text-sm mt-3 leading-relaxed">
            {FINAL_CTA.sub}
          </p>
          <a
            href="#offer"
            className="inline-flex items-center gap-2 mt-5 text-primary-600 dark:text-primary-400 text-sm font-bold hover:underline"
          >
            <Gift className="w-4 h-4" /> ഓഫർ കാണൂ ↓
          </a>
        </div>
      </Band>

      {/* ── STICKY BAR ───────────────────────────────────────────────────── */}
      {/* Mobile only; the page reserves pb-36 so it can't cover the last CTA. */}
      <div className="fixed bottom-0 inset-x-0 z-40 lg:hidden border-t border-neutral-200 dark:border-white/10 bg-white/95 dark:bg-neutral-950/95 backdrop-blur-md pb-[env(safe-area-inset-bottom)]">
        {/* The flag at the bar's top edge, mirroring the hero. */}
        <div className="h-1 grid grid-cols-3" aria-hidden="true">
          <span className="bg-[#FF9933]" />
          <span className="bg-neutral-100 dark:bg-neutral-200" />
          <span className="bg-[#138808]" />
        </div>
        {/* Campaign strip: the free course is what closes, not a price. */}
        <a
          href="#offer"
          className="relative flex items-center gap-2 px-3.5 py-2 bg-gradient-to-r from-[#FF9933] to-[#138808] text-white text-[11px] font-bold overflow-hidden"
        >
          <span className="pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/30 to-transparent skew-x-12 animate-shimmer" />
          <FlagDot className="relative w-5 h-5 ring-white/50" />
          <span className="relative truncate">
            {INDEPENDENCE_DAY.offerBadge} — ₹{OFFER.mrpRupees}-ന്റെ NLP Video Course <span className="underline underline-offset-2">സൗജന്യം</span>
          </span>
        </a>
        <div className="flex items-stretch gap-2 px-3 py-2.5 max-w-lg mx-auto">
          <a
            href="#offer"
            className="flex flex-col items-center justify-center px-4 py-2 rounded-xl border border-neutral-300 dark:border-white/15"
          >
            <span className="text-[10px] text-neutral-400 leading-none line-through">
              ₹{OFFER.mrpRupees}
            </span>
            <span className="text-sm font-black leading-tight mt-0.5">OFFERS</span>
          </a>
          <a
            href="/neuro-code/checkout"
            onClick={order}
            className="group relative flex-1 flex items-center justify-center gap-2 overflow-hidden rounded-xl bg-gradient-to-r from-[#FF9933] to-primary-600 active:scale-[0.97] text-white font-black transition-all shadow-lg shadow-primary-500/40 animate-glow-pulse"
          >
            <span className="pointer-events-none absolute inset-y-0 left-0 w-1/4 bg-gradient-to-r from-transparent via-white/50 to-transparent skew-x-12 animate-shimmer" />
            <span className="relative flex items-center gap-2">
              <FlagDot className="w-4 h-4 ring-white/50" />
              Order Now — ₹{pricing.payable}
              <ArrowDown className="w-4 h-4 rotate-[-90deg] group-hover:translate-x-1 transition-transform" />
            </span>
          </a>
        </div>
      </div>
    </div>
  );
}

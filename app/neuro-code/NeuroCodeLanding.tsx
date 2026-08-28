"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import {
  Star, Check, ChevronDown, ChevronUp, ArrowDown, Play, Clock,
  Truck, Wallet, Gift, ShieldCheck, MessageCircle, Headphones,
  Target, Repeat, Users, Frown, UserCheck, Brain, Heart, CloudRain,
  Search, Lightbulb, PencilLine, Quote, BookOpen, Zap, CalendarClock,
} from "lucide-react";
import type { ProductPricing } from "@/lib/db/courses";
import { trackViewContent, trackInitiateCheckout } from "@/lib/pixel";
import { gaViewItem, gaBeginCheckout } from "@/lib/analytics";
import { buildFaqs } from "./faqs";
import Pookalam from "./Pookalam";
import { Band, Card, Heading, OrderNow, Rule } from "./ui";
import { CountdownBoxes, CountdownClock, useCountdown } from "./Countdown";
import {
  VideoTestimonials, ImageTestimonials, AudioTestimonials, TextTestimonials,
} from "./Testimonials";
import {
  EDITION, HERO, PREORDER, withDay,
  PROBLEMS, PROBLEMS_HEADING, PROBLEMS_LEAD, PROBLEMS_TITLE,
  PROBLEMS_CLOSER, CHAIN_HEADING, CODE_CHAIN, CHAIN_NOTE, PATTERN_TRIAD, STEPS,
  VIDEO_HEADING, VIDEO_NOTE, INSIDE, INSIDE_HEADING,
  OFFER, ONAM, NLP_COURSE, AUTHOR, SECTION_TITLES, FINAL_CTA, TESTIMONIAL_HEADING, AUDIO_HEADING,
} from "./content";
import type { LandingSettings, Testimonial } from "@/lib/types/landing";

/** Problem icons, keyed by the name in content.ts. */
const ICONS: Record<string, typeof Target> = {
  target: Target, repeat: Repeat, users: Users, frown: Frown,
  userStar: UserCheck, brain: Brain, heart: Heart, cloud: CloudRain,
};

const STEP_ICONS = [Search, Lightbulb, PencilLine];

/** The flag as a dot — no emoji font to depend on. Ring colour comes from the caller. */
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
/**
 * The pre-booking campaign, decided on the server and handed down.
 *
 * `live` is a comparison against the clock, so the browser must not work it out
 * for itself: a reader loading the page across Saturday midnight would get one
 * answer from the server and another from React, and the mismatch would land on
 * the single most important line of copy on the page.
 */
export type Campaign = {
  live: boolean;
  /** The instant the launch price stops, as epoch ms — what the clock counts to. */
  endsAt: number;
  /** How far off that was when the server rendered, so the first tick matches the HTML. */
  remainingMs: number;
  /** "Saturday" / "ശനിയാഴ്ച" — the deadline, in both languages. */
  day: string;
  dayMl: string;
  /** "22 Aug" — the same deadline as a date. */
  date: string;
  /** "1 Sept" — when a pre-order placed now should arrive. */
  arrivesBy: string;
  deliveryDays: number;
};

export default function NeuroCodeLanding({
  pricing,
  testimonials,
  settings,
  campaign,
  onam,
}: {
  pricing: ProductPricing;
  /** Live testimonials from /admin/landing, already filtered and ordered. */
  testimonials: Testimonial[];
  settings: LandingSettings;
  campaign: Campaign;
  /** Whether the Onam band is in season. Decided on the server — see lib/onam.ts. */
  onam: { live: boolean };
}) {
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  // Same deadline the countdown below is built from — the FAQ answer about how
  // long this price lasts names the day, and naming a different one than the
  // clock on the same page is the kind of contradiction people screenshot.
  const faqs = buildFaqs(campaign.dayMl);

  // The clock, seeded from the server's measurement (see Countdown.tsx).
  const left = useCountdown(campaign.endsAt, campaign.remainingMs);

  // One flag for every piece of deadline framing on the page, so they all go at
  // the same instant. `campaign.live` is the server's answer and settles what
  // renders first; `left.over` is what happens to somebody who had the page
  // open when the clock ran out — the boxes hitting 00:00:00 while the copy
  // beside them still promises a deadline is worse than never having shown a
  // clock at all.
  const offerLive = campaign.live && !left.over;

  const byKind = (kind: Testimonial["kind"]) => testimonials.filter((t) => t.kind === kind);
  const showPlaceholders = settings.show_placeholders;
  const explainerId = settings.explainer_youtube_id;
  const explainerUrl = settings.explainer_video_url;
  const videoLength = settings.explainer_length;

  // Both ad platforms get the same two signals. Meta optimises delivery on
  // them; Google needs them to report the funnel and to run them as Ads
  // conversions. Either call is a no-op if that platform's tag isn't loaded.
  useEffect(() => {
    trackViewContent(pricing.payable);
    gaViewItem(pricing.payable);
  }, [pricing.payable]);

  const order = () => {
    trackInitiateCheckout(pricing.payable);
    gaBeginCheckout(pricing.payable);
  };
  const saving = OFFER.mrpRupees - pricing.payable;

  const support = (process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP || "916282680794").replace(/\D/g, "");
  const whatsappHref = `https://wa.me/${support}?text=${encodeURIComponent(
    "Neuro Code പുസ്തകത്തെക്കുറിച്ച് അറിയാൻ താൽപ്പര്യമുണ്ട്."
  )}`;

  return (
    <div className="min-h-screen bg-white dark:bg-neutral-950 text-neutral-900 dark:text-white font-malayalam-bold overflow-x-hidden pb-36 lg:pb-0">
      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <section className="relative px-5 pt-8 pb-12">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[420px] h-[420px] bg-primary-500/20 dark:bg-primary-500/15 rounded-full blur-[110px] pointer-events-none" />

        <div className="relative max-w-lg mx-auto text-center">
          {/* The edition badge, above everything.
              It is the fact that explains every other change on this page: why
              there is a wait, why the price has a deadline, why the button says
              pre-book. A reader who meets "12 days" further down without having
              met this first reads it as slow delivery rather than as a book
              still on the press. */}
          <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-primary-300 dark:border-primary-500/40 bg-primary-500/10 text-primary-700 dark:text-primary-300 text-[11px] font-black font-anek">
            <BookOpen className="w-3.5 h-3.5" />
            {EDITION} — {PREORDER.badge}
          </span>

          <p className="font-anek text-[11px] font-bold text-neutral-400 dark:text-neutral-500 mt-1.5">
            {PREORDER.readers}
          </p>

          <h1 className="text-[30px] leading-[1.08] sm:text-[42px] font-black mt-5 tracking-tight">
            <span className="block">{HERO.headline}</span>
            <span className="block text-primary-500">{HERO.headlineAccent}</span>
          </h1>

          <div className="relative w-44 sm:w-52 mx-auto my-7">
            <div className="absolute -inset-4 bg-primary-500/25 blur-3xl rounded-full" />
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

          {/* The free course, now carrying more weight than it used to.
              It was a bonus on a book that shipped in a week; on a pre-order it
              is the whole of what arrives today, and it is the answer to the
              only real objection — "so I pay now and get nothing for a
              fortnight?". Hence the INSTANT stamp rather than a FREE one:
              free was never in doubt, immediate is. */}
          <div className="relative mt-7 rounded-2xl p-[2px] bg-gradient-to-br from-primary-400 via-primary-200 dark:via-primary-500/30 to-primary-500">
            <div className="relative rounded-[14px] bg-gradient-to-br from-primary-50 via-white to-primary-50 dark:from-primary-500/10 dark:via-neutral-950 dark:to-primary-500/10 p-4 overflow-hidden">
              <span className="pointer-events-none absolute inset-y-0 left-0 w-1/4 bg-gradient-to-r from-transparent via-white/70 dark:via-white/5 to-transparent skew-x-12 animate-shimmer" />
              <div className="flex items-center gap-3">
                <span className="relative flex-shrink-0 flex items-center justify-center w-11 h-11 rounded-full bg-primary-500 shadow-md shadow-primary-500/40">
                  <Gift className="w-5 h-5 text-white" />
                </span>
                <div className="text-left min-w-0">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-green-600 text-white text-[10px] font-black font-anek">
                    <Zap className="w-3 h-3" /> {PREORDER.instantTitle}
                  </span>
                  <p className="font-black text-[15px] mt-1 leading-tight">
                    {OFFER.bonusTitle}
                  </p>
                  {/* The three numbers are what make the free course feel like
                      a real product, so they get pills instead of a grey
                      subtitle nobody stops on. */}
                  <div className="flex flex-wrap items-center gap-1 mt-1.5">
                    {[
                      `${NLP_COURSE.modules} Modules`,
                      `${NLP_COURSE.videos} Videos`,
                      `${NLP_COURSE.materials} Materials`,
                    ].map((stat) => (
                      <span
                        key={stat}
                        className="font-anek rounded-md border border-primary-300 dark:border-primary-400/30 bg-primary-500/15 dark:bg-primary-400/15 px-1.5 py-0.5 text-[11px] font-black text-primary-700 dark:text-primary-300"
                      >
                        {stat}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <p className="font-anek text-[13px] font-black text-neutral-900 dark:text-white bg-white/70 dark:bg-white/10 border border-primary-200 dark:border-white/10 rounded-xl px-3 py-1.5 mt-3 text-center shadow-sm">
                {PREORDER.offerLead}
              </p>
              <p className="font-anek text-[12px] leading-[1.8] text-neutral-600 dark:text-neutral-400 mt-2 text-center">
                {PREORDER.instantBody}
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

          {/* The deadline, and only while there is one. Past Saturday this
              disappears rather than going stale — a page still shouting about
              an offer that ended is the fastest way to stop being believed. */}
          {offerLive && (
            <div className="mt-6 rounded-xl border border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 px-4 py-3">
              <p className="font-anek text-[13px] font-black text-amber-900 dark:text-amber-300 flex items-center justify-center gap-1.5">
                <CalendarClock className="w-4 h-4" />
                {withDay(PREORDER.deadline, campaign.dayMl)}
              </p>
              {/* The same deadline as a number that moves. The words say which
                  day; the clock says how long — and only the second one is
                  hard to put off until later. */}
              <p className="font-anek text-[10.5px] font-bold uppercase tracking-[0.14em] text-amber-700/80 dark:text-amber-400/70 mt-2.5">
                {PREORDER.countdownLead}
              </p>
              <CountdownBoxes r={left} className="mt-1.5" />
              <p className="font-anek text-[11.5px] text-amber-700 dark:text-amber-400/90 mt-2.5">
                {withDay(PREORDER.deadlineNote, campaign.dayMl)}
              </p>
            </div>
          )}

          <p className="font-anek text-primary-600 dark:text-primary-400 text-sm font-bold mt-4 leading-relaxed">
            {HERO.cta}
          </p>

          {/* max-w-sm, not xs: the ₹999 → ₹699 comparison needs the width. */}
          <div className="mt-3 max-w-sm mx-auto">
            <OrderNow
              price={pricing.payable}
              onClick={order}
              showPrice
              comparePrice={OFFER.compareAtRupees}
            />
          </div>

          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 mt-4 text-[11px] text-neutral-500 dark:text-neutral-400">
            <span className="flex items-center gap-1"><Zap className="w-3.5 h-3.5 text-green-600" /> NLP കോഴ്സ് ഉടൻ</span>
            <span className="flex items-center gap-1"><Truck className="w-3.5 h-3.5 text-green-600" /> Free delivery</span>
            <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {campaign.deliveryDays} ദിവസത്തിനുള്ളിൽ</span>
          </div>
        </div>
      </section>

      {/* ── ONAM ─────────────────────────────────────────────────────────────
          Directly after the hero, and only during the season — lib/onam.ts
          decides, on the server, so the band cannot flicker in on hydration.

          Greeting first, offer second. A festival banner that opens with a
          discount is a shop using Onam; one that opens with ഓണാശംസകൾ is a shop
          wishing you Onam that also has a price. On a page this careful about
          tone, only the second is worth running.

          It deliberately does not restate the price card further down. Two
          different-looking prices on one page is how people stop trusting
          both — this sends them to the same offer rather than competing
          with it. */}
      {onam.live && (
        <section className="relative px-5 py-12 overflow-hidden border-y border-amber-300/50 dark:border-amber-500/20 bg-gradient-to-b from-amber-50 via-orange-50 to-white dark:from-amber-500/10 dark:via-orange-500/5 dark:to-neutral-950">
          {/* Two warm pools behind the card, echoing the hero's single one so
              the section reads as part of this page and not pasted onto it. */}
          <div className="pointer-events-none absolute -top-16 -left-16 w-64 h-64 rounded-full bg-amber-400/25 dark:bg-amber-500/10 blur-[90px]" />
          <div className="pointer-events-none absolute -bottom-20 -right-12 w-64 h-64 rounded-full bg-primary-500/20 dark:bg-primary-500/10 blur-[90px]" />

          <div className="relative max-w-lg mx-auto text-center">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-amber-400/70 dark:border-amber-500/40 bg-white/70 dark:bg-white/5 text-amber-800 dark:text-amber-300 text-[10px] font-black font-anek tracking-[0.18em]">
              {ONAM.eyebrow}
            </span>

            <div className="mt-5 flex items-center justify-center">
              <Pookalam className="w-28 h-28 sm:w-32 sm:h-32 drop-shadow-[0_6px_18px_rgba(180,83,9,0.28)] motion-safe:animate-[spin_60s_linear_infinite]" />
            </div>

            {/* The greeting, and the largest type in the band. */}
            <h2 className="mt-5 text-[34px] sm:text-[40px] leading-[1.15] font-black tracking-tight bg-gradient-to-b from-amber-600 to-primary-600 dark:from-amber-300 dark:to-primary-400 bg-clip-text text-transparent">
              {ONAM.greeting}
            </h2>

            <p className="font-anek mt-3 text-[14.5px] font-bold leading-[1.95] text-neutral-700 dark:text-neutral-300">
              {ONAM.wish}
            </p>

            <div className="mt-7 rounded-2xl p-[2px] bg-gradient-to-br from-amber-400 via-primary-300 dark:via-primary-500/40 to-primary-500">
              <div className="rounded-[14px] bg-white/90 dark:bg-neutral-950/90 backdrop-blur-sm p-5">
                <p className="font-anek text-[15px] font-black text-neutral-900 dark:text-white leading-snug">
                  {ONAM.bridge}
                </p>

                <p className="font-anek mt-2 text-[13px] font-bold text-neutral-600 dark:text-neutral-400 leading-relaxed">
                  {ONAM.offerLine}
                </p>

                <div className="mt-4 flex items-baseline justify-center gap-2.5">
                  <span className="text-neutral-400 line-through text-lg">
                    ₹{OFFER.mrpRupees}
                  </span>
                  <span className="text-primary-500 font-black text-[44px] leading-none">
                    ₹{pricing.payable}
                  </span>
                </div>

                {saving > 0 && (
                  <span className="inline-block mt-2.5 px-3 py-1 rounded-full bg-green-600 text-white text-[11px] font-black">
                    ₹{saving.toLocaleString("en-IN")} ലാഭം
                  </span>
                )}

                <ul className="mt-4 space-y-1.5 text-left">
                  {ONAM.perks.map((perk) => (
                    <li
                      key={perk}
                      className="font-anek flex items-start gap-2 text-[12.5px] font-bold text-neutral-700 dark:text-neutral-300"
                    >
                      <Check className="w-4 h-4 mt-0.5 flex-shrink-0 text-green-600 dark:text-green-400" />
                      {perk}
                    </li>
                  ))}
                </ul>

                <OrderNow
                  price={pricing.payable}
                  onClick={order}
                  label={ONAM.cta}
                  className="mt-5"
                />
              </div>
            </div>
          </div>
        </section>
      )}

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

          {/* The deadline sits inside the price card, not above it. This is the
              one place on the page where somebody is looking at ₹699 and
              deciding — telling them here that it moves on Saturday is
              information; telling them anywhere else is decoration. */}
          {offerLive && (
            <div className="mt-3 text-center">
              <p className="font-anek text-[12.5px] font-black text-amber-700 dark:text-amber-400 leading-[1.7]">
                {withDay(PREORDER.deadlineNote, campaign.dayMl)}
              </p>
              {/* One line rather than boxes: this sits directly under ₹699, and
                  a block of digits here would compete with the price it is
                  supposed to be putting a deadline on. */}
              <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-full border border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 px-3 py-1">
                <Clock className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                <span className="font-anek text-[11px] font-bold text-amber-700 dark:text-amber-400/90">
                  {PREORDER.countdownStrip}
                </span>
                <CountdownClock r={left} className="text-[14px] text-amber-900 dark:text-amber-300" />
              </p>
            </div>
          )}
        </Card>

        {/* ── What a pre-order actually means ──────────────────────────────
            Two cards, in this order, because they answer the two halves of the
            same worry: what do I get now, and when does the book come. Putting
            the wait first and the course second would be answering the harder
            question with nothing behind it. */}
        <div className="grid sm:grid-cols-2 gap-3 mt-3">
          <Card className="p-4">
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-green-600 text-white text-[10px] font-black font-anek">
              <Zap className="w-3 h-3" /> INSTANT
            </span>
            <p className="font-black text-[15px] mt-2">{PREORDER.instantTitle}</p>
            <p className="text-neutral-600 dark:text-neutral-400 text-[12.5px] leading-[1.8] mt-1">
              {PREORDER.instantBody}
            </p>
          </Card>

          <Card className="p-4">
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-neutral-200 dark:bg-white/10 text-neutral-700 dark:text-neutral-300 text-[10px] font-black font-anek">
              <Clock className="w-3 h-3" /> {campaign.deliveryDays} DAYS
            </span>
            <p className="font-black text-[15px] mt-2">{PREORDER.deliveryTitle}</p>
            <p className="text-neutral-600 dark:text-neutral-400 text-[12.5px] leading-[1.8] mt-1">
              {PREORDER.deliveryBody}
            </p>
            {/* A date, not a sum for the reader to do. */}
            <p className="font-anek text-[12px] font-bold text-neutral-500 dark:text-neutral-400 mt-2">
              ഇന്ന് ഓർഡർ ചെയ്താൽ ഏകദേശം <span className="text-neutral-900 dark:text-white">{campaign.arrivesBy}</span>-ന് എത്തും
            </p>
          </Card>
        </div>

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

        {/* Prepaid only. Stated as a consequence of the course being instant
            rather than as a rule — "no COD" on its own reads as distrust of the
            buyer, and this is not that: it is that a confirmed payment is what
            opens the course, and the course is what does not wait. */}
        <Card className="mt-3 p-4 flex gap-3 items-center">
          <Wallet className="w-7 h-7 text-neutral-400 flex-shrink-0" />
          <div>
            <p className="font-bold text-[15px] text-neutral-700 dark:text-neutral-300">
              {OFFER.prepaidTitle}
            </p>
            <p className="text-neutral-500 dark:text-neutral-400 text-[12.5px] leading-[1.7]">
              {OFFER.prepaidNote}
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
      {/* Opaque on purpose: a translucent background here needs backdrop-blur to
          stay readable, and a backdrop filter on a fixed element re-filters the
          viewport behind it on every scroll frame — the one thing guaranteed to
          make a long sales page stutter on a mid-range Android. At 95% opacity
          the blur was doing nothing visible anyway. */}
      <div className="fixed bottom-0 inset-x-0 z-40 lg:hidden border-t border-neutral-200 dark:border-white/10 bg-white dark:bg-neutral-950 pb-[env(safe-area-inset-bottom)]">
        {/* Campaign strip. On a pre-order the thing that closes is not the
            free course — it is that the course is not what you wait for. So the
            strip carries the deadline while there is one, and falls back to the
            course when the deadline has passed. */}
        <a
          href="#offer"
          className="relative flex items-center gap-2 px-3.5 py-2 bg-gradient-to-r from-primary-600 to-primary-500 text-white text-[11px] font-bold overflow-hidden"
        >
          <span className="pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/30 to-transparent skew-x-12 animate-shimmer" />
          {offerLive ? (
            <>
              <CalendarClock className="relative w-4 h-4 flex-shrink-0" />
              {/* The offer on the left, the clock pinned right. This strip is
                  the narrowest thing on the page, and the two halves want
                  different treatment: the words can be clipped on a 320px
                  screen, the digits never — a half-cut countdown is worse than
                  no countdown. Hence `truncate` on one and `flex-shrink-0` on
                  the other, rather than one line that shortens from the end. */}
              <span className="relative truncate">
                ₹{OFFER.mrpRupees}-ന്റെ NLP Course{" "}
                <span className="underline underline-offset-2">സൗജന്യം</span>
              </span>
              <span className="relative ml-auto flex items-baseline gap-1 flex-shrink-0 rounded-full bg-black/20 px-2 py-0.5">
                <span className="text-[9px] font-bold opacity-90">{PREORDER.countdownStrip}</span>
                <CountdownClock r={left} className="text-[12px] tracking-tight" />
              </span>
            </>
          ) : (
            <>
              <Gift className="relative w-4 h-4 flex-shrink-0" />
              <span className="relative">
                ₹{OFFER.mrpRupees}-ന്റെ NLP Video Course{" "}
                <span className="underline underline-offset-2">സൗജന്യം</span>
              </span>
            </>
          )}
        </a>
        {/* One full-width target. The old ₹3000 "OFFERS" box split the thumb's
            attention between two prices and left the buy button too narrow to
            show the ₹999 → ₹699 comparison, which is the thing that sells. */}
        <div className="px-3 py-2.5 max-w-lg mx-auto">
          <a
            href="/neuro-code/checkout"
            onClick={order}
            className="group relative flex w-full items-center justify-center overflow-hidden rounded-xl bg-gradient-to-r from-primary-500 to-primary-600 px-4 py-3.5 active:scale-[0.98] text-white font-black transition-transform shadow-lg shadow-primary-500/40"
          >
            <span className="pointer-events-none absolute inset-y-0 left-0 w-1/4 bg-gradient-to-r from-transparent via-white/50 to-transparent skew-x-12 animate-shimmer" />
            <span className="relative flex items-baseline gap-2">
              <span className="text-[16px]">Pre-book at</span>
              <span className="line-through decoration-white/70 text-white/70 text-[14px] font-semibold">
                ₹{OFFER.compareAtRupees}
              </span>
              <span className="text-[20px] leading-none">₹{pricing.payable}</span>
            </span>
            <span className="absolute right-3 w-8 h-8 rounded-full bg-white/95 flex items-center justify-center">
              <ArrowDown className="w-4 h-4 rotate-[-90deg] text-primary-600 group-hover:translate-x-0.5 transition-transform" />
            </span>
          </a>
        </div>
      </div>
    </div>
  );
}

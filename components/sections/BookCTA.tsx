import Link from "next/link";
import { ShoppingCart, Star, Zap, BookOpen } from "lucide-react";

const perks = [
  "Rewire limiting beliefs",
  "Decode your mindset",
  "Practical techniques",
];

export default function BookCTA() {
  return (
    <section className="relative overflow-hidden bg-neutral-50 dark:bg-neutral-950 border-b border-neutral-200 dark:border-neutral-800">
      {/* Ambient glow — top right */}
      <div className="pointer-events-none absolute -top-32 -right-32 w-[480px] h-[480px] rounded-full bg-primary-400/15 blur-3xl" />
      {/* Ambient glow — bottom left */}
      <div className="pointer-events-none absolute -bottom-24 -left-24 w-96 h-96 rounded-full bg-primary-500/10 blur-3xl" />

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14 md:py-16">
        <div className="flex flex-col md:flex-row items-center gap-8 lg:gap-14">

          {/* Book cover */}
          <div className="flex-shrink-0 relative">
            {/* Rotated card behind book */}
            <div className="absolute inset-0 scale-105 -rotate-3 rounded-2xl bg-gradient-to-br from-primary-400 to-primary-600 opacity-30 blur-sm" />
            <div className="relative w-44 md:w-52 aspect-[3/4] rounded-2xl overflow-hidden shadow-2xl ring-1 ring-neutral-900/10 dark:ring-white/10">
              <img
                src="/images/book_front.png"
                alt="Neuro Code Book"
                className="w-full h-full object-cover"
              />
            </div>
            {/* Rating badge */}
            <div className="absolute -bottom-3 -right-3 flex items-center gap-1.5 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white px-3 py-1.5 rounded-full text-xs font-semibold shadow-lg ring-1 ring-neutral-200 dark:ring-neutral-700">
              <Star className="w-3.5 h-3.5 text-yellow-400 fill-yellow-400" />
              4.9 Rated
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 text-center md:text-left">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-400 text-xs font-semibold mb-4 tracking-wide uppercase">
              <BookOpen className="w-3.5 h-3.5" />
              Bestselling Book
            </div>

            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-neutral-900 dark:text-white leading-tight mb-3">
              The{" "}
              <span className="text-primary-500 relative inline-block">
                Neuro Code
                {/* underline accent */}
                <span className="absolute left-0 -bottom-1 w-full h-1 rounded-full bg-primary-400/60" />
              </span>
            </h2>

            <p className="text-neutral-600 dark:text-neutral-400 text-base md:text-lg mb-5 max-w-lg mx-auto md:mx-0 leading-relaxed">
              Decode your internal programming, break free from limiting beliefs,
              and rewire your mind for lasting transformation.
            </p>

            {/* Perks row */}
            <ul className="flex flex-wrap justify-center md:justify-start gap-x-5 gap-y-2 mb-7">
              {perks.map((p) => (
                <li
                  key={p}
                  className="flex items-center gap-1.5 text-sm text-neutral-700 dark:text-neutral-300"
                >
                  <Zap className="w-3.5 h-3.5 text-primary-500 flex-shrink-0" />
                  {p}
                </li>
              ))}
            </ul>

            {/* CTA row */}
            <div className="flex flex-col sm:flex-row items-center justify-center md:justify-start gap-3">
              <Link
                href="/neuro-code/checkout"
                className="group inline-flex items-center gap-2.5 px-8 py-4 rounded-full bg-primary-500 hover:bg-primary-600 active:bg-primary-700 text-white font-bold text-base shadow-lg shadow-primary-500/30 transition-all duration-200 hover:shadow-primary-500/50 hover:-translate-y-0.5"
              >
                <ShoppingCart className="w-5 h-5 transition-transform group-hover:scale-110" />
                Buy Now — Get Your Copy
              </Link>

              <Link
                href="/neuro-code"
                className="inline-flex items-center gap-2 px-6 py-4 rounded-full border border-neutral-300 dark:border-neutral-600 text-neutral-700 dark:text-neutral-300 font-medium text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
              >
                Learn More
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

"use client";

import { ArrowRight, ShoppingCart } from "lucide-react";
import type { ReactNode } from "react";

/**
 * The bits of the design that repeat on every section.
 *
 * Both themes are first-class: light is the site default, dark is what the
 * reference design was drawn in. Rather than a dark page with a light patch
 * bolted on, each piece names both — `bg-white dark:bg-neutral-950` — so
 * neither looks like an afterthought.
 */

/** Orange rule with a trailing dot, under every section heading. */
export function Rule() {
  return (
    <span className="flex items-center gap-1.5 mt-3 mb-5">
      <span className="h-[3px] w-10 rounded-full bg-primary-500" />
      <span className="h-[3px] w-[3px] rounded-full bg-primary-500" />
    </span>
  );
}

/**
 * Two-tone heading: the first line in the foreground colour, the second in
 * orange. Malayalam gets extra leading — its conjuncts are tall enough to
 * collide at the line height Latin text gets away with.
 */
export function Heading({
  line1,
  accent,
  line2,
  center = false,
  className = "",
}: {
  line1?: string;
  accent?: string;
  line2?: string;
  center?: boolean;
  className?: string;
}) {
  return (
    <h2
      className={`text-[22px] sm:text-[26px] font-black leading-[1.45] tracking-tight text-neutral-900 dark:text-white ${
        center ? "text-center" : ""
      } ${className}`}
    >
      {line1 && <span className="block">{line1}</span>}
      {accent && <span className="block text-primary-500">{accent}</span>}
      {line2 && <span className="block">{line2}</span>}
    </h2>
  );
}

/**
 * The order button, repeated after every section.
 *
 * A cart glyph, the words, and a circled arrow — the shape people recognise as
 * "this is the buy button" without reading it. Full width on mobile because
 * that's a thumb target, not a mouse target.
 */
export function OrderNow({
  price,
  onClick,
  label = "Order Now",
  showPrice = false,
  className = "",
}: {
  price: number;
  onClick?: () => void;
  label?: string;
  showPrice?: boolean;
  className?: string;
}) {
  return (
    <a
      href="/neuro-code/checkout"
      onClick={onClick}
      className={`group relative flex items-center justify-center gap-3 w-full rounded-full bg-primary-500 hover:bg-primary-600 active:scale-[0.985] px-5 py-4 text-white font-black text-[17px] tracking-wide shadow-lg shadow-primary-500/30 transition-all ${className}`}
    >
      <ShoppingCart className="w-5 h-5 absolute left-5 opacity-90 hidden sm:block" />
      <span>
        {label}
        {showPrice ? ` — ₹${price}` : ""}
      </span>
      <span className="absolute right-3 w-8 h-8 rounded-full bg-white/95 flex items-center justify-center">
        <ArrowRight className="w-4 h-4 text-primary-600 group-hover:translate-x-0.5 transition-transform" />
      </span>
    </a>
  );
}

/** The bordered card used for every list item and panel. */
export function Card({
  children,
  className = "",
  glow = false,
}: {
  children: ReactNode;
  className?: string;
  glow?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border transition-colors ${
        glow
          ? "border-primary-300 dark:border-primary-500/30 bg-primary-50/60 dark:bg-primary-500/[0.06]"
          : "border-neutral-200 dark:border-white/10 bg-white dark:bg-neutral-900/60"
      } ${className}`}
    >
      {children}
    </div>
  );
}

/** Alternating section background, so bands are visible in both themes. */
export function Band({
  children,
  tinted = false,
  id,
}: {
  children: ReactNode;
  tinted?: boolean;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={`px-5 py-14 scroll-mt-4 ${
        tinted
          ? "bg-neutral-50 dark:bg-neutral-900/40 border-y border-neutral-200 dark:border-white/5"
          : ""
      }`}
    >
      <div className="max-w-lg mx-auto">{children}</div>
    </section>
  );
}

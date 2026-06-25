"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Lock,
  ArrowLeft,
  ShoppingCart,
  Phone,
  CheckCircle2,
  PlayCircle,
  FileText,
} from "lucide-react";

interface OutlineItem {
  title: string;
  videos: number;
  pdfs: number;
}

export default function CourseGate({
  slug,
  title,
  subtitle,
  description,
  outline,
  totalVideos,
  totalPdfs,
  price,
  offerPrice,
}: {
  slug: string;
  title: string;
  subtitle?: string | null;
  description?: string | null;
  outline: OutlineItem[];
  totalVideos: number;
  totalPdfs: number;
  price?: number | null;
  offerPrice?: number | null;
}) {
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Safety net: after a verified unlock we reload with ?unlocked=1. If the gate
  // still renders (cookie blocked, in-app browser, Incognito), surface a clear
  // fix instead of looping silently on "Checking…".
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("unlocked") === "1") {
      setError(
        "We verified your number but couldn't save it on this browser. Open this " +
          "page directly in Chrome (not inside another app), turn off Incognito, " +
          "allow cookies, then try again."
      );
    }
  }, []);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!/^[6-9]\d{9}$/.test(phone)) {
      setError("Enter a valid 10-digit mobile number.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/courses/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, slug }),
      });
      const data = await res.json();
      if (data.success) {
        // The API has set an httpOnly access cookie. A full reload forces the
        // browser to send that cookie back so the server renders the course.
        // router.refresh() didn't reliably re-send a just-set cookie on some
        // mobile / in-app browsers, leaving the button stuck on "Checking…".
        // ?unlocked=1 lets us detect (above) if the cookie never stuck.
        window.location.assign(`${window.location.pathname}?unlocked=1`);
        return;
      }
      setError(data.error || "No access found for this number.");
      setLoading(false);
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-white dark:bg-neutral-950 text-neutral-900 dark:text-white">
      {/* Nav */}
      <nav className="border-b border-neutral-200 dark:border-white/8 px-6 py-4 flex items-center justify-between">
        <Link
          href="/courses"
          className="flex items-center gap-2 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white text-sm transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> All Courses
        </Link>
        <span className="font-bold text-sm">
          Bisher <span className="text-primary-500">KC</span>
        </span>
      </nav>

      <div className="max-w-5xl mx-auto px-4 py-12 md:py-16 grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-10 items-start">
        {/* Left — course info + outline preview */}
        <div>
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-400 text-xs font-semibold uppercase tracking-wide mb-4">
            <Lock className="w-3.5 h-3.5" />
            Locked Course
          </span>
          <h1 className="text-3xl md:text-4xl font-black mb-2">{title}</h1>
          {subtitle && (
            <p className="text-primary-500 font-semibold mb-4">{subtitle}</p>
          )}
          {description && (
            <p className="text-neutral-600 dark:text-neutral-400 leading-relaxed mb-6 max-w-xl">
              {description}
            </p>
          )}

          <div className="flex flex-wrap gap-4 text-sm text-neutral-600 dark:text-neutral-400 mb-8">
            <span className="inline-flex items-center gap-1.5">
              <PlayCircle className="w-4 h-4 text-primary-500" /> {totalVideos} video lessons
            </span>
            <span className="inline-flex items-center gap-1.5">
              <FileText className="w-4 h-4 text-primary-500" /> {totalPdfs} worksheets
            </span>
            <span className="inline-flex items-center gap-1.5">
              {outline.length} modules
            </span>
          </div>

          {/* Outline preview (titles only, locked) */}
          <p className="text-xs font-semibold tracking-widest uppercase text-neutral-400 mb-3">
            Course Content
          </p>
          <div className="space-y-2">
            {outline.map((m, i) => (
              <div
                key={i}
                className="flex items-center gap-3 rounded-xl border border-neutral-200 dark:border-white/8 bg-neutral-50 dark:bg-neutral-900 px-4 py-3"
              >
                <Lock className="w-4 h-4 text-neutral-400 flex-shrink-0" />
                <span className="text-sm font-medium flex-1">{m.title}</span>
                <span className="text-xs text-neutral-500">
                  {m.videos > 0 && `${m.videos} video${m.videos > 1 ? "s" : ""}`}
                  {m.videos > 0 && m.pdfs > 0 && " · "}
                  {m.pdfs > 0 && `${m.pdfs} PDF${m.pdfs > 1 ? "s" : ""}`}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Right — unlock card */}
        <div className="lg:sticky lg:top-8">
          <div className="rounded-2xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-neutral-900 shadow-xl dark:shadow-none p-6">
            <div className="w-12 h-12 rounded-xl bg-primary-100 dark:bg-primary-500/10 flex items-center justify-center mb-4">
              <Lock className="w-6 h-6 text-primary-500" />
            </div>
            <h2 className="text-lg font-bold mb-1">Unlock this course</h2>
            <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-5">
              Enter the mobile number you used to purchase the book, or the number
              approved by the admin.
            </p>

            <form onSubmit={handleUnlock} className="space-y-3">
              <div className="flex">
                <span className="bg-neutral-100 dark:bg-neutral-800 border border-r-0 border-neutral-300 dark:border-white/10 rounded-l-xl px-3 flex items-center text-neutral-500 text-sm select-none">
                  +91
                </span>
                <input
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value.replace(/\D/g, "").slice(0, 10));
                    if (error) setError("");
                  }}
                  inputMode="numeric"
                  maxLength={10}
                  placeholder="Mobile number"
                  className="flex-1 bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-white/10 rounded-r-xl px-4 py-3 text-sm focus:outline-none focus:border-primary-500 transition-colors"
                />
              </div>
              {error && <p className="text-red-500 text-xs">{error}</p>}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-full bg-primary-500 hover:bg-primary-600 disabled:opacity-60 text-white font-bold text-sm flex items-center justify-center gap-2 transition-all"
              >
                <Phone className="w-4 h-4" />
                {loading ? "Checking…" : "Unlock with mobile number"}
              </button>
            </form>

            <div className="my-5 flex items-center gap-3 text-xs text-neutral-400">
              <div className="flex-1 h-px bg-neutral-200 dark:bg-white/10" />
              don&apos;t have access?
              <div className="flex-1 h-px bg-neutral-200 dark:bg-white/10" />
            </div>

            {/* Buy the book → auto access */}
            <div className="rounded-xl bg-primary-50 dark:bg-primary-900/20 border border-primary-100 dark:border-primary-900/30 p-4">
              <p className="text-sm font-semibold mb-2 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-primary-500" />
                Buy the Neuro Code book
              </p>
              {price != null && (
                <p className="mb-2 flex items-baseline gap-2">
                  <span className="text-lg font-black text-neutral-900 dark:text-white">
                    ₹{offerPrice ?? price}
                  </span>
                  {offerPrice != null && (
                    <span className="text-sm text-neutral-400 line-through">₹{price}</span>
                  )}
                </p>
              )}
              <p className="text-xs text-neutral-600 dark:text-neutral-400 mb-3">
                This course is included free with the book. After purchase, unlock
                instantly with the same mobile number.
              </p>
              <Link
                href="/neuro-code/checkout"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 text-sm font-bold hover:opacity-90 transition-opacity"
              >
                <ShoppingCart className="w-4 h-4" />
                Get the Book
              </Link>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

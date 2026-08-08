"use client";

import { useState } from "react";
import { Gift, Copy, Check, MessageCircle } from "lucide-react";
import { referralUrl, shareMessage, whatsappShareLink } from "@/lib/referral";

/**
 * The referral share block.
 *
 * This is the referral program, as far as almost every customer is concerned —
 * one tap into WhatsApp with the message already written. A dashboard where
 * they could log in and track earnings would be used by almost nobody; this is
 * used by anyone who liked the book.
 */
export default function ReferralShare({
  code,
  appUrl,
  discountRupees,
  commissionRupees,
  compact = false,
}: {
  code: string;
  appUrl: string;
  discountRupees: number;
  commissionRupees: number;
  compact?: boolean;
}) {
  const [copied, setCopied] = useState<"code" | "link" | null>(null);

  const link = referralUrl(code, appUrl);
  const message = shareMessage({ code, appUrl, discountRupees });

  const copy = async (what: "code" | "link") => {
    await navigator.clipboard?.writeText(what === "code" ? code : link);
    setCopied(what);
    setTimeout(() => setCopied(null), 1600);
  };

  return (
    <div
      className={`bg-neutral-900 border border-primary-500/25 rounded-2xl ${
        compact ? "p-5" : "p-6"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-full bg-primary-500/15 flex items-center justify-center flex-shrink-0">
          <Gift className="w-4 h-4 text-primary-400" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-bold text-white text-sm">
            Share the book, earn ₹{commissionRupees}
          </h2>
          <p className="text-neutral-400 text-xs mt-1 leading-relaxed">
            Your friends save ₹{discountRupees} with your code, and you earn ₹
            {commissionRupees} for every copy that gets delivered.
          </p>
        </div>
      </div>

      {/* The code itself, large enough to read aloud over a phone call. */}
      <div className="flex items-center gap-2 mt-4">
        <button
          onClick={() => copy("code")}
          className="flex-1 flex items-center justify-between gap-2 bg-neutral-950 border border-white/10 rounded-xl px-4 py-3 hover:border-primary-500/40 transition-colors group"
        >
          <span className="font-mono text-lg font-black text-white tracking-wider">
            {code}
          </span>
          {copied === "code" ? (
            <Check className="w-4 h-4 text-green-400 flex-shrink-0" />
          ) : (
            <Copy className="w-4 h-4 text-neutral-500 group-hover:text-primary-400 flex-shrink-0" />
          )}
        </button>
      </div>

      <a
        href={whatsappShareLink(message)}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-center gap-2 w-full mt-2.5 py-3 rounded-xl bg-green-500 hover:bg-green-600 text-white text-sm font-bold transition-colors"
      >
        <MessageCircle className="w-4 h-4" /> Share on WhatsApp
      </a>

      <button
        onClick={() => copy("link")}
        className="w-full mt-2 text-center text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
      >
        {copied === "link" ? "Link copied" : "or copy the link"}
      </button>
    </div>
  );
}

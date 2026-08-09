"use client";

import { useState } from "react";
import { Link2, Copy, Check } from "lucide-react";
import { TRAFFIC_SOURCES, SOURCE_LABELS } from "@/lib/attribution";

const PAGES = [
  { label: "Book landing page", path: "/neuro-code" },
  { label: "Checkout (straight to buy)", path: "/neuro-code/checkout" },
  { label: "Home", path: "/" },
  { label: "Courses", path: "/courses" },
];

/**
 * Channels you'd actually post a link on.
 *
 * "referral" is included and behaves differently from the rest: instead of
 * tagging the channel, it builds a /refer/CODE link so the click is counted
 * against that referrer and their commission is credited on any resulting
 * order. Keep the paths in step with DESTINATIONS in app/refer/[code]/route.ts —
 * a page missing there silently falls back to the book page.
 */
const CHANNELS = TRAFFIC_SOURCES.filter((s) => s !== "direct" && s !== "other");

/**
 * Generates the tagged URLs the team posts.
 *
 * This exists because the attribution data is only as good as the links, and
 * "remember to add utm_source by hand" fails inside a week. Pick a channel,
 * name the campaign, copy the link.
 */
export default function LinkBuilder() {
  const [path, setPath] = useState(PAGES[0].path);
  const [channel, setChannel] = useState<string>("instagram");
  const [campaign, setCampaign] = useState("");
  const [refCode, setRefCode] = useState("");
  const [copied, setCopied] = useState(false);

  const isReferral = channel === "referral";

  const origin =
    typeof window !== "undefined" ? window.location.origin : "https://bishertalks.com";

  // Slugified so "Aug reel 2" and "aug-reel-2" don't become two rows in the
  // campaign report.
  const slug = campaign.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const code = refCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

  let url: string;
  if (isReferral) {
    // /refer/CODE, not ?ref=CODE on the page directly: the route counts the
    // click before redirecting, so the referrer's click total stays honest
    // whichever page the link points at.
    const p = new URLSearchParams();
    if (path !== "/neuro-code") p.set("to", path);
    if (slug) p.set("utm_campaign", slug);
    const qs = p.toString();
    url = `${origin}/refer/${code || "CODE"}${qs ? `?${qs}` : ""}`;
  } else {
    const p = new URLSearchParams({ utm_source: channel });
    if (slug) p.set("utm_campaign", slug);
    url = `${origin}${path}?${p}`;
  }

  const copy = async () => {
    await navigator.clipboard?.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const field =
    "bg-white border border-neutral-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-primary-500 transition-colors";

  return (
    <div className="bg-white border border-neutral-200 rounded-2xl p-4 shadow-sm">
      <h2 className="font-semibold text-sm text-neutral-700 mb-1 flex items-center gap-2">
        <Link2 className="w-4 h-4 text-primary-500" /> Make a tracked link
      </h2>
      <p className="text-xs text-neutral-500 mb-4">
        Use this instead of a plain link in your bio, story, or broadcast — it&apos;s
        the only way the channel shows up correctly above. Pick{" "}
        <strong>Referral</strong> and enter someone&apos;s code to build their
        sharing link for any page.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[190px]">
          <label className="text-xs font-medium text-neutral-500 mb-1.5 block">Page</label>
          <select value={path} onChange={(e) => setPath(e.target.value)} className={`${field} w-full cursor-pointer`}>
            {PAGES.map((p) => (
              <option key={p.path} value={p.path}>{p.label}</option>
            ))}
          </select>
        </div>

        <div className="min-w-[140px]">
          <label className="text-xs font-medium text-neutral-500 mb-1.5 block">Posting on</label>
          <select value={channel} onChange={(e) => setChannel(e.target.value)} className={`${field} w-full cursor-pointer`}>
            {CHANNELS.map((s) => (
              <option key={s} value={s}>{SOURCE_LABELS[s]}</option>
            ))}
          </select>
        </div>

        {isReferral && (
          <div className="min-w-[150px]">
            <label className="text-xs font-medium text-neutral-500 mb-1.5 block">
              Referral code
            </label>
            <input
              value={refCode}
              onChange={(e) => setRefCode(e.target.value.toUpperCase())}
              placeholder="PRIYA7K2"
              className={`${field} w-full font-mono`}
            />
          </div>
        )}

        <div className="flex-1 min-w-[180px]">
          <label className="text-xs font-medium text-neutral-500 mb-1.5 block">
            Campaign <span className="text-neutral-400 font-normal">(optional)</span>
          </label>
          <input
            value={campaign}
            onChange={(e) => setCampaign(e.target.value)}
            placeholder="e.g. bio link, aug reel"
            className={`${field} w-full`}
          />
        </div>
      </div>

      <div className="flex items-center gap-2 mt-4 pt-3 border-t border-neutral-100">
        <code className="flex-1 text-xs text-neutral-700 bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2 overflow-x-auto whitespace-nowrap">
          {url}
        </code>
        <button
          onClick={copy}
          disabled={isReferral && !code}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors disabled:opacity-40 ${
            copied ? "bg-green-500 text-white" : "bg-neutral-900 text-white hover:bg-neutral-700"
          }`}
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

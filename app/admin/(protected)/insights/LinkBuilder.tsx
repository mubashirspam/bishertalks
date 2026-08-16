"use client";

import { useEffect, useState } from "react";
import { Link2, Copy, Check, QrCode, Download } from "lucide-react";
import { TRAFFIC_SOURCES, SOURCE_LABELS } from "@/lib/attribution";

const PAGES = [
  { label: "Book landing page", path: "/neuro-code" },
  { label: "Checkout (straight to buy)", path: "/neuro-code/checkout" },
  { label: "Home", path: "/" },
  { label: "Courses", path: "/courses" },
];

/**
 * Where a printed QR actually gets stuck.
 *
 * Suggestions, not a fixed list — the input stays free text so a new idea
 * doesn't need a code change. They exist because "QR code" as a single row in
 * the report answers nothing: the question is whether the slip inside the book
 * beats the poster at the stall, and that only has an answer if the two codes
 * were printed with different tags on them.
 */
const QR_PLACEMENTS = [
  "book-insert",
  "book-back-cover",
  "book-first-page",
  "bookmark",
  "flyer",
  "poster",
  "visiting-card",
  "event-stall",
  "packaging-sticker",
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
  const isQr = channel === "qr";

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

  /**
   * The URL the preview is currently drawn from.
   *
   * Held one step behind so typing a placement doesn't fire a render per
   * keystroke — the code is drawn server-side, and "b", "bo", "boo"… is a dozen
   * requests for a picture nobody looked at. The download links use `url`
   * directly: by the time one is clicked, the typing has stopped.
   */
  const [previewUrl, setPreviewUrl] = useState(url);
  useEffect(() => {
    const t = setTimeout(() => setPreviewUrl(url), 350);
    return () => clearTimeout(t);
  }, [url]);

  /** The code is drawn server-side from this exact URL — see /api/admin/qr. */
  const qrSrc = (data: string, format: "svg" | "png" = "svg", download = false) => {
    const p = new URLSearchParams({ data, format });
    if (download) p.set("download", "1");
    return `/api/admin/qr?${p}`;
  };

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
        sharing link for any page, or <strong>QR code</strong> to get a
        printable code for the inside of a book, a flyer or a stall banner.
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
            {isQr ? "Printed on" : "Campaign"}{" "}
            <span className="text-neutral-400 font-normal">(optional)</span>
          </label>
          <input
            value={campaign}
            onChange={(e) => setCampaign(e.target.value)}
            list={isQr ? "qr-placements" : undefined}
            placeholder={isQr ? "e.g. book-insert, poster" : "e.g. bio link, aug reel"}
            className={`${field} w-full`}
          />
          {isQr && (
            <datalist id="qr-placements">
              {QR_PLACEMENTS.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          )}
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

      {/* The printable half. Only for QR, because a QR of an Instagram bio link
          is a thing nobody needs. */}
      {isQr && (
        <div className="mt-4 pt-4 border-t border-neutral-100 flex flex-wrap items-center gap-4">
          <div className="shrink-0 bg-white border border-neutral-200 rounded-xl p-2">
            {/* Same-origin, so the admin session authorises it. Keyed on the URL
                so it redraws the moment the page or tag changes — a stale
                preview here is a wrong code on a printed book. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={previewUrl}
              src={qrSrc(previewUrl)}
              alt="QR code for this link"
              width={132}
              height={132}
              className="block w-[132px] h-[132px]"
            />
          </div>

          <div className="flex-1 min-w-[220px]">
            <h3 className="text-xs font-semibold text-neutral-700 flex items-center gap-1.5">
              <QrCode className="w-3.5 h-3.5 text-primary-500" /> Print this code
            </h3>
            <p className="text-xs text-neutral-500 mt-1 leading-relaxed">
              Scanning it opens the page above and tags the visit as{" "}
              <strong>QR code</strong>
              {slug ? <> · <strong>{slug}</strong></> : null}, so the sale shows
              up under this exact placement in the tables below. Give every spot
              its own <strong>Printed on</strong> tag — one code for the insert,
              another for the back cover — or they all count as one row and you
              learn nothing.
            </p>
            <div className="flex gap-2 mt-2.5">
              <a
                href={qrSrc(url, "svg", true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-900 text-white text-xs font-medium hover:bg-neutral-700 transition-colors"
              >
                <Download className="w-3.5 h-3.5" /> SVG (for the printer)
              </a>
              <a
                href={qrSrc(url, "png", true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-neutral-300 text-neutral-700 text-xs font-medium hover:border-neutral-400 transition-colors"
              >
                <Download className="w-3.5 h-3.5" /> PNG
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

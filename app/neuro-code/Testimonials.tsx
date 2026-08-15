"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { Play, Pause, Quote, X, Star, BadgeCheck, Video, ImageIcon, Mic } from "lucide-react";
import { Card } from "./ui";
import type { Testimonial } from "@/lib/types/landing";

/**
 * A dashed frame standing in for a testimonial that hasn't arrived yet.
 *
 * Deliberately looks unfinished. The alternative — inventing a plausible
 * reader and a quote — would put a fake endorsement on a page that takes
 * money, so the section shows its shape and says plainly what belongs here.
 * Turn placeholders off in Admin → Landing page before launch.
 */
function Placeholder({
  icon: Icon,
  label,
  hint,
  aspect = "aspect-video",
}: {
  icon: typeof Video;
  label: string;
  hint: string;
  aspect?: string;
}) {
  return (
    <div
      className={`${aspect} rounded-2xl border-2 border-dashed border-neutral-300 dark:border-white/15 bg-neutral-100/60 dark:bg-white/[0.03] flex flex-col items-center justify-center text-center px-4 gap-2`}
    >
      <Icon className="w-6 h-6 text-neutral-400 dark:text-neutral-600" />
      <p className="text-neutral-500 dark:text-neutral-400 text-xs font-semibold">{label}</p>
      <p className="text-neutral-400 dark:text-neutral-600 text-[11px] leading-relaxed">{hint}</p>
    </div>
  );
}

/* ── Video ──────────────────────────────────────────────────────────────── */

/**
 * ImageKit renders a still from any video it hosts at `<url>/ik-thumbnail.jpg`.
 * That gives the <video> a poster without a second field to fill in — and the
 * poster is what sizes the element before any of the file is fetched, so a
 * portrait clip reserves portrait space and the page doesn't jump when it loads.
 *
 * Only for ImageKit URLs: anywhere else the path is meaningless and would 404.
 */
function posterFor(videoUrl: string): string | undefined {
  return videoUrl.includes("ik.imagekit.io")
    ? `${videoUrl}/ik-thumbnail.jpg`
    : undefined;
}

/**
 * Video testimonials, from either source.
 *
 * These arrive two ways and the difference matters. A YouTube one is an iframe
 * costing a few hundred KB the moment it exists, so it stays behind a tap.
 * A file we host is a plain <video preload="none">, which fetches nothing until
 * the reader hits play — the tap-to-load dance buys nothing there and only puts
 * a fake play button in front of the real controls.
 *
 * They also arrive shaped differently. YouTube is 16:9; the clips people send
 * are filmed on a phone and are portrait. A fixed aspect-video box letterboxes
 * those into a thin strip between two black slabs, so the hosted branch lets the
 * file state its own proportions and just caps the height.
 */
export function VideoTestimonials({
  items,
  showPlaceholders,
}: {
  items: Testimonial[];
  showPlaceholders: boolean;
}) {
  // Keyed on the row id, never on youtube_id: that column is null for a hosted
  // video, and `playing === null` matched every such card on first render —
  // which loaded an iframe pointed at /embed/null instead of the video.
  const [playing, setPlaying] = useState<string | null>(null);

  // A row with neither source has nothing to show but its name.
  const playable = items.filter((t) => t.video_url || t.youtube_id);

  if (!playable.length) {
    return showPlaceholders ? (
      <Placeholder
        icon={Video}
        label="വീഡിയോ അനുഭവം"
        hint="Add one in Admin → Landing page"
      />
    ) : null;
  }

  return (
    <div className="space-y-4">
      {playable.map((t) => (
        <Card key={t.id} glow className="overflow-hidden p-0">
          {t.video_url ? (
            // Centred rather than stretched, so a portrait clip keeps its shape
            // against black instead of being cropped to a letterbox.
            <div className="bg-black rounded-t-2xl overflow-hidden flex justify-center">
              <video
                src={t.video_url}
                poster={posterFor(t.video_url)}
                controls
                playsInline
                preload="none"
                className="max-h-[70vh] w-auto max-w-full"
                title={`${t.name} — Neuro Code`}
              />
            </div>
          ) : (
            <div className="relative aspect-video bg-black rounded-t-2xl overflow-hidden">
              {playing === t.id ? (
                <iframe
                  className="absolute inset-0 w-full h-full"
                  src={`https://www.youtube-nocookie.com/embed/${t.youtube_id}?autoplay=1`}
                  title={`${t.name} — Neuro Code`}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              ) : (
                <button
                  onClick={() => setPlaying(t.id)}
                  className="absolute inset-0 w-full h-full group"
                  aria-label={`${t.name} — വീഡിയോ പ്ലേ ചെയ്യുക`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`https://i.ytimg.com/vi/${t.youtube_id}/hqdefault.jpg`}
                    alt=""
                    loading="lazy"
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                  <span className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                  <span className="absolute inset-0 flex items-center justify-center">
                    <span className="w-16 h-16 rounded-full bg-primary-500 shadow-xl shadow-primary-500/40 flex items-center justify-center group-hover:scale-110 transition-transform">
                      <Play className="w-7 h-7 text-white fill-white ml-1" />
                    </span>
                  </span>
                  {t.quote && (
                    <span className="absolute left-4 right-4 bottom-4 text-left text-white font-bold text-[15px] leading-[1.6]">
                      {t.quote}
                    </span>
                  )}
                </button>
              )}
            </div>
          )}
          <div className="px-4 py-3">
            {/* On the YouTube card the quote is burned over the thumbnail; a
                hosted video has real controls there, so it reads here instead. */}
            {t.video_url && t.quote && (
              <p className="text-neutral-700 dark:text-neutral-300 text-[13.5px] leading-[1.9] mb-2">
                {t.quote}
              </p>
            )}
            <p className="text-neutral-900 dark:text-white text-sm font-bold">{t.name}</p>
            {t.role && (
              <p className="text-neutral-500 dark:text-neutral-400 text-xs mt-0.5">{t.role}</p>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}

/* ── Image ──────────────────────────────────────────────────────────────── */

export function ImageTestimonials({
  items,
  showPlaceholders,
}: {
  items: Testimonial[];
  showPlaceholders: boolean;
}) {
  const [open, setOpen] = useState<Testimonial | null>(null);

  if (!items.length) {
    return showPlaceholders ? (
      <div className="grid grid-cols-2 gap-3">
        <Placeholder
          icon={ImageIcon}
          aspect="aspect-[3/4]"
          label="WhatsApp screenshot"
          hint="Admin → Landing page"
        />
        <Placeholder
          icon={ImageIcon}
          aspect="aspect-[3/4]"
          label="WhatsApp screenshot"
          hint="Uploaded to ImageKit"
        />
      </div>
    ) : null;
  }

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {items.filter((t) => !!t.image_url).map((t) => (
          <button
            key={t.id}
            onClick={() => setOpen(t)}
            className="relative aspect-[3/4] rounded-xl overflow-hidden border border-neutral-200 dark:border-white/10 hover:border-primary-400 transition-colors"
          >
            <Image
              src={t.image_url!}
              alt={t.quote ?? t.name}
              fill
              sizes="(max-width: 640px) 50vw, 33vw"
              className="object-cover object-top"
            />
          </button>
        ))}
      </div>

      {/* Screenshots are unreadable at thumbnail size — the tap is the real view. */}
      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setOpen(null)}
        >
          <button
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white"
            aria-label="അടയ്ക്കുക"
          >
            <X className="w-5 h-5" />
          </button>
          <div className="relative w-full max-w-md h-[80vh]">
            <Image src={open.image_url!} alt={open.quote ?? open.name} fill className="object-contain" />
          </div>
        </div>
      )}
    </>
  );
}

/* ── Audio ──────────────────────────────────────────────────────────────── */

/**
 * A voice-note player.
 *
 * These arrive as WhatsApp voice notes and the familiar shape — round avatar,
 * play circle, waveform, elapsed/total — says what it is before a word is
 * read. The waveform is decorative: drawing a real one means decoding the
 * audio, which is a lot of machinery for a bar chart nobody verifies against
 * the sound. It does track progress, which is the part people actually use.
 */
function VoiceNote({ item }: { item: Testimonial }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [elapsed, setElapsed] = useState("0:00");

  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
    } else {
      // One at a time, as in any messaging app.
      document.querySelectorAll("audio").forEach((a) => a !== el && a.pause());
      el.play().catch(() => {});
      setPlaying(true);
    }
  };

  // Fixed pseudo-random heights so it reads as speech rather than a sine wave.
  const bars = Array.from({ length: 42 }, (_, i) => 25 + ((i * 47) % 60));

  return (
    <Card glow className="p-4">
      <div className="flex items-center gap-3">
        <div className="relative w-11 h-11 rounded-full overflow-hidden ring-2 ring-primary-500 flex-shrink-0 bg-primary-500/15">
          {item.avatar_url ? (
            <Image src={item.avatar_url} alt={item.name} fill className="object-cover" sizes="44px" />
          ) : (
            <span className="absolute inset-0 flex items-center justify-center text-primary-600 dark:text-primary-300 font-black">
              {item.name.charAt(0)}
            </span>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <p className="flex items-center gap-1.5 text-neutral-900 dark:text-white font-bold text-sm">
            {item.name}
            <BadgeCheck className="w-4 h-4 text-primary-500" />
          </p>
        </div>

        {item.sent_at_label && (
          <span className="text-neutral-400 dark:text-neutral-500 text-[11px] flex-shrink-0">
            {item.sent_at_label}
          </span>
        )}
      </div>

      <div className="flex items-center gap-3 mt-3">
        <button
          onClick={toggle}
          className="w-11 h-11 rounded-full bg-primary-500 flex items-center justify-center flex-shrink-0 shadow-lg shadow-primary-500/25"
          aria-label={playing ? "നിർത്തുക" : "കേൾക്കുക"}
        >
          {playing ? (
            <Pause className="w-5 h-5 text-white fill-white" />
          ) : (
            <Play className="w-5 h-5 text-white fill-white ml-0.5" />
          )}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-[2px] h-7">
            {bars.map((h, i) => {
              const reached = (i / bars.length) * 100 <= progress;
              return (
                <span
                  key={i}
                  style={{ height: `${h}%` }}
                  className={`flex-1 rounded-full ${
                    reached
                      ? "bg-primary-500"
                      : "bg-neutral-300 dark:bg-neutral-600"
                  }`}
                />
              );
            })}
          </div>
          <div className="flex items-center justify-between mt-1.5 text-[11px] text-neutral-500 dark:text-neutral-400 tabular-nums">
            <span>{elapsed}</span>
            <span>{item.duration ?? ""}</span>
          </div>
        </div>
      </div>

      {item.quote && (
        <div className="relative mt-3 pt-3 border-t border-neutral-200 dark:border-white/10">
          <p className="text-neutral-700 dark:text-neutral-300 text-[13.5px] leading-[1.9] pr-6">
            {item.quote}
          </p>
          <Quote className="w-5 h-5 text-primary-500/60 absolute right-0 bottom-0" />
        </div>
      )}

      <audio
        ref={audioRef}
        src={item.audio_url ?? undefined}
        preload="none"
        onTimeUpdate={(e) => {
          const el = e.currentTarget;
          if (!el.duration) return;
          setProgress((el.currentTime / el.duration) * 100);
          const m = Math.floor(el.currentTime / 60);
          const s = Math.floor(el.currentTime % 60);
          setElapsed(`${m}:${String(s).padStart(2, "0")}`);
        }}
        onEnded={() => {
          setPlaying(false);
          setProgress(0);
          setElapsed("0:00");
        }}
        onPause={() => setPlaying(false)}
        onPlay={() => setPlaying(true)}
      />
    </Card>
  );
}

export function AudioTestimonials({
  items,
  showPlaceholders,
}: {
  items: Testimonial[];
  showPlaceholders: boolean;
}) {
  if (!items.length) {
    return showPlaceholders ? (
      <Placeholder
        icon={Mic}
        aspect="aspect-[5/2]"
        label="ശബ്ദ സന്ദേശം"
        hint="Upload a voice note in Admin → Landing page"
      />
    ) : null;
  }
  return (
    <div className="space-y-3">
      {items.map((t) => (
        <VoiceNote key={t.id} item={t} />
      ))}
    </div>
  );
}

/* ── Text ───────────────────────────────────────────────────────────────── */

export function TextTestimonials({ items }: { items: Testimonial[] }) {
  if (!items.length) return null;
  return (
    <div className="space-y-3">
      {items.map((t) => (
        <Card key={t.id} glow className="p-5">
          {t.rating && (
            <div className="flex gap-0.5 mb-2">
              {Array.from({ length: t.rating }, (_, i) => (
                <Star key={i} className="w-4 h-4 fill-primary-500 text-primary-500" />
              ))}
            </div>
          )}
          <p className="text-neutral-700 dark:text-neutral-300 text-[14px] leading-[1.9]">
            {t.quote}
          </p>
          <p className="text-primary-600 dark:text-primary-400 text-[13px] font-semibold mt-3">
            — {t.name}
            {t.role ? `, ${t.role}` : ""}
          </p>
        </Card>
      ))}
    </div>
  );
}

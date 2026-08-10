"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  Plus, Trash2, ChevronUp, ChevronDown, Power, AlertCircle, Check,
  Video, ImageIcon, Mic, MessageSquare, Settings,
} from "lucide-react";
import MediaUpload from "@/components/admin/MediaUpload";
import { IMAGEKIT_FOLDERS } from "@/lib/imagekit";
import {
  KIND_LABELS, TESTIMONIAL_KINDS,
  type LandingSettings, type Testimonial, type TestimonialKind,
} from "@/lib/db/landing";

const KIND_ICON: Record<TestimonialKind, typeof Video> = {
  video: Video, image: ImageIcon, audio: Mic, text: MessageSquare,
};

/** A new, empty testimonial of the chosen kind. */
const blank = (kind: TestimonialKind) => ({
  kind,
  name: "",
  role: "",
  quote: "",
  youtube_id: "",
  video_url: null as string | null,
  image_url: null as string | null,
  audio_url: null as string | null,
  avatar_url: null as string | null,
  duration: "",
  sent_at_label: "",
  rating: 5,
});

type Draft = ReturnType<typeof blank> & { id?: string };

export default function LandingManager({
  testimonials,
  settings,
  uploadsReady,
}: {
  testimonials: Testimonial[];
  settings: LandingSettings;
  uploadsReady: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<TestimonialKind>("video");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [draftSettings, setDraftSettings] = useState(settings);
  const [showSettings, setShowSettings] = useState(false);

  const rows = testimonials.filter((t) => t.kind === tab);

  const call = async (method: string, body: unknown, query = "") => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/landing${query}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: method === "DELETE" ? undefined : JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ text: json.error ?? "Something went wrong", bad: true });
        return null;
      }
      router.refresh();
      return json;
    } catch {
      setMsg({ text: "Network error — try again", bad: true });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      setMsg({ text: "Enter a name", bad: true });
      return;
    }
    const result = draft.id
      ? await call("PATCH", draft)
      : await call("POST", draft);
    if (result) {
      setMsg({ text: draft.id ? "Saved." : "Testimonial added." });
      setDraft(null);
    }
  };

  const remove = async (t: Testimonial) => {
    if (!confirm(`Remove ${t.name}'s ${KIND_LABELS[t.kind].toLowerCase()}?`)) return;
    await call("DELETE", null, `?id=${t.id}`);
  };

  const field =
    "bg-white border border-neutral-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-primary-500 transition-colors";

  return (
    <div>
      {!uploadsReady && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4 text-sm text-amber-900">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <p>
            ImageKit isn&apos;t configured yet, so uploads will fail. Set{" "}
            <code className="font-mono text-xs">IMAGEKIT_PRIVATE_KEY</code> and{" "}
            <code className="font-mono text-xs">NEXT_PUBLIC_IMAGEKIT_PUBLIC_KEY</code>.
            Everything else on this page works — YouTube IDs and written
            testimonials need no upload.
          </p>
        </div>
      )}

      {msg && (
        <div
          className={`flex items-start gap-2 rounded-xl px-4 py-2.5 mb-4 text-sm border ${
            msg.bad
              ? "bg-red-50 border-red-200 text-red-800"
              : "bg-green-50 border-green-200 text-green-800"
          }`}
        >
          {msg.bad ? <AlertCircle className="w-4 h-4 mt-0.5" /> : <Check className="w-4 h-4 mt-0.5" />}
          <p>{msg.text}</p>
        </div>
      )}

      {/* ── Page settings ──────────────────────────────────────────────── */}
      <div className="bg-white border border-neutral-200 rounded-2xl shadow-sm mb-5">
        <button
          onClick={() => setShowSettings(!showSettings)}
          className="w-full flex items-center justify-between px-5 py-4"
        >
          <span className="flex items-center gap-2 font-semibold text-sm text-neutral-700">
            <Settings className="w-4 h-4 text-primary-500" /> Explainer video &amp; page settings
          </span>
          {showSettings ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>

        {showSettings && (
          <div className="px-5 pb-5 border-t border-neutral-100 pt-4 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-neutral-500 mb-1.5 block">
                  YouTube ID <span className="text-neutral-400 font-normal">(the part after v=)</span>
                </label>
                <input
                  value={draftSettings.explainer_youtube_id ?? ""}
                  onChange={(e) =>
                    setDraftSettings({ ...draftSettings, explainer_youtube_id: e.target.value })
                  }
                  placeholder="dQw4w9WgXcQ"
                  className={`${field} w-full font-mono`}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-neutral-500 mb-1.5 block">
                  Length shown on the page
                </label>
                <input
                  value={draftSettings.explainer_length ?? ""}
                  onChange={(e) =>
                    setDraftSettings({ ...draftSettings, explainer_length: e.target.value })
                  }
                  placeholder="03:42"
                  className={`${field} w-full`}
                />
              </div>
            </div>

            {/* Either a YouTube ID or a self-hosted file; the page prefers YouTube. */}
            <MediaUpload
              kind="video"
              folder={IMAGEKIT_FOLDERS.explainer}
              label="…or upload the video to ImageKit instead"
              value={draftSettings.explainer_video_url}
              onChange={(url) => setDraftSettings({ ...draftSettings, explainer_video_url: url })}
            />

            <label className="flex items-start gap-2 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={draftSettings.show_placeholders}
                onChange={(e) =>
                  setDraftSettings({ ...draftSettings, show_placeholders: e.target.checked })
                }
                className="w-4 h-4 mt-0.5 rounded border-neutral-300 accent-primary-500"
              />
              <span className="text-sm text-neutral-700">
                Show dashed placeholders where testimonials are missing
                <span className="block text-xs text-neutral-500">
                  Useful while building. Switch off before launch — a live page
                  should show real testimonials or none.
                </span>
              </span>
            </label>

            <button
              onClick={async () => {
                const r = await call("PATCH", { scope: "settings", ...draftSettings });
                if (r) setMsg({ text: "Settings saved." });
              }}
              disabled={busy}
              className="px-4 py-2 rounded-xl bg-primary-500 hover:bg-primary-600 text-white text-sm font-bold disabled:opacity-60"
            >
              {busy ? "Saving…" : "Save settings"}
            </button>
          </div>
        )}
      </div>

      {/* ── Kind tabs ──────────────────────────────────────────────────── */}
      <div className="flex gap-1.5 overflow-x-auto pb-2 mb-4">
        {TESTIMONIAL_KINDS.map((k) => {
          const Icon = KIND_ICON[k];
          const n = testimonials.filter((t) => t.kind === k).length;
          const active = tab === k;
          return (
            <button
              key={k}
              onClick={() => { setTab(k); setDraft(null); }}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium whitespace-nowrap border transition-all ${
                active
                  ? "bg-neutral-900 text-white border-neutral-900"
                  : "bg-white text-neutral-600 border-neutral-200 hover:border-neutral-400"
              }`}
            >
              <Icon className="w-3.5 h-3.5" /> {KIND_LABELS[k]}
              <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                active ? "bg-white/20" : "bg-neutral-100 text-neutral-500"
              }`}>{n}</span>
            </button>
          );
        })}
      </div>

      {/* ── Editor ─────────────────────────────────────────────────────── */}
      {draft ? (
        <div className="bg-white border border-neutral-200 rounded-2xl p-5 shadow-sm mb-5 space-y-3">
          <h2 className="font-semibold text-sm text-neutral-700">
            {draft.id ? "Edit" : "Add"} {KIND_LABELS[draft.kind].toLowerCase()} testimonial
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1.5 block">Name</label>
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Fathima"
                className={`${field} w-full`}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1.5 block">
                Role <span className="text-neutral-400 font-normal">(optional)</span>
              </label>
              <input
                value={draft.role}
                onChange={(e) => setDraft({ ...draft, role: e.target.value })}
                placeholder="അധ്യാപിക, തൃശൂർ"
                className={`${field} w-full`}
              />
            </div>
          </div>

          {draft.kind === "video" && (
            <>
              <div>
                <label className="text-xs font-medium text-neutral-500 mb-1.5 block">
                  YouTube ID
                </label>
                <input
                  value={draft.youtube_id}
                  onChange={(e) => setDraft({ ...draft, youtube_id: e.target.value })}
                  placeholder="abc123XYZ"
                  className={`${field} w-full font-mono`}
                />
              </div>
              <MediaUpload
                kind="video"
                folder={IMAGEKIT_FOLDERS.testimonialVideo}
                label="…or upload the video file"
                value={draft.video_url}
                onChange={(url) => setDraft({ ...draft, video_url: url })}
              />
            </>
          )}

          {draft.kind === "image" && (
            <MediaUpload
              kind="image"
              folder={IMAGEKIT_FOLDERS.testimonialImage}
              label="WhatsApp screenshot"
              value={draft.image_url}
              onChange={(url) => setDraft({ ...draft, image_url: url })}
            />
          )}

          {draft.kind === "audio" && (
            <>
              <MediaUpload
                kind="audio"
                folder={IMAGEKIT_FOLDERS.testimonialAudio}
                label="Voice note"
                value={draft.audio_url}
                onChange={(url) => setDraft({ ...draft, audio_url: url })}
              />
              <MediaUpload
                kind="image"
                folder={IMAGEKIT_FOLDERS.avatar}
                label="Photo (optional — falls back to the first letter)"
                value={draft.avatar_url}
                onChange={(url) => setDraft({ ...draft, avatar_url: url })}
              />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-neutral-500 mb-1.5 block">Duration</label>
                  <input
                    value={draft.duration}
                    onChange={(e) => setDraft({ ...draft, duration: e.target.value })}
                    placeholder="0:42"
                    className={`${field} w-full`}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-neutral-500 mb-1.5 block">Sent</label>
                  <input
                    value={draft.sent_at_label}
                    onChange={(e) => setDraft({ ...draft, sent_at_label: e.target.value })}
                    placeholder="Today, 10:32 AM"
                    className={`${field} w-full`}
                  />
                </div>
              </div>
            </>
          )}

          {draft.kind === "text" && (
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1.5 block">Stars</label>
              <select
                value={draft.rating}
                onChange={(e) => setDraft({ ...draft, rating: Number(e.target.value) })}
                className={`${field} cursor-pointer`}
              >
                {[5, 4, 3, 2, 1].map((n) => (
                  <option key={n} value={n}>{n} ★</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-neutral-500 mb-1.5 block">
              {draft.kind === "video"
                ? "Caption shown over the thumbnail"
                : draft.kind === "audio"
                  ? "What they said, written out"
                  : "Their words"}
            </label>
            <textarea
              value={draft.quote}
              onChange={(e) => setDraft({ ...draft, quote: e.target.value })}
              rows={3}
              placeholder="ഈ പുസ്തകത്തിലെ പല കാര്യങ്ങളും…"
              className={`${field} w-full resize-none`}
            />
          </div>

          <div className="flex gap-2 pt-2 border-t border-neutral-100">
            <button
              onClick={save}
              disabled={busy}
              className="px-4 py-2 rounded-xl bg-primary-500 hover:bg-primary-600 text-white text-sm font-bold disabled:opacity-60"
            >
              {busy ? "Saving…" : draft.id ? "Save changes" : "Add testimonial"}
            </button>
            <button
              onClick={() => { setDraft(null); setMsg(null); }}
              className="px-4 py-2 rounded-xl border border-neutral-200 text-sm text-neutral-600 hover:border-neutral-400"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setDraft(blank(tab))}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary-500 hover:bg-primary-600 text-white text-sm font-bold mb-5 transition-colors"
        >
          <Plus className="w-4 h-4" /> Add {KIND_LABELS[tab].toLowerCase()}
        </button>
      )}

      {/* ── List ───────────────────────────────────────────────────────── */}
      {!rows.length ? (
        <div className="bg-white border border-neutral-200 rounded-2xl p-10 text-center text-neutral-500 shadow-sm text-sm">
          No {KIND_LABELS[tab].toLowerCase()} testimonials yet.
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((t, i) => (
            <div
              key={t.id}
              className={`bg-white border border-neutral-200 rounded-2xl p-4 shadow-sm flex items-start gap-3 ${
                t.is_active ? "" : "opacity-60"
              }`}
            >
              {t.image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={t.image_url} alt="" className="w-12 h-12 rounded-lg object-cover flex-shrink-0" />
              )}
              {t.avatar_url && !t.image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={t.avatar_url} alt="" className="w-12 h-12 rounded-full object-cover flex-shrink-0" />
              )}

              <div className="min-w-0 flex-1">
                <p className="font-semibold text-sm text-neutral-900">
                  {t.name}
                  {t.role && <span className="text-neutral-500 font-normal"> · {t.role}</span>}
                  {!t.is_active && <span className="text-red-600 text-xs font-medium"> · hidden</span>}
                </p>
                {t.quote && (
                  <p className="text-neutral-600 text-xs mt-1 line-clamp-2 leading-relaxed">{t.quote}</p>
                )}
                <p className="text-neutral-400 text-[11px] mt-1">
                  {t.youtube_id && `YouTube: ${t.youtube_id}`}
                  {t.audio_url && `Voice note${t.duration ? ` · ${t.duration}` : ""}`}
                  {t.video_url && !t.youtube_id && "Uploaded video"}
                  {t.rating && `${t.rating} ★`}
                </p>
              </div>

              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={() => call("PATCH", { id: t.id, move: "up" })}
                  disabled={busy || i === 0}
                  className="p-1.5 rounded-lg border border-neutral-200 text-neutral-500 hover:border-neutral-400 disabled:opacity-30"
                  title="Move up"
                >
                  <ChevronUp className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => call("PATCH", { id: t.id, move: "down" })}
                  disabled={busy || i === rows.length - 1}
                  className="p-1.5 rounded-lg border border-neutral-200 text-neutral-500 hover:border-neutral-400 disabled:opacity-30"
                  title="Move down"
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() =>
                    setDraft({
                      id: t.id,
                      kind: t.kind,
                      name: t.name,
                      role: t.role ?? "",
                      quote: t.quote ?? "",
                      youtube_id: t.youtube_id ?? "",
                      video_url: t.video_url,
                      image_url: t.image_url,
                      audio_url: t.audio_url,
                      avatar_url: t.avatar_url,
                      duration: t.duration ?? "",
                      sent_at_label: t.sent_at_label ?? "",
                      rating: t.rating ?? 5,
                    })
                  }
                  className="px-2.5 py-1.5 rounded-lg border border-neutral-200 text-xs text-neutral-600 hover:border-neutral-400"
                >
                  Edit
                </button>
                <button
                  onClick={() => call("PATCH", { id: t.id, is_active: !t.is_active })}
                  disabled={busy}
                  title={t.is_active ? "Hide from the page" : "Show on the page"}
                  className={`p-1.5 rounded-lg border transition-colors ${
                    t.is_active
                      ? "border-neutral-200 text-neutral-500 hover:border-neutral-400"
                      : "border-green-200 text-green-600 hover:border-green-400"
                  }`}
                >
                  <Power className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => remove(t)}
                  disabled={busy}
                  className="p-1.5 rounded-lg border border-neutral-200 text-red-500 hover:border-red-300"
                  title="Remove"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

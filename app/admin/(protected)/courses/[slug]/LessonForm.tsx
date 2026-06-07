"use client";

import { useState } from "react";

export interface LessonDraft {
  slug: string;
  title: string;
  type: "video" | "pdf";
  url: string;
  duration: string;
}

const inputCls =
  "w-full bg-white border border-neutral-300 rounded-lg px-3 py-2 text-sm text-neutral-900 placeholder-neutral-400 focus:outline-none focus:border-primary-500 transition-colors";

export default function LessonForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: Partial<LessonDraft>;
  submitLabel: string;
  onSubmit: (draft: LessonDraft) => Promise<string | null>; // returns error or null
  onCancel?: () => void;
}) {
  const [draft, setDraft] = useState<LessonDraft>({
    slug: initial?.slug ?? "",
    title: initial?.title ?? "",
    type: initial?.type ?? "video",
    url: initial?.url ?? "",
    duration: initial?.duration ?? "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const set = (k: keyof LessonDraft) => (v: string) =>
    setDraft((d) => ({ ...d, [k]: v }) as LessonDraft);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const err = await onSubmit(draft);
    setLoading(false);
    if (err) setError(err);
  };

  return (
    <form onSubmit={submit} className="bg-neutral-50 border border-neutral-200 rounded-xl p-3 space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_110px] gap-2">
        <input
          value={draft.title}
          onChange={(e) => set("title")(e.target.value)}
          placeholder="Lesson title *"
          className={inputCls}
        />
        <select
          value={draft.type}
          onChange={(e) => set("type")(e.target.value)}
          className={`${inputCls} cursor-pointer`}
        >
          <option value="video">Video</option>
          <option value="pdf">PDF</option>
        </select>
      </div>
      <input
        value={draft.url}
        onChange={(e) => set("url")(e.target.value)}
        placeholder="URL (YouTube / Drive link) *"
        className={inputCls}
      />
      <div className="grid grid-cols-2 gap-2">
        <input
          value={draft.slug}
          onChange={(e) => set("slug")(e.target.value)}
          placeholder="Slug (auto if blank)"
          className={`${inputCls} font-mono`}
        />
        <input
          value={draft.duration}
          onChange={(e) => set("duration")(e.target.value)}
          placeholder="Duration (optional)"
          className={inputCls}
        />
      </div>
      {error && <p className="text-red-600 text-xs">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-1.5 rounded-full bg-primary-500 hover:bg-primary-600 disabled:opacity-60 text-white text-xs font-bold transition-all"
        >
          {loading ? "Saving…" : submitLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-1.5 rounded-full border border-neutral-300 text-neutral-600 hover:bg-neutral-100 text-xs font-medium transition-all"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

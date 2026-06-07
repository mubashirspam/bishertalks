"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";

export default function NewCourseButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const autoSlug = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/admin/courses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, slug: slug || autoSlug(title) }),
      });
      const data = await res.json();
      if (data.success) {
        router.push(`/admin/courses/${data.course.slug}`);
      } else {
        setError(data.error || "Failed to create course.");
        setLoading(false);
      }
    } catch {
      setError("Something went wrong.");
      setLoading(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary-500 hover:bg-primary-600 text-white text-sm font-semibold transition-all"
      >
        <Plus className="w-4 h-4" /> New Course
      </button>
    );
  }

  const inputCls =
    "w-full bg-white border border-neutral-300 rounded-xl px-4 py-2.5 text-sm text-neutral-900 placeholder-neutral-400 focus:outline-none focus:border-primary-500 transition-colors";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md bg-white rounded-2xl border border-neutral-200 shadow-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-neutral-900">New Course</h3>
          <button onClick={() => setOpen(false)} className="text-neutral-400 hover:text-neutral-900">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-neutral-500 uppercase tracking-wider block mb-1.5">
              Title
            </label>
            <input
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (!slugTouched) setSlug(autoSlug(e.target.value));
              }}
              placeholder="e.g. Advanced NLP"
              className={inputCls}
              autoFocus
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-neutral-500 uppercase tracking-wider block mb-1.5">
              Slug (URL)
            </label>
            <input
              value={slug}
              onChange={(e) => { setSlugTouched(true); setSlug(autoSlug(e.target.value)); }}
              placeholder="advanced-nlp"
              className={`${inputCls} font-mono`}
            />
            <p className="text-xs text-neutral-400 mt-1">/courses/{slug || "…"}</p>
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading || !title.trim()}
            className="w-full py-2.5 rounded-full bg-primary-500 hover:bg-primary-600 disabled:opacity-60 text-white font-bold text-sm transition-all"
          >
            {loading ? "Creating…" : "Create & Edit"}
          </button>
        </form>
      </div>
    </div>
  );
}

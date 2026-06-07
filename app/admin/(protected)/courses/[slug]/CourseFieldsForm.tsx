"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Save, Check } from "lucide-react";
import type { AdminCourse } from "@/lib/db/courses-admin";

export default function CourseFieldsForm({ course }: { course: AdminCourse }) {
  const router = useRouter();
  const [f, setF] = useState({
    title: course.title,
    slug: course.slug,
    subtitle: course.subtitle ?? "",
    description: course.description ?? "",
    thumbnail: course.thumbnail ?? "",
    price: course.price?.toString() ?? "",
    offer_price: course.offer_price?.toString() ?? "",
    is_locked: course.is_locked,
  });
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) =>
    setF((prev) => ({ ...prev, [k]: v }));

  const save = async () => {
    setError("");
    setLoading(true);
    setSaved(false);
    try {
      const res = await fetch("/api/admin/courses", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: course.id, ...f }),
      });
      const data = await res.json();
      if (data.success) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
        if (data.slug && data.slug !== course.slug) {
          router.replace(`/admin/courses/${data.slug}`);
        } else {
          router.refresh();
        }
      } else {
        setError(data.error || "Failed to save.");
      }
    } catch {
      setError("Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  const inputCls =
    "w-full bg-white border border-neutral-300 rounded-xl px-4 py-2.5 text-sm text-neutral-900 placeholder-neutral-400 focus:outline-none focus:border-primary-500 transition-colors";
  const labelCls =
    "text-xs font-semibold text-neutral-500 uppercase tracking-wider block mb-1.5";

  return (
    <div className="bg-white border border-neutral-200 rounded-2xl p-6 shadow-sm space-y-4">
      <h2 className="text-lg font-bold text-neutral-900">Course details</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Title</label>
          <input value={f.title} onChange={(e) => set("title", e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Slug (URL)</label>
          <input value={f.slug} onChange={(e) => set("slug", e.target.value)} className={`${inputCls} font-mono`} />
          <p className="text-xs text-neutral-400 mt-1">/courses/{f.slug || "…"}</p>
        </div>
      </div>

      <div>
        <label className={labelCls}>Subtitle</label>
        <input value={f.subtitle} onChange={(e) => set("subtitle", e.target.value)} className={inputCls} />
      </div>

      <div>
        <label className={labelCls}>Description</label>
        <textarea
          value={f.description}
          onChange={(e) => set("description", e.target.value)}
          rows={3}
          className={`${inputCls} resize-none`}
        />
      </div>

      <div>
        <label className={labelCls}>Thumbnail image URL</label>
        <input value={f.thumbnail} onChange={(e) => set("thumbnail", e.target.value)} placeholder="https://…/cover.jpg" className={inputCls} />
        {f.thumbnail && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={f.thumbnail} alt="Preview" className="mt-2 w-48 aspect-video object-cover rounded-lg border border-neutral-200" />
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
        <div>
          <label className={labelCls}>Price (₹)</label>
          <input
            value={f.price}
            onChange={(e) => set("price", e.target.value.replace(/\D/g, ""))}
            inputMode="numeric"
            placeholder="999"
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>Offer price (₹)</label>
          <input
            value={f.offer_price}
            onChange={(e) => set("offer_price", e.target.value.replace(/\D/g, ""))}
            inputMode="numeric"
            placeholder="Optional"
            className={inputCls}
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-neutral-700 cursor-pointer py-2.5">
          <input
            type="checkbox"
            checked={f.is_locked}
            onChange={(e) => set("is_locked", e.target.checked)}
            className="accent-primary-500 w-4 h-4"
          />
          Locked (requires access)
        </label>
      </div>
      <p className="text-xs text-neutral-500">
        Price/offer drive the checkout for the book-linked course. Offer price is
        charged; the price shows struck-through.
      </p>

      {error && <p className="text-red-600 text-sm">{error}</p>}

      <button
        onClick={save}
        disabled={loading}
        className={`inline-flex items-center gap-2 px-6 py-2.5 rounded-full font-bold text-sm text-white transition-all ${
          saved ? "bg-green-500" : "bg-primary-500 hover:bg-primary-600 disabled:opacity-60"
        }`}
      >
        {saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
        {loading ? "Saving…" : saved ? "Saved" : "Save details"}
      </button>
    </div>
  );
}

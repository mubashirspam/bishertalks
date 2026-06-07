"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronUp, ChevronDown, Trash2, Plus, Check } from "lucide-react";
import LessonItem from "./LessonItem";
import LessonForm, { type LessonDraft } from "./LessonForm";
import type { AdminModule } from "@/lib/db/courses-admin";

export default function ModuleItem({
  module,
  index,
  canUp,
  canDown,
  onMove,
}: {
  module: AdminModule;
  index: number;
  canUp: boolean;
  canDown: boolean;
  onMove: (dir: -1 | 1) => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(module.title);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  const renameDirty = title.trim() !== module.title && title.trim() !== "";

  const rename = async () => {
    setBusy(true);
    const res = await fetch("/api/admin/modules", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: module.id, title: title.trim() }),
    });
    if (res.ok) router.refresh();
    setBusy(false);
  };

  const remove = async () => {
    if (!confirm(`Delete module “${module.title}” and all its lessons?`)) return;
    setBusy(true);
    const res = await fetch("/api/admin/modules", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: module.id }),
    });
    if (res.ok) router.refresh();
    else setBusy(false);
  };

  const moveLesson = async (dir: -1 | 1, lessonIndex: number) => {
    const ids = module.lessons.map((l) => l.id);
    const j = lessonIndex + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[lessonIndex], ids[j]] = [ids[j], ids[lessonIndex]];
    const res = await fetch("/api/admin/lessons", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reorder", orderedIds: ids }),
    });
    if (res.ok) router.refresh();
  };

  const addLesson = async (draft: LessonDraft): Promise<string | null> => {
    const res = await fetch("/api/admin/lessons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ moduleId: module.id, ...draft }),
    });
    const data = await res.json();
    if (data.success) {
      setAdding(false);
      router.refresh();
      return null;
    }
    return data.error || "Failed to add lesson.";
  };

  return (
    <div className="bg-white border border-neutral-200 rounded-2xl shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-neutral-100 bg-neutral-50/50">
        <span className="text-xs font-bold text-neutral-400 w-6">{index + 1}.</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="flex-1 bg-transparent text-sm font-semibold text-neutral-900 focus:outline-none focus:bg-white focus:border focus:border-primary-500 rounded px-2 py-1 -mx-2"
        />
        {renameDirty && (
          <button onClick={rename} disabled={busy} className="p-1 text-green-600 hover:text-green-700" aria-label="Save title">
            <Check className="w-4 h-4" />
          </button>
        )}
        <button onClick={() => onMove(-1)} disabled={!canUp} className="p-1 text-neutral-400 hover:text-neutral-700 disabled:opacity-25" aria-label="Move module up">
          <ChevronUp className="w-4 h-4" />
        </button>
        <button onClick={() => onMove(1)} disabled={!canDown} className="p-1 text-neutral-400 hover:text-neutral-700 disabled:opacity-25" aria-label="Move module down">
          <ChevronDown className="w-4 h-4" />
        </button>
        <button onClick={remove} disabled={busy} className="p-1 text-neutral-400 hover:text-red-600 disabled:opacity-40" aria-label="Delete module">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* Lessons */}
      <div className="p-2">
        {module.lessons.length === 0 && !adding && (
          <p className="text-xs text-neutral-400 px-3 py-2">No lessons yet.</p>
        )}
        {module.lessons.map((lesson, li) => (
          <LessonItem
            key={lesson.id}
            lesson={lesson}
            canUp={li > 0}
            canDown={li < module.lessons.length - 1}
            onMove={(dir) => moveLesson(dir, li)}
          />
        ))}

        {adding ? (
          <div className="px-1 py-2">
            <LessonForm submitLabel="Add lesson" onSubmit={addLesson} onCancel={() => setAdding(false)} />
          </div>
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary-600 hover:text-primary-700"
          >
            <Plus className="w-3.5 h-3.5" /> Add lesson
          </button>
        )}
      </div>
    </div>
  );
}

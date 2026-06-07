"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Play, FileText, ChevronUp, ChevronDown, Pencil, Trash2 } from "lucide-react";
import LessonForm, { type LessonDraft } from "./LessonForm";
import type { AdminLesson } from "@/lib/db/courses-admin";

export default function LessonItem({
  lesson,
  canUp,
  canDown,
  onMove,
}: {
  lesson: AdminLesson;
  canUp: boolean;
  canDown: boolean;
  onMove: (dir: -1 | 1) => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  const save = async (draft: LessonDraft): Promise<string | null> => {
    const res = await fetch("/api/admin/lessons", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: lesson.id, ...draft }),
    });
    const data = await res.json();
    if (data.success) {
      setEditing(false);
      router.refresh();
      return null;
    }
    return data.error || "Failed to save.";
  };

  const remove = async () => {
    if (!confirm(`Delete lesson “${lesson.title}”?`)) return;
    setBusy(true);
    const res = await fetch("/api/admin/lessons", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: lesson.id }),
    });
    if (res.ok) router.refresh();
    else setBusy(false);
  };

  if (editing) {
    return (
      <div className="py-1">
        <LessonForm
          initial={{ ...lesson, duration: lesson.duration ?? "" }}
          submitLabel="Save lesson"
          onSubmit={save}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 py-2 px-3 rounded-lg hover:bg-neutral-50 group">
      {lesson.type === "video" ? (
        <Play className="w-3.5 h-3.5 text-primary-500 flex-shrink-0" />
      ) : (
        <FileText className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm text-neutral-800 truncate">{lesson.title}</p>
        <p className="text-xs text-neutral-400 truncate font-mono">{lesson.url}</p>
      </div>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={() => onMove(-1)} disabled={!canUp} className="p-1 text-neutral-400 hover:text-neutral-700 disabled:opacity-25" aria-label="Move up">
          <ChevronUp className="w-4 h-4" />
        </button>
        <button onClick={() => onMove(1)} disabled={!canDown} className="p-1 text-neutral-400 hover:text-neutral-700 disabled:opacity-25" aria-label="Move down">
          <ChevronDown className="w-4 h-4" />
        </button>
        <button onClick={() => setEditing(true)} className="p-1 text-neutral-400 hover:text-neutral-900" aria-label="Edit">
          <Pencil className="w-3.5 h-3.5" />
        </button>
        <button onClick={remove} disabled={busy} className="p-1 text-neutral-400 hover:text-red-600 disabled:opacity-40" aria-label="Delete">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import ModuleItem from "./ModuleItem";
import type { AdminModule } from "@/lib/db/courses-admin";

export default function ModulesEditor({
  courseId,
  modules,
}: {
  courseId: string;
  modules: AdminModule[];
}) {
  const router = useRouter();
  const [newTitle, setNewTitle] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  const addModule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setAdding(true);
    setError("");
    const res = await fetch("/api/admin/modules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ courseId, title: newTitle.trim() }),
    });
    const data = await res.json();
    if (data.success) {
      setNewTitle("");
      router.refresh();
    } else {
      setError(data.error || "Failed to add module.");
    }
    setAdding(false);
  };

  const moveModule = async (dir: -1 | 1, index: number) => {
    const ids = modules.map((m) => m.id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    const res = await fetch("/api/admin/modules", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reorder", orderedIds: ids }),
    });
    if (res.ok) router.refresh();
  };

  return (
    <div>
      <h2 className="text-lg font-bold text-neutral-900 mb-3">
        Modules &amp; Lessons{" "}
        <span className="text-neutral-400 font-normal text-sm">({modules.length})</span>
      </h2>

      <div className="space-y-3">
        {modules.map((m, i) => (
          <ModuleItem
            key={m.id}
            module={m}
            index={i}
            canUp={i > 0}
            canDown={i < modules.length - 1}
            onMove={(dir) => moveModule(dir, i)}
          />
        ))}
      </div>

      {/* Add module */}
      <form onSubmit={addModule} className="mt-4 flex gap-2">
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="New module title…"
          className="flex-1 bg-white border border-neutral-300 rounded-xl px-4 py-2.5 text-sm text-neutral-900 placeholder-neutral-400 focus:outline-none focus:border-primary-500 transition-colors"
        />
        <button
          type="submit"
          disabled={adding || !newTitle.trim()}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-neutral-900 hover:bg-neutral-800 disabled:opacity-50 text-white text-sm font-semibold transition-all"
        >
          <Plus className="w-4 h-4" /> Add module
        </button>
      </form>
      {error && <p className="text-red-600 text-sm mt-2">{error}</p>}
    </div>
  );
}

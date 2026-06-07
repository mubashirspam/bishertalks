"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

export default function DeleteCourseButton({
  id,
  title,
}: {
  id: string;
  title: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    if (
      !confirm(
        `Delete “${title}” and ALL its modules, lessons, and access grants? This cannot be undone.`
      )
    )
      return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/courses", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res.ok) router.refresh();
      else setBusy(false);
    } catch {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={remove}
      disabled={busy}
      className="text-neutral-400 hover:text-red-600 disabled:opacity-40 transition-colors"
      aria-label="Delete course"
    >
      <Trash2 className="w-4 h-4" />
    </button>
  );
}

"use client";

import { useParams } from "next/navigation";
import Link from "@/components/admin/AdminLink";
import { ArrowLeft } from "lucide-react";
import TaskDetail from "../TaskDetail";

/**
 * The standalone task page — what a phone or a shared link opens. On desktop
 * the list opens the same TaskDetail in a side sheet instead (TaskSheet.tsx).
 */
export default function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();

  return (
    <div className="max-w-3xl mx-auto">
      <Link
        href="/admin/tasks"
        className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-900 mb-4"
      >
        <ArrowLeft className="w-4 h-4" /> All tasks
      </Link>
      <TaskDetail key={id} id={id} />
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Lock } from "lucide-react";

export default function AccessToggle({
  userId,
  courseId,
  active,
}: {
  userId: string;
  courseId: string;
  active: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const toggle = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          courseId,
          action: active ? "revoke" : "grant",
        }),
      });
      if (res.ok) router.refresh();
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={toggle}
      disabled={loading}
      className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-bold transition-all disabled:opacity-60 ${
        active
          ? "bg-red-50 text-red-600 border border-red-200 hover:bg-red-100"
          : "bg-primary-500 text-white hover:bg-primary-600"
      }`}
    >
      {active ? (
        <>
          <Lock className="w-3.5 h-3.5" /> {loading ? "…" : "Revoke"}
        </>
      ) : (
        <>
          <Check className="w-3.5 h-3.5" /> {loading ? "…" : "Grant access"}
        </>
      )}
    </button>
  );
}

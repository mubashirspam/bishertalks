"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import type { PromoCode } from "@/lib/types/db";

export default function PromoRow({ promo }: { promo: PromoCode }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const expired =
    promo.expires_at != null && new Date(promo.expires_at).getTime() <= Date.now();
  const exhausted =
    promo.usage_limit != null && promo.used_count >= promo.usage_limit;
  const live = promo.is_active && !expired && !exhausted;

  const toggle = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/promos", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: promo.id, is_active: !promo.is_active }),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm(`Delete promo code ${promo.code}?`)) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/promos", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: promo.id }),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <tr className="border-b border-neutral-100 last:border-0">
      <td className="px-4 py-3">
        <span className="font-mono font-semibold text-neutral-900 tracking-wider">
          {promo.code}
        </span>
      </td>
      <td className="px-4 py-3 text-neutral-700">
        {promo.discount_type === "percent"
          ? `${promo.discount_value}% off`
          : `₹${promo.discount_value} off`}
      </td>
      <td className="px-4 py-3 text-neutral-500 text-xs hidden md:table-cell">
        {promo.used_count}
        {promo.usage_limit != null ? ` / ${promo.usage_limit}` : ""}
      </td>
      <td className="px-4 py-3 text-neutral-500 text-xs hidden lg:table-cell">
        {promo.expires_at
          ? new Date(promo.expires_at).toLocaleDateString("en-IN", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })
          : "—"}
      </td>
      <td className="px-4 py-3">
        <span
          className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium border ${
            live
              ? "bg-green-50 text-green-700 border-green-200"
              : "bg-neutral-100 text-neutral-500 border-neutral-200"
          }`}
        >
          {expired ? "Expired" : exhausted ? "Used up" : promo.is_active ? "Active" : "Off"}
        </span>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={toggle}
            disabled={busy || expired || exhausted}
            className="text-xs font-medium text-neutral-600 hover:text-neutral-900 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {promo.is_active ? "Disable" : "Enable"}
          </button>
          <button
            onClick={remove}
            disabled={busy}
            className="text-neutral-400 hover:text-red-600 disabled:opacity-40 transition-colors"
            aria-label="Delete"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import {
  FOLLOW_UP_STATUSES,
  FOLLOW_UP_SHORT,
  FOLLOW_UP_BADGE,
  isFollowUpStatus,
  type FollowUpStatus,
} from "@/lib/follow-up";
import { timeAgo } from "@/lib/format-date";

/**
 * Set a lead's follow-up state from the row itself.
 *
 * Inline rather than behind a click into the detail page: chasing leads is a
 * list-shaped job — you work down the rows with a phone in your hand — and
 * making someone open and leave a page for each one is how a follow-up list
 * stops being used by the second day.
 *
 * Updates optimistically. If the save fails the value snaps back and says so,
 * because silently keeping a status that was never stored would have you skip
 * a customer you never actually rang.
 */
export default function FollowUpCell({
  orderNumber,
  status,
  followedAt,
}: {
  orderNumber: string;
  status: string | null;
  followedAt: string | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState<string>(isFollowUpStatus(status) ? status : "");
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const save = async (next: string) => {
    const previous = value;
    setValue(next);
    setSaving(true);
    setFailed(false);

    try {
      const res = await fetch("/api/admin/orders/follow-up", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_number: orderNumber, status: next || null }),
      });
      if (!res.ok) throw new Error();
      router.refresh();
    } catch {
      setValue(previous);
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  const current = isFollowUpStatus(value) ? (value as FollowUpStatus) : null;

  return (
    <div className="min-w-[132px]">
      <div className="relative">
        <select
          value={value}
          onChange={(e) => save(e.target.value)}
          disabled={saving}
          className={`w-full appearance-none cursor-pointer rounded-full border px-2.5 py-1 pr-6 text-xs font-medium transition-colors focus:outline-none focus:border-primary-500 disabled:opacity-60 ${
            current
              ? FOLLOW_UP_BADGE[current]
              : "bg-white border-neutral-300 text-neutral-500"
          }`}
        >
          <option value="">Not contacted</option>
          {FOLLOW_UP_STATUSES.map((s) => (
            <option key={s} value={s}>
              {FOLLOW_UP_SHORT[s]}
            </option>
          ))}
        </select>
        {saving && (
          <Loader2 className="w-3 h-3 animate-spin absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400" />
        )}
        {!saving && current && (
          <Check className="w-3 h-3 absolute right-2 top-1/2 -translate-y-1/2 opacity-50" />
        )}
      </div>

      {failed ? (
        <p className="text-red-600 text-[11px] mt-0.5">Not saved — try again</p>
      ) : (
        followedAt && (
          <p className="text-neutral-400 text-[11px] mt-0.5">{timeAgo(followedAt)}</p>
        )
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { Check, Flag, Loader2 } from "lucide-react";
// Labels only — see lib/crm/tag-labels.ts for why not lib/crm/tags.
import { FLAGS, FLAG_LABELS, FLAG_TONE, type FlagKey } from "@/lib/crm/tag-labels";

/**
 * One button per flag. Tap to flag somebody; tap again when it is sorted.
 *
 * Writes through the same add_tag / remove_tag endpoint as the tag box, so a
 * flag is audited like any other tag. The parent owns the list and is told the
 * new one on success — the inbox patches its row in place, the full page
 * refreshes.
 */
export default function FlagToggles({
  contactId,
  flags,
  canEdit,
  onChange,
}: {
  contactId: string;
  flags: readonly string[];
  canEdit: boolean;
  onChange: (next: FlagKey[]) => void;
}) {
  const [busy, setBusy] = useState<FlagKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(flag: FlagKey) {
    const on = flags.includes(flag);
    setBusy(flag);
    setError(null);
    try {
      const res = await fetch(`/api/admin/crm/${contactId}/crm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: on ? "remove_tag" : "add_tag", tag: flag }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? "That didn't work.");
        return;
      }
      onChange(FLAGS.filter((f) => (f === flag ? !on : flags.includes(f))));
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(null);
    }
  }

  // Read-only staff still see what is flagged, just without the buttons.
  if (!canEdit) {
    const active = FLAGS.filter((f) => flags.includes(f));
    if (!active.length) return null;
    return (
      <div className="flex flex-wrap gap-1.5">
        {active.map((f) => (
          <FlagBadge key={f} flag={f} />
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {FLAGS.map((f) => {
          const on = flags.includes(f);
          return (
            <button
              key={f}
              type="button"
              onClick={() => void toggle(f)}
              disabled={!!busy}
              title={on ? "Sorted? Tap to remove this flag" : `Flag as ${FLAG_LABELS[f].toLowerCase()}`}
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition disabled:opacity-50 ${
                on
                  ? FLAG_TONE[f]
                  : "border-dashed border-neutral-300 bg-white text-neutral-500 hover:border-neutral-400 hover:text-neutral-800"
              }`}
            >
              {busy === f ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Flag className="h-3 w-3" fill={on ? "currentColor" : "none"} />
              )}
              {FLAG_LABELS[f]}
              {on && (
                <span className="ml-1 inline-flex items-center gap-0.5 border-l border-current pl-1.5 font-medium opacity-80">
                  <Check className="h-3 w-3" /> Done
                </span>
              )}
            </button>
          );
        })}
      </div>
      {error && <p className="mt-1.5 text-[11px] text-red-600">{error}</p>}
    </div>
  );
}

/** The small read-only badge for lists. */
export function FlagBadge({ flag }: { flag: FlagKey }) {
  return (
    <span
      title={`Flagged: ${FLAG_LABELS[flag]}`}
      className={`inline-flex shrink-0 items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${FLAG_TONE[flag]}`}
    >
      <Flag className="h-2.5 w-2.5" fill="currentColor" />
      {FLAG_LABELS[flag]}
    </span>
  );
}

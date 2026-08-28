"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PauseCircle, PlayCircle } from "lucide-react";

/**
 * Stop everything.
 *
 * Deliberately blunt: this pauses order notifications as well as campaigns.
 * If something is wrong enough to press it, it is wrong enough to stop all of
 * it — and pausing an individual campaign is what the campaigns screen is for.
 *
 * Lives at the top of the health screen rather than behind a menu, because the
 * moment somebody needs it they will be in a hurry.
 */
export default function KillSwitch({
  paused,
  reason,
  by,
  canPause,
}: {
  paused: boolean;
  reason: string | null;
  by: string | null;
  canPause: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    let why = "";
    if (!paused) {
      why = prompt("Why are you pausing all WhatsApp sending?")?.trim() ?? "";
      if (!why) return;
    } else if (
      !confirm("Resume all WhatsApp sending, including order notifications?")
    ) {
      return;
    }

    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/crm/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paused: !paused, reason: why }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) setError(json.error ?? "That didn't work.");
    else router.refresh();
  }

  return (
    <div
      className={`rounded-xl border px-4 py-3.5 ${
        paused ? "border-red-300 bg-red-50" : "border-neutral-200 bg-white"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p
            className={`flex items-center gap-1.5 text-sm font-bold ${
              paused ? "text-red-800" : "text-neutral-900"
            }`}
          >
            {paused ? (
              <><PauseCircle className="h-4 w-4" /> All sending is paused</>
            ) : (
              <><PlayCircle className="h-4 w-4 text-green-600" /> Sending is live</>
            )}
          </p>
          <p className={`mt-1 text-xs ${paused ? "text-red-700" : "text-neutral-500"}`}>
            {paused
              ? `${reason ?? "No reason recorded"}${by ? ` — ${by}` : ""}`
              : "Order notifications, replies and campaigns are all going out normally."}
          </p>
        </div>

        {canPause && (
          <button
            onClick={toggle}
            disabled={busy}
            className={`shrink-0 rounded-lg px-4 py-2 text-sm font-semibold transition disabled:opacity-50 ${
              paused
                ? "bg-green-600 text-white hover:bg-green-700"
                : "border border-red-300 bg-white text-red-700 hover:bg-red-50"
            }`}
          >
            {paused ? "Resume sending" : "Pause everything"}
          </button>
        )}
      </div>

      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Loader2, Check } from "lucide-react";

/**
 * Retry one failed notification.
 *
 * Only appears on a message that did not reach the customer. A retry on one
 * that landed is a second copy, and the route refuses it too — a button that
 * cannot be pressed by mistake beats a confirmation dialog.
 *
 * It sends the EVENT again, so what goes out is whatever template that event
 * maps to now. A confirmation that failed in August against `order_confirmed`
 * comes back as `neuro_order_receipt`, with the Track Order and Order Details
 * buttons — which is the point: you retry to get the message delivered, not to
 * replay a wording that has since been replaced.
 */
export default function ResendMessage({
  orderNumber,
  event,
  status,
}: {
  orderNumber: string;
  /** The wire event name, e.g. "order.confirmed". */
  event: string;
  status: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // "order.confirmed" → "confirmed", which is what the API takes.
  const internal = event.replace(/^order\./, "").replace(/^course\./, "course_");

  async function retry() {
    setBusy(true);
    setError(null);

    try {
      const res = await fetch(`/api/admin/orders/${orderNumber}/resend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: internal, status }),
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(json.error ?? "That didn't work.");
        return;
      }
      setDone(json.template ?? "sent");
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <p className="mt-1 flex items-center gap-1 text-[11px] text-green-700">
        <Check className="h-3 w-3" /> Sent as {done}
      </p>
    );
  }

  return (
    <>
      <button
        onClick={retry}
        disabled={busy}
        title="Send this message again, using the template it maps to today"
        className="mt-1 inline-flex items-center gap-1 rounded-md border border-neutral-300 bg-white px-2 py-0.5 text-[11px] font-medium text-neutral-700 transition hover:border-neutral-500 disabled:opacity-40"
      >
        {busy ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <RotateCcw className="h-3 w-3" />
        )}
        {busy ? "Sending…" : "Retry"}
      </button>
      {error && <p className="mt-1 text-[11px] text-red-600">{error}</p>}
    </>
  );
}

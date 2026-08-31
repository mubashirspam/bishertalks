"use client";

import { useState } from "react";
import { Hash, Loader2 } from "lucide-react";

/**
 * Give the ticked Speed Post parcels an India Post article number.
 *
 * Routing a parcel to Speed Post allots one on the spot, so most of the time
 * this button has nothing to do and does not appear. It is here for the
 * parcels that were routed before article numbers existed, and for any batch
 * that was routed while the allotment was empty.
 *
 * Its own button, and not a side effect of printing or downloading, because a
 * number is a consumable that is never returned to stock. Spending one should
 * be something a person pressed.
 *
 * Safe to press twice: a parcel that already holds a number keeps it rather
 * than taking a second.
 */
export default function PortalAllotArticles({
  orderNumbers,
  onDone,
}: {
  /** Only the ticked parcels that actually need one. */
  orderNumbers: string[];
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);

  async function allot() {
    setBusy(true);
    setNote(null);

    try {
      const res = await fetch("/api/admin/delivery/allot-articles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_numbers: orderNumbers }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setNote({ text: data.error ?? "Could not allot the numbers.", bad: true });
        return;
      }

      // Amber rather than green when the allotment ran out: some parcels came
      // back without a number and the person needs to know which state they
      // are now in, not just that the button worked.
      setNote({ text: data.message ?? "Done.", bad: !!data.shortfall });
      onDone();
    } catch {
      setNote({ text: "Failed — check your connection.", bad: true });
    } finally {
      setBusy(false);
    }
  }

  // Nothing to do is not a disabled button, it is no button. The bar is
  // already crowded, and a permanently greyed control reads as broken.
  if (!orderNumbers.length) return null;

  return (
    <>
      <button
        onClick={allot}
        disabled={busy}
        title={`Give ${orderNumbers.length} parcel${
          orderNumbers.length === 1 ? "" : "s"
        } an India Post article number — needed before it can be booked or labelled`}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-600 bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700 hover:border-amber-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
      >
        {busy ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Hash className="w-3.5 h-3.5" />
        )}
        {busy ? "Allotting…" : `Allot article numbers (${orderNumbers.length})`}
      </button>

      {note && (
        <span className={`text-xs ${note.bad ? "text-amber-700" : "text-emerald-700"}`}>
          {note.text}
        </span>
      )}
    </>
  );
}
